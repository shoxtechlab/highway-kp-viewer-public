import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadRoadSource } from "../lib/roadSourceCompiler.mjs";

const routeId = process.argv[2]?.toLowerCase();
if (!routeId) throw new Error("Usage: npm run migrate:road-source -- <route-id>");

const root = process.cwd();
const legacyPath = join(root, "data", routeId, "road.json");
const outputDir = join(root, "data-source", routeId);
const road = JSON.parse(await readFile(legacyPath, "utf8"));

try {
  await access(outputDir);
  throw new Error(`${routeId}: data-source directory already exists; migration was not overwritten`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const { facilities = [], structures = [], ...base } = road;
const networkKeys = new Set([
  "length", "planned_length_km", "start", "end", "sections", "gaps",
  "unopened", "display", "directionLabels", "axisMode", "length_provisional",
  "default_sections", "section_connections"
]);
const metadata = {};
const network = {};
for (const [key, value] of Object.entries(base)) {
  (networkKeys.has(key) ? network : metadata)[key] = value;
}

await mkdir(outputDir, { recursive: true });
const outputs = {
  "metadata.json": metadata,
  "network.json": network,
  "facilities.json": { facilities },
  "structures.json": { structures }
};
for (const [file, value] of Object.entries(outputs)) {
  await writeFile(join(outputDir, file), `${JSON.stringify(value, null, 2)}\n`);
}
const compiled = await loadRoadSource(root, routeId);
if (!isDeepStrictEqual(compiled, road)) {
  throw new Error(`${routeId}: split source does not reproduce the legacy road.json`);
}
console.log(
  `Migrated ${routeId} to ${outputDir}; semantic parity verified, `
  + "legacy road.json remains as a compatibility reference."
);
