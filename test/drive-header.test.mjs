import test from "node:test";
import assert from "node:assert/strict";
import { driveTitleFontSize } from "../js/driveHeader.js";
test("drive title shrinks to available width, keeps short titles large and respects minimum", () => {
    assert.equal(driveTitleFontSize(100, 180), 18);
    assert.equal(driveTitleFontSize(180, 150), 15);
    assert.equal(driveTitleFontSize(180, 120), 12);
    assert.equal(driveTitleFontSize(400, 100), 10);
    assert.equal(driveTitleFontSize(0, 0), 18);
});
