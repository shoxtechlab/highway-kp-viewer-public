import { buildKPIndex } from "../js/kpGeo.js";
import { matchPositionToRoutes } from "../js/routeMatcher.js";
import { kpToStreetView } from "../js/svEngine.js";

export function createRouteService(readRouteFile, options = {}) {
  const cache = new Map();

  async function loadRoute(routeId) {
    validateRouteId(routeId);
    if (cache.has(routeId)) return cache.get(routeId);

    const roadText = await readRouteFile(routeId, "road.json");
    const road = JSON.parse(roadText);
    let indexes;
    let coverage;
    let sectionCoverage = null;

    if (Array.isArray(road.sections) && road.sections.length) {
      indexes = {};
      sectionCoverage = {};
      await Promise.all(road.sections.map(async section => {
        const geoText = await readRouteFile(routeId, section.geojson);
        const geoData = JSON.parse(geoText);
        const sectionIndexes = buildDirectionIndexes(geoData, false);
        indexes[section.id] = sectionIndexes;
        sectionCoverage[section.id] = coverageForIndexes(sectionIndexes);
      }));
      coverage = aggregateRouteCoverage(road, sectionCoverage);
    } else {
      const geoText = await readRouteFile(routeId, "route.geojson");
      indexes = buildDirectionIndexes(JSON.parse(geoText), true);
      coverage = coverageForIndexes(indexes);
    }

    const value = { road, indexes, coverage, sectionCoverage };
    cache.set(routeId, value);
    return value;
  }

  async function getRoute(routeId) {
    const { road, coverage, sectionCoverage } = await loadRoute(routeId);
    return { road, coordinateCoverage: coverage, sectionCoverage };
  }

  async function getPosition({ routeId, direction, kp, sectionId }) {
    if (!["up", "down"].includes(direction)) {
      throw apiError(400, "Invalid direction.");
    }
    const numericKp = finiteNumber(kp, "kp");
    const { road, indexes } = await loadRoute(routeId);
    const selection = resolvePositionSelection(road, indexes, numericKp, sectionId);
    const position = kpToStreetView(selection.indexes[direction], selection.localKp, direction);
    if (!position) throw apiError(422, "KP is outside coordinate coverage.");
    return {
      route: routeId,
      section: selection.section?.id || null,
      direction,
      directionLabel: resolveDirectionLabel(road, direction),
      kp: numericKp,
      localKp: selection.localKp,
      routeKp: selection.routeKp,
      provisional: Boolean(selection.section?.provisional),
      ...position
    };
  }

  async function getNearest({
    routeId,
    lat,
    lon,
    preferredRoute,
    preferredDirection,
    sectionIds,
    heading,
    speed,
    accuracy
  }) {
    const numericLat = finiteNumber(lat, "lat");
    const numericLon = finiteNumber(lon, "lon");
    if (numericLat < -90 || numericLat > 90 || numericLon < -180 || numericLon > 180) {
      throw apiError(400, "Invalid coordinates.");
    }
    const motion = parseMotion({ heading, speed, accuracy });
    if (!routeId) {
      return getNearestAcrossRoutes({
        lat: numericLat,
        lon: numericLon,
        preferredRoute,
        preferredDirection,
        motion
      });
    }
    return getNearestOnRoute({
      routeId,
      lat: numericLat,
      lon: numericLon,
      preferredDirection,
      sectionIds,
      motion
    });
  }

  async function getNearestOnRoute({ routeId, lat, lon, preferredDirection, sectionIds, motion }) {
    const { road, indexes } = await loadRoute(routeId);
    const candidates = Array.isArray(road.sections) && road.sections.length
      ? road.sections
          .filter(section => !sectionIds?.length || sectionIds.includes(section.id))
          .map(section => ({ section, indexes: indexes[section.id] }))
      : [{ section: null, indexes }];
    const matches = candidates.map(candidate => {
      if (!candidate.indexes?.up?.length || !candidate.indexes?.down?.length) return null;
      const match = matchPositionToRoutes(
        { lat, lon },
        candidate.indexes,
        {
          ...motion,
          ...(["up", "down"].includes(preferredDirection) ? { preferredDirection } : {})
        }
      );
      return match ? { ...candidate, match } : null;
    }).filter(Boolean);
    const selected = matches.sort((a, b) => a.match.distanceM - b.match.distanceM)[0];
    const match = selected?.match;
    if (!match) throw apiError(422, "Position could not be matched.");
    const routeKp = selected.section ? localToRouteKp(selected.section, match.kp) : match.kp;
    return {
      route: routeId,
      section: selected.section?.id || null,
      direction: match.direction,
      directionLabel: resolveDirectionLabel(road, match.direction),
      kp: routeKp,
      localKp: match.kp,
      routeKp,
      distanceM: match.distanceM,
      snappedLat: match.snappedLat,
      snappedLon: match.snappedLon,
      roadHeading: match.roadHeading,
      headingDifference: match.headingDifference ?? null,
      directionMethod: match.directionMethod,
      locationAccuracyM: motion.accuracy,
      ambiguous: match.ambiguous,
      alternatives: []
    };
  }

  async function getNearestAcrossRoutes({ lat, lon, preferredRoute, preferredDirection, motion }) {
    if (typeof options.readRouteIndex !== "function") {
      throw apiError(503, "Route search index is not configured.");
    }
    const index = JSON.parse(await options.readRouteIndex());
    const indexedRoutes = Array.isArray(index.routes) ? index.routes : [];
    const candidateRoutes = shortlistRoutes(indexedRoutes, lat, lon);
    if (!candidateRoutes.length) throw apiError(422, "Position could not be matched.");

    const settled = await Promise.allSettled(candidateRoutes.map(async indexed => {
      const match = await getNearestOnRoute({
        routeId: indexed.id,
        lat,
        lon,
        preferredDirection: indexed.id === preferredRoute ? preferredDirection : null,
        motion
      });
      return { ...match, routeName: indexed.name || match.route };
    }));
    const matches = settled
      .filter(result => result.status === "fulfilled")
      .map(result => result.value)
      .sort((a, b) => a.distanceM - b.distanceM);
    if (!matches.length) throw apiError(422, "Position could not be matched.");

    const closest = matches[0];
    const closeMatches = matches.filter(item => item.distanceM <= closest.distanceM + 10);
    const headingRanked = motion.heading != null && (motion.speed == null || motion.speed >= 2)
      ? [...closeMatches].sort((a, b) =>
          (a.headingDifference ?? Infinity) - (b.headingDifference ?? Infinity)
          || a.distanceM - b.distanceM
        )
      : closeMatches;
    const headingBest = headingRanked[0] || closest;
    const preferred = closeMatches.find(item => item.route === preferredRoute);
    const selected = preferred
      && (headingBest.headingDifference == null
        || preferred.headingDifference == null
        || Math.abs(preferred.headingDifference - headingBest.headingDifference) <= 10)
      ? preferred
      : headingBest;
    const alternatives = matches
      .filter(item => item.route !== selected.route)
      .slice(0, 4)
      .map(item => ({
        route: item.route,
        routeName: item.routeName,
        section: item.section,
        direction: item.direction,
        directionLabel: item.directionLabel,
        kp: item.kp,
        distanceM: item.distanceM,
        distanceDifferenceM: item.distanceM - selected.distanceM,
        roadHeading: item.roadHeading,
        headingDifference: item.headingDifference
      }));
    return {
      ...selected,
      ambiguous: Boolean(selected.ambiguous || alternatives[0]?.distanceDifferenceM <= 10),
      routeMethod: selected.route === preferredRoute && selected !== headingBest
        ? "previous-selection"
        : (selected !== closest ? "position-and-heading" : "nearest-route"),
      alternatives
    };
  }

  return { loadRoute, getRoute, getPosition, getNearest };
}

