import { resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { writeCompiledRoadSources } from "../lib/roadSourceCompiler.mjs";
import { buildRouteSearchIndex } from "../lib/routeSearchIndex.mjs";

const projectRoot = process.cwd();
const outputRoot = resolve(process.argv[2] || "dist/data");
const routes = JSON.parse(await readFile("data/routes.json", "utf8"));

await writeCompiledRoadSources({
  projectRoot,
  outputRoot,
  routeIds: routes.map(route => route.id)
});
const searchIndex = await buildRouteSearchIndex({ projectRoot, routes });
await mkdir(resolve(outputRoot, "_index"), { recursive: true });
await writeFile(
  resolve(outputRoot, "_index", "routes.json"),
  `${JSON.stringify(searchIndex)}\n`
);
console.log(`Compiled ${routes.length} road metadata files into ${outputRoot}`);
