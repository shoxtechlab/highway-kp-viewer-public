import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function loadRoadSource(projectRoot, routeId) {
  const splitRoot = join(projectRoot, "data-source", routeId);
  let hasSplitSource = true;
  try {
    await access(splitRoot);
  } catch (error) {
    if (error.code === "ENOENT") hasSplitSource = false;
    else throw error;
  }

  if (!hasSplitSource) {
    return readJson(join(projectRoot, "data", routeId, "road.json"));
  }

  // Once a route has a split-source directory, every part is mandatory.
  // Falling back to road.json for a partially migrated route would hide data loss.
  const requiredFiles = ["metadata.json", "network.json", "facilities.json", "structures.json"];
  let parts;
  try {
    parts = await Promise.all(requiredFiles.map(file => readJson(join(splitRoot, file))));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${routeId}: split source is incomplete (${error.path})`, { cause: error });
    }
    throw error;
  }
  const [metadata, network, facilities, structures] = parts;
  if (!Array.isArray(facilities.facilities)) {
    throw new Error(`${routeId}: facilities.json must contain a facilities array`);
  }
  if (!Array.isArray(structures.structures)) {
    throw new Error(`${routeId}: structures.json must contain a structures array`);
  }
  return {
    ...metadata,
    ...network,
    structures: structures.structures,
    facilities: facilities.facilities
  };
}

export async function writeCompiledRoadSources({ projectRoot, outputRoot, routeIds }) {
  for (const routeId of routeIds) {
    const road = await loadRoadSource(projectRoot, routeId);
    const routeOutput = join(outputRoot, routeId);
    await mkdir(routeOutput, { recursive: true });
    await writeFile(join(routeOutput, "road.json"), `${JSON.stringify(road, null, 2)}\n`);
  }
}