function resolveDirectionLabel(road, direction) {
  return road?.direction_labels?.[direction]
    || (direction === "up" ? "上り" : "下り");
}

function parseMotion({ heading, speed, accuracy }) {
  const parsedHeading = optionalFiniteNumber(heading, "heading");
  const parsedSpeed = optionalFiniteNumber(speed, "speed");
  const parsedAccuracy = optionalFiniteNumber(accuracy, "accuracy");
  if (parsedHeading != null && (parsedHeading < 0 || parsedHeading >= 360)) {
    throw apiError(400, "Invalid heading.");
  }
  if (parsedSpeed != null && parsedSpeed < 0) throw apiError(400, "Invalid speed.");
  if (parsedAccuracy != null && parsedAccuracy < 0) throw apiError(400, "Invalid accuracy.");
  return { heading: parsedHeading, speed: parsedSpeed, accuracy: parsedAccuracy };
}

function shortlistRoutes(routes, lat, lon) {
  const scored = routes
    .filter(route => route.id && Array.isArray(route.bbox) && route.bbox.length === 4)
    .map(route => ({ ...route, bboxDistanceM: distanceToBboxM(lat, lon, route.bbox) }))
    .sort((a, b) => a.bboxDistanceM - b.bboxDistanceM);
  const nearby = scored.filter(route => route.bboxDistanceM <= 10000);
  return nearby.length ? nearby : scored.slice(0, 5);
}

