import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadRoadSource } from "../lib/roadSourceCompiler.mjs";

const projectRoot = process.cwd();
const routes = JSON.parse(await readFile(join(projectRoot, "data", "routes.json"), "utf8"));
const errors = [];
const warnings = [];

function label(routeId, collection, index, item) {
  return `${routeId}.${collection}[${index}] ${item?.name || "(名称なし)"}`;
}

function validateLaneOrder(routeId, collection, index, item) {
  const keys = Object.keys(item || {});
  const downIndex = keys.indexOf("down");
  const upIndex = keys.indexOf("up");
  if (downIndex >= 0 && upIndex >= 0 && downIndex > upIndex) {
    errors.push(`${label(routeId, collection, index, item)}: down must precede up`);
  }
}

function validateFacility(routeId, facility, index) {
  const itemLabel = label(routeId, "facilities", index, facility);
  if (!String(facility?.name || "").trim()) errors.push(`${itemLabel}: name is required`);
  if (!String(facility?.type || "").trim()) errors.push(`${itemLabel}: type is required`);
  validateLaneOrder(routeId, "facilities", index, facility);
  for (const direction of ["down", "up"]) {
    const lane = facility?.[direction];
    if (!lane) continue;
    if (!Number.isFinite(lane.kp) || lane.kp < 0) {
      errors.push(`${itemLabel}/${direction}: kp must be a non-negative number`);
    }
  }
  if (facility?.ramps != null) {
    const ramps = String(facility.ramps);
    if (!/^[ABCD]+$/.test(ramps) || new Set(ramps).size !== ramps.length) {
      errors.push(`${itemLabel}: ramps must contain unique A-D letters`);
    }
  }
}

function structureStart(structure) {
  return Math.min(
    ...[structure?.down?.start, structure?.up?.start].filter(Number.isFinite)
  );
}

function validateStructure(routeId, structure, index) {
  const itemLabel = label(routeId, "structures", index, structure);
  if (!String(structure?.name || "").trim()) errors.push(`${itemLabel}: name is required`);
  if (!String(structure?.type || "").trim()) errors.push(`${itemLabel}: type is required`);
  validateLaneOrder(routeId, "structures", index, structure);
  for (const direction of ["down", "up"]) {
    const lane = structure?.[direction];
    if (!lane) continue;
    if (![lane.start, lane.end].every(Number.isFinite)) {
      errors.push(`${itemLabel}/${direction}: start and end must be numbers`);
      continue;
    }
    if (lane.start < 0 || lane.end < lane.start) {
      errors.push(`${itemLabel}/${direction}: invalid KP range ${lane.start}-${lane.end}`);
      continue;
    }
    const declaredLengthM = Number.isFinite(lane.length_m) ? lane.length_m : structure.length_m;
    if (Number.isFinite(declaredLengthM)) {
      const kpLengthM = (lane.end - lane.start) * 1000;
      const differenceM = Math.abs(kpLengthM - declaredLengthM);
      if (differenceM >= 50) {
        warnings.push(
          `${itemLabel}/${direction}: KP length ${kpLengthM.toFixed(1)}m differs from length_m `
          + `${declaredLengthM}m by ${differenceM.toFixed(1)}m`
        );
      }
    }
  }
}

for (const route of routes) {
  const road = await loadRoadSource(projectRoot, route.id);
  const facilities = Array.isArray(road.facilities) ? road.facilities : [];
  const structures = Array.isArray(road.structures) ? road.structures : [];
  facilities.forEach((facility, index) => validateFacility(route.id, facility, index));
  structures.forEach((structure, index) => validateStructure(route.id, structure, index));

  let previousStart = -Infinity;
  structures.forEach((structure, index) => {
    const start = structureStart(structure);
    if (!Number.isFinite(start)) return;
    if (start < previousStart) {
      warnings.push(`${label(route.id, "structures", index, structure)}: structures are not in KP order`);
    }
    previousStart = start;
  });
}

for (const warning of warnings) console.warn(`WARN ${warning}`);
if (errors.length) {
  throw new Error(`Road data audit failed:\n${errors.join("\n")}`);
}

console.log(`Audited ${routes.length} routes: ${warnings.length} length warnings, no structural errors.`);
