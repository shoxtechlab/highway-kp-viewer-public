import test from "node:test";
import assert from "node:assert/strict";
import { layoutOrderedUserLabels, normalizeLocalJsonImport, readSvgLabelVerticalRange } from "../js/editorPreview.js";

test("JSON import is forced to the current device and current route", () => {
  const result = normalizeLocalJsonImport({ records: [
    {
      id: "local-1",
      routeId: "e28",
      geometryType: "point",
      startKp: 25.4,
      direction: "down",
      type: "incident",
      name: "落下物",
      visibility: "public",
      colors: { primary: "#d92d20", secondary: "#fff1f0" }
    },
    { id: "other", routeId: "e30", startKp: 3, name: "別路線" }
  ] }, "e28");

  assert.equal(result.records.length, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.records[0].visibility, "private");
  assert.equal(result.records[0].routeId, "e28");
});

test("JSON import accepts a bare array and validates sections", () => {
  const result = normalizeLocalJsonImport([{
    routeId: "e28",
    geometryType: "section",
    startKp: 10,
    endKp: 11.2,
    name: "工事区間",
    type: "construction"
  }], "e28", { createId: () => "generated-id" });
  assert.equal(result.records[0].id, "generated-id");
  assert.equal(result.records[0].endKp, 11.2);
  assert.throws(() => normalizeLocalJsonImport([{
    geometryType: "section",
    startKp: 10,
    endKp: 9,
    name: "不正区間"
  }], "e28"), /終点KP/);
});

test("JSON import accepts uppercase equipment type names", () => {
  for (const type of ["TC", "ITS", "CCTV"]) {
    const result = normalizeLocalJsonImport([{
      id: `equipment-${type}`,
      startKp: 20,
      name: type,
      type
    }], "e28");
    assert.equal(result.records[0].type, type.toLowerCase());
    assert.notEqual(result.records[0].colors.primary, "#59636d");
  }
});

test("additional labels preserve KP order so their connectors do not cross", () => {
  const candidates = [
    { id: "later", desiredY: 108 },
    { id: "earlier", desiredY: 100 },
    { id: "latest", desiredY: 116 }
  ];
  const placed = layoutOrderedUserLabels(candidates, [], 300);
  assert.deepEqual(placed.map(item => item.candidate.id), ["earlier", "later", "latest"]);
  assert.ok(placed[0].y < placed[1].y);
  assert.ok(placed[1].y < placed[2].y);
});

test("additional labels avoid existing facility label ranges", () => {
  const [placed] = layoutOrderedUserLabels([{ id: "item", desiredY: 100 }], [[80, 120]], 300);
  assert.ok(placed.y + 14 <= 80 || placed.y - 14 >= 120);
});

test("print layout reads label bounds from rect attributes when getBBox is unavailable", () => {
  const label = {
    getBBox() { throw new Error("detached SVG"); },
    querySelector() {
      return { getAttribute: name => ({ y: "86", height: "28" })[name] };
    }
  };
  assert.deepEqual(readSvgLabelVerticalRange(label), [83, 117]);
});
