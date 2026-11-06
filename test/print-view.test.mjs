import test from "node:test";
import assert from "node:assert/strict";
import { buildPrintSlices, isIosStandalone, createPrintDocument } from "../js/printView.js";

test("print range is divided into page-height slices without changing scale", () => {
  assert.deepEqual(buildPrintSlices(2500, 1000), [
    { y: 0, height: 1000 },
    { y: 1000, height: 1000 },
    { y: 2000, height: 500 }
  ]);
});

test("inline preview is limited to iOS/iPadOS standalone and not viewport width", () => {
  assert.equal(isIosStandalone({ userAgent: "iPhone", standalone: true }), true);
  assert.equal(isIosStandalone({ userAgent: "iPad", displayModeStandalone: true }), true);
  assert.equal(isIosStandalone({ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5, standalone: true }), true);
  assert.equal(isIosStandalone({ userAgent: "iPhone", standalone: false }), false);
  assert.equal(isIosStandalone({ userAgent: "Android", displayModeStandalone: true, maxTouchPoints: 5 }), false);
  assert.equal(isIosStandalone({ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 0, displayModeStandalone: true }), false);
  assert.equal(isIosStandalone({ userAgent: "Windows", platform: "Win32", maxTouchPoints: 10, standalone: true }), false);
});

test("inline print document has no automatic script; existing separate window keeps automatic printing", () => {
  const previous = globalThis.XMLSerializer;
  globalThis.XMLSerializer = class { serializeToString() { return "<svg/>"; } };
  try {
    const svg = { viewBox: { baseVal: { height: 1040 } }, cloneNode() { return { setAttribute() {} }; } };
    const options = { svg, title: "E28 <試験>", rangeLabel: "0〜10KP" };
    const inline = createPrintDocument({ ...options, autoPrint: false });
    assert.ok(!inline.includes("<script>"));
    assert.ok(inline.includes("E28 &lt;試験&gt;"));
    assert.ok(inline.includes('name="viewport"'));
    assert.ok(createPrintDocument(options).includes("setTimeout(()=>print(),250)"));
  } finally { globalThis.XMLSerializer = previous; }
});
