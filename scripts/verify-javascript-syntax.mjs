import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const roots = ["js", "server", "functions"];
const standaloneFiles = ["build-pages.mjs"];

function collectJavaScript(path) {
    const absolute = resolve(projectRoot, path);
    if (statSync(absolute).isFile()) return /\.(?:js|mjs)$/.test(absolute) ? [absolute] : [];
    return readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
        const child = join(absolute, entry.name);
        return entry.isDirectory() ? collectJavaScript(child) : /\.(?:js|mjs)$/.test(entry.name) ? [child] : [];
    });
}

const files = [...roots, ...standaloneFiles].flatMap(collectJavaScript).sort();
const failures = [];

for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) failures.push(`${relative(projectRoot, file)}\n${result.stderr.trim()}`);
}

if (failures.length) {
    console.error(`JavaScript syntax verification failed:\n${failures.join("\n\n")}`);
    process.exitCode = 1;
} else {
    console.log(`Verified JavaScript syntax: ${files.length} files.`);
}
