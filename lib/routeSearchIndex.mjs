import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadRoadSource } from "./roadSourceCompiler.mjs";

export async function buildRouteSearchIndex({ projectRoot, routes }) {
  const entries = [];
  for (const route of routes) {
    try {
      const road = await loadRoadSource(projectRoot, route.id);
      const files = Array.isArray(road.sections) && road.sections.length
        ? road.sections.map(section => section.geojson)
        : ["route.geojson"];
      const boxes = await Promise.all(files.map(async fileName => {
        const geojson = JSON.parse(await readFile(
          join(projectRoot, "data", route.id, fileName),
          "utf8"
        ));
        return geometryBbox(geojson);
      }));
      const bbox = mergeBboxes(boxes.filter(Boolean));
      if (bbox) entries.push({ id: route.id, name: road.name || route.name, bbox });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      // 準備中で線形が未生成の路線は、全路線検索索引からのみ除外する。
    }
  }
  return { formatVersion: 1, routes: entries };
}

function geometryBbox(geojson) {
  const coordinates = geojson.features?.flatMap(feature =>
    feature.geometry?.type === "LineString" ? feature.geometry.coordinates : []
  ) || [];
  if (!coordinates.length) return null;
  return coordinates.reduce(
    (bbox, [lon, lat]) => [
      Math.min(bbox[0], lon),
      Math.min(bbox[1], lat),
      Math.max(bbox[2], lon),
      Math.max(bbox[3], lat)
    ],
    [Infinity, Infinity, -Infinity, -Infinity]
  );
}

function mergeBboxes(boxes) {
  if (!boxes.length) return null;
  return boxes.reduce((merged, bbox) => [
    Math.min(merged[0], bbox[0]),
    Math.min(merged[1], bbox[1]),
    Math.max(merged[2], bbox[2]),
    Math.max(merged[3], bbox[3])
  ]);
}
