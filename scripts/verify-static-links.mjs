import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const outputRoot = resolve(process.cwd(), "dist");

async function listHtml(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listHtml(path));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(path);
  }
  return files;
}

async function exists(path) {
  try {
    const info = await stat(path);
    if (info.isDirectory()) return exists(join(path, "index.html"));
    return info.isFile();
  } catch {
    return false;
  }
}

function targetPath(sourceFile, rawReference) {
  const reference = rawReference.trim();
  if (!reference || reference.startsWith("#")) return null;
  if (/^(?:[a-z]+:)?\/\//i.test(reference)) return null;
  if (/^(?:data|mailto|tel|javascript):/i.test(reference)) return null;

  const pathname = reference.split(/[?#]/, 1)[0];
  if (!pathname || pathname.startsWith("/api/")) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  return decoded.startsWith("/")
    ? resolve(outputRoot, `.${decoded}`)
    : resolve(dirname(sourceFile), decoded);
}

const failures = [];
for (const sourceFile of await listHtml(outputRoot)) {
  const source = await readFile(sourceFile, "utf8");
  const references = [...source.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)]
    .map(match => match[1]);
  for (const reference of references) {
    const target = targetPath(sourceFile, reference);
    if (!target) continue;
    if (!target.startsWith(`${outputRoot}${sep}`) && target !== outputRoot) {
      failures.push(`${relative(outputRoot, sourceFile)} -> ${reference} (outside dist)`);
      continue;
    }
    if (!await exists(target)) {
      failures.push(`${relative(outputRoot, sourceFile)} -> ${reference}`);
    }
  }
}

if (failures.length) {
  throw new Error(`Broken static references:\n${failures.sort().join("\n")}`);
}

console.log("Verified static links: all local HTML references exist.");
