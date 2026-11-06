import { readdir } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

const projectRoot = process.cwd();
const outputRoot = join(projectRoot, "dist");
const forbiddenNames = new Set([
  "road.json",
  "route.geojson",
  "kp_calibration.json"
]);
const forbiddenSegments = new Set([
  "private-notes",
  "data-source",
  ".compiled-route-data"
]);
const forbiddenBrowserModules = new Set([
  "js/kpGeo.js",
  "js/routeMatcher.js",
  "js/svEngine.js"
]);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const violations = [];
for (const path of await listFiles(outputRoot)) {
  const relativePath = relative(outputRoot, path).split(sep).join("/");
  const segments = relativePath.split("/");
  if (forbiddenNames.has(basename(path))) violations.push(relativePath);
  if (segments.some(segment => forbiddenSegments.has(segment))) violations.push(relativePath);
  if (forbiddenBrowserModules.has(relativePath)) violations.push(relativePath);
  if (/calibration/i.test(relativePath)) violations.push(relativePath);
}

const uniqueViolations = [...new Set(violations)].sort();
if (uniqueViolations.length) {
  throw new Error(
    `Public build contains private route artifacts:\n${uniqueViolations.join("\n")}`
  );
}

console.log("Verified public build: no private route artifacts found.");
