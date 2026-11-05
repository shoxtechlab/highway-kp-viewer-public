// 公開資料のみを検証する。内部パイプライン文書や路線データは走査しない。
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

const root = process.cwd();
const files = ["README.md", "VERSIONING.md", ...(await readdir(join(root, "docs")))
    .filter(name => name.endsWith(".md")).map(name => `docs/${name}`)];
const failures = [];
const cache = new Map();
const withoutFences = value => value.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
const slug = value => value.replace(/<[^>]*>/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "").replace(/\s/g, "-");

async function headings(path) {
    if (!cache.has(path)) {
        const source = withoutFences(await readFile(path, "utf8"));
        const seen = new Map();
        cache.set(path, new Set([...source.matchAll(/^#{1,6}\s+(.+)$/gm)].map(match => {
            const base = slug(match[1]);
            const count = seen.get(base) || 0;
            seen.set(base, count + 1);
            return count ? `${base}-${count}` : base;
        })));
    }
    return cache.get(path);
}

for (const file of files) {
    const source = withoutFences(await readFile(resolve(root, file), "utf8"));
    const titles = [...source.matchAll(/^#\s+/gm)];
    if (titles.length !== 1) failures.push(`${file}: top-level title count is ${titles.length}`);
    for (const match of source.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
        const url = match[1];
        if (/^[a-z][a-z\d+.-]*:/i.test(url)) continue;
        const [pathname, fragment] = url.split("#", 2);
        const target = pathname ? resolve(dirname(resolve(root, file)), decodeURIComponent(pathname.split("?")[0])) : resolve(root, file);
        try {
            await stat(target);
            if (fragment && extname(target) === ".md" && !(await headings(target)).has(decodeURIComponent(fragment))) {
                failures.push(`${file}: missing heading ${url}`);
            }
        } catch {
            failures.push(`${file}: missing target ${url}`);
        }
    }
}
if (failures.length) throw new Error(failures.join("\n"));
console.log(`Verified ${files.length} public Markdown documents: local links, images, headings and titles.`);
