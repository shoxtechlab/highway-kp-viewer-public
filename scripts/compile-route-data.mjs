import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { writeCompiledRoadSources } from "../lib/roadSourceCompiler.mjs";

const projectRoot = process.cwd();
const outputRoot = resolve(process.argv[2] || "dist/data");
const routes = JSON.parse(await readFile("data/routes.json", "utf8"));

await writeCompiledRoadSources({
  projectRoot,
  outputRoot,
  routeIds: routes.map(route => route.id)
});
console.log(`Compiled ${routes.length} road metadata files into ${outputRoot}`);