function distanceToBboxM(lat, lon, [minLon, minLat, maxLon, maxLat]) {
  const clampedLat = Math.max(minLat, Math.min(maxLat, lat));
  const clampedLon = Math.max(minLon, Math.min(maxLon, lon));
  const latM = (lat - clampedLat) * 111195;
  const lonM = (lon - clampedLon) * 111195 * Math.cos(lat * Math.PI / 180);
  return Math.hypot(latM, lonM);
}

function buildDirectionIndexes(geoData, required) {
  const indexes = {};
  for (const direction of ["up", "down"]) {
    const feature = geoData.features?.find(item => item.properties?.name === direction);
    if (!feature) {
      if (required) throw apiError(500, `Missing ${direction} geometry.`);
      indexes[direction] = [];
      continue;
    }
    indexes[direction] = buildKPIndex(feature);
  }
  return indexes;
}

function coverageForIndexes(indexes) {
  return Object.fromEntries(["up", "down"].map(direction => {
    const index = indexes[direction] || [];
    return [direction, index.length ? { start: index[0].kp, end: index.at(-1).kp } : null];
  }));
}

function localToRouteKp(section, localKp) {
  if (![section.route_start_km, section.local_start_kp, section.kp_direction].every(Number.isFinite)) return null;
  return section.route_start_km + (localKp - section.local_start_kp) / section.kp_direction;
}

function routeToLocalKp(section, routeKp) {
  if (![section.route_start_km, section.local_start_kp, section.kp_direction].every(Number.isFinite)) return null;
  return section.local_start_kp + (routeKp - section.route_start_km) * section.kp_direction;
}

function aggregateRouteCoverage(road, sectionCoverage) {
  return Object.fromEntries(["up", "down"].map(direction => {
    const ranges = road.sections.flatMap(section => {
      const local = sectionCoverage[section.id]?.[direction];
      if (!local) return [];
      const values = [localToRouteKp(section, local.start), localToRouteKp(section, local.end)].filter(Number.isFinite);
      return values.length === 2 ? [{ start: Math.min(...values), end: Math.max(...values), section: section.id }] : [];
    });
    return [direction, ranges.length ? { start: Math.min(...ranges.map(range => range.start)), end: Math.max(...ranges.map(range => range.end)), ranges } : null];
  }));
}

function resolvePositionSelection(road, indexes, kp, sectionId) {
  if (!Array.isArray(road.sections) || !road.sections.length) {
    return { section: null, indexes, localKp: kp, routeKp: kp };
  }
  let section;
  let localKp;
  let routeKp;
  if (sectionId) {
    section = road.sections.find(item => item.id === sectionId);
    if (!section) throw apiError(400, "Invalid section.");
    localKp = kp;
    routeKp = localToRouteKp(section, localKp);
  } else {
    routeKp = kp;
    const candidates = road.sections.filter(item => Number.isFinite(item.route_start_km) && item.route_start_km <= routeKp);
    section = candidates.reverse().find(item => !Number.isFinite(item.route_end_km) || routeKp <= item.route_end_km);
    if (!section) throw apiError(422, "KP is outside configured sections.");
    localKp = routeToLocalKp(section, routeKp);
  }
  if (!Number.isFinite(localKp) || !Number.isFinite(routeKp)) throw apiError(422, "Section KP conversion is not configured.");
  return { section, indexes: indexes[section.id], localKp, routeKp };
}

export function apiError(status, message) {
  return Object.assign(new Error(message), { status });
}

function validateRouteId(routeId) {
  // Numbering can be shared by multiple roads (for example E1 Tomei/Meishin),
  // so a safe lowercase slug such as "e1-meishin" is accepted as an API ID.
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(routeId || "")) {
    throw apiError(400, "Invalid route id.");
  }
}

function finiteNumber(value, name) {
  if (value == null || String(value).trim() === "") {
    throw apiError(400, `Missing ${name}.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw apiError(400, `Invalid ${name}.`);
  return number;
}

function optionalFiniteNumber(value, name) {
  if (value == null || String(value).trim() === "") return null;
  return finiteNumber(value, name);
}
