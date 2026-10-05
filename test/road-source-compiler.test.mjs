import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRoadSource } from "../lib/roadSourceCompiler.mjs";

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value));
}

test("legacy road.json is used for an unmigrated route", async () => {
  const root = await mkdtemp(join(tmpdir(), "road-source-"));
  await mkdir(join(root, "data", "e1"), { recursive: true });
  await writeJson(join(root, "data", "e1", "road.json"), {
    id: "e1", facilities: [], structures: []
  });
  assert.equal((await loadRoadSource(root, "e1")).id, "e1");
});

test("an incomplete split source fails instead of falling back", async () => {
  const root = await mkdtemp(join(tmpdir(), "road-source-"));
  await mkdir(join(root, "data", "e1"), { recursive: true });
  await mkdir(join(root, "data-source", "e1"), { recursive: true });
  await writeJson(join(root, "data", "e1", "road.json"), { id: "legacy" });
  await writeJson(join(root, "data-source", "e1", "metadata.json"), { id: "e1" });
  await assert.rejects(() => loadRoadSource(root, "e1"), /split source is incomplete/);
});

test("split source compiles to the compatibility object", async () => {
  const root = await mkdtemp(join(tmpdir(), "road-source-"));
  const source = join(root, "data-source", "e1");
  await mkdir(source, { recursive: true });
  await writeJson(join(source, "metadata.json"), { id: "e1", name: "route" });
  await writeJson(join(source, "network.json"), { length: 1 });
  await writeJson(join(source, "facilities.json"), { facilities: [{ name: "IC" }] });
  await writeJson(join(source, "structures.json"), { structures: [{ name: "bridge" }] });
  assert.deepEqual(await loadRoadSource(root, "e1"), {
    id: "e1", name: "route", length: 1,
    structures: [{ name: "bridge" }], facilities: [{ name: "IC" }]
  });
});
