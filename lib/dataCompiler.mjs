import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadRoadSource } from "./roadSourceCompiler.mjs";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function normalizePosition(value, label = "position") {
  if (Number.isFinite(value)) return { section: null, kp: value };
  if (
    value
    && typeof value === "object"
    && typeof value.section === "string"
    && Number.isFinite(value.kp)
  ) {
    return { section: value.section, kp: value.kp };
  }
  throw new Error(`${label} must be a KP number or { section, kp }`);
}

function assertUnique(items, getId, label) {
  const seen = new Set();
  for (const item of items) {
    const id = getId(item);
    if (!id) throw new Error(`${label} contains an item without an id`);
    if (seen.has(id)) throw new Error(`${label} contains duplicate id: ${id}`);
    seen.add(id);
  }
}

function sectionIdsFor(road) {
  return new Set((road.sections || []).map(section => section.id));
}

function validatePosition(position, sectionIds, label) {
  const normalized = normalizePosition(position, label);
  if (normalized.section && sectionIds.size && !sectionIds.has(normalized.section)) {
    throw new Error(`${label} refers to unknown section: ${normalized.section}`);
  }
  return normalized;
}

function normalizeScope(scopeId, routeId, value, road) {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid scope: ${scopeId}/${routeId}`);
  }
  const sectionIds = sectionIdsFor(road);
  return {
    start: validatePosition(value.start, sectionIds, `${scopeId}/${routeId}.start`),
    end: validatePosition(value.end, sectionIds, `${scopeId}/${routeId}.end`),
    startName: value.startName || null,
    endName: value.endName || null
  };
}

function resolveFacilityBoundary({ road, routeId, scopeId, definition, edge, facilityById }) {
  const facilityId = definition[`${edge}FacilityId`];
  if (!facilityId) throw new Error(`${scopeId}/${routeId}.${edge}FacilityId is required`);
  const registered = facilityById.get(facilityId);
  if (!registered) throw new Error(`${scopeId}/${routeId} refers to unknown facility id: ${facilityId}`);
  if (registered.routeId !== routeId) {
    throw new Error(`${scopeId}/${routeId} uses facility from ${registered.routeId}: ${facilityId}`);
  }
  const facilityName = registered.name;
  const requestedSection = registered.section || null;

  const matches = (road.facilities || []).filter(facility =>
    facility.name === facilityName
    && (!requestedSection || facility.section === requestedSection)
  );
  if (matches.length !== 1) {
    throw new Error(
      `${scopeId}/${routeId} ${edge} facility must match once: `
      + `${facilityName}${requestedSection ? ` [${requestedSection}]` : ""} (found ${matches.length})`
    );
  }

  const facility = matches[0];
  const laneKps = [facility.down?.kp, facility.up?.kp].filter(Number.isFinite);
  if (!laneKps.length) {
    throw new Error(`${scopeId}/${routeId} facility has no KP: ${facilityName}`);
  }
  // A shared scope must include both carriageways when their facility KPs differ.
  const kp = edge === "from" ? Math.min(...laneKps) : Math.max(...laneKps);
  const section = requestedSection || facility.section || null;
  return { position: section ? { section, kp } : kp, name: facilityName };
}

function compileScopeDefinitions(definitions, roads, facilityById) {
  const runtimeScopes = {};
  for (const [scopeId, scope] of Object.entries(definitions)) {
    runtimeScopes[scopeId] = {
      name: scope.name || scopeId,
      home: scope.home || null,
      routes: {}
    };
    for (const [routeId, definition] of Object.entries(scope.routes || {})) {
      const road = roads.get(routeId);
      if (!road) throw new Error(`${scopeId} refers to unknown route: ${routeId}`);
      const start = resolveFacilityBoundary({
        road, routeId, scopeId, definition, edge: "from", facilityById
      });
      const end = resolveFacilityBoundary({
        road, routeId, scopeId, definition, edge: "to", facilityById
      });
      runtimeScopes[scopeId].routes[routeId] = {
        start: start.position,
        end: end.position,
        startName: start.name,
        endName: end.name
      };
    }
  }
  return runtimeScopes;
}

export async function compileDataModel({ projectRoot, outputPath = null }) {
  const dataDir = join(projectRoot, "data");
  const [routes, scopeDefinitions, organizations, facilityRegistry] = await Promise.all([
    readJson(join(dataDir, "routes.json")),
    readJson(join(dataDir, "scope-definitions.json")),
    readJson(join(dataDir, "organizations.json")),
    readJson(join(dataDir, "facility-registry.json"))
  ]);

  assertUnique(routes, route => route.id, "routes.json");
  assertUnique(organizations.operators || [], item => item.id, "organizations.operators");
  assertUnique(
    organizations.branches || [],
    item => `${item.operatorId}/${item.id}`,
    "organizations.branches"
  );
  assertUnique(organizations.offices || [], item => item.id, "organizations.offices");
  assertUnique(facilityRegistry.facilities || [], item => item.id, "facility-registry.facilities");

  const roads = new Map();
  const compatibilityWarnings = [];
  for (const route of routes) {
    const road = await loadRoadSource(projectRoot, route.id);
    if (road.id !== route.id) {
      const legacyIdMatches = String(route.id).replace(/^e/i, "") === String(road.id);
      if (!legacyIdMatches) {
        throw new Error(`Route id mismatch: routes.json=${route.id}, road.json=${road.id}`);
      }
      compatibilityWarnings.push(
        `${route.id}: legacy road.json id ${road.id} is accepted during migration`
      );
    }
    const sections = road.sections || [];
    assertUnique(sections, section => section.id, `${route.id}.sections`);
    roads.set(route.id, road);
  }

  const facilityById = new Map(
    (facilityRegistry.facilities || []).map(facility => [facility.id, facility])
  );
  const runtimeScopes = compileScopeDefinitions(scopeDefinitions, roads, facilityById);
  const normalizedScopes = {};
  for (const [scopeId, scope] of Object.entries(runtimeScopes)) {
    normalizedScopes[scopeId] = { name: scope.name || scopeId, routes: {} };
    for (const [routeId, value] of Object.entries(scope.routes || {})) {
      const road = roads.get(routeId);
      if (!road) throw new Error(`${scopeId} refers to unknown route: ${routeId}`);
      normalizedScopes[scopeId].routes[routeId] = normalizeScope(scopeId, routeId, value, road);
    }
  }

  for (const office of organizations.offices || []) {
    const entries = office.routesSource
      ? await readJson(join(projectRoot, office.routesSource))
      : office.routes;
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error(`Office has no route entries: ${office.id}`);
    }
    for (const entry of entries) {
      const routeId = entry.route || entry.id;
      if (!roads.has(routeId)) throw new Error(`${office.id} refers to unknown route: ${routeId}`);
      if (entry.scope && !runtimeScopes[entry.scope]) {
        throw new Error(`${office.id} refers to unknown scope: ${entry.scope}`);
      }
      if (entry.scope && !runtimeScopes[entry.scope]?.routes?.[routeId]) {
        throw new Error(`${entry.scope} has no route definition for ${routeId}`);
      }
    }
  }

  const compiled = {
    formatVersion: 1,
    routeCount: routes.length,
    routeIds: routes.map(route => route.id),
    organizationCount: {
      operators: organizations.operators?.length || 0,
      branches: organizations.branches?.length || 0,
      offices: organizations.offices?.length || 0
    },
    compatibilityWarnings,
    runtimeScopes,
    scopes: normalizedScopes
  };

  if (outputPath) await writeFile(outputPath, `${JSON.stringify(compiled, null, 2)}\n`);
  return compiled;
}
