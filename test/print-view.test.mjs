import test from "node:test";
import assert from "node:assert/strict";
import { buildPrintSlices } from "../js/printView.js";

test("print range is divided into page-height slices without changing scale", () => {
  assert.deepEqual(buildPrintSlices(2500, 1000), [
    { y: 0, height: 1000 },
    { y: 1000, height: 1000 },
    { y: 2000, height: 500 }
  ]);
});
