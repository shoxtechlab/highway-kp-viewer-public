import test from "node:test";
import assert from "node:assert/strict";
import { createSelectionUrl, readSelectionFromSearch } from "../js/selectionUrl.js";

test("selection URL preserves portal and scope parameters", () => {
    const url = createSelectionUrl(
        "https://example.test/viewer.html?route=e6&scope=test&portal=national",
        { direction: "down", kp: "12.4", kpSystemId: "sendai-tobu" }
    );
    assert.equal(url.searchParams.get("route"), "e6");
    assert.equal(url.searchParams.get("scope"), "test");
    assert.equal(url.searchParams.get("portal"), "national");
    assert.equal(url.searchParams.get("direction"), "down");
    assert.equal(url.searchParams.get("kp"), "12.4");
    assert.equal(url.searchParams.get("kpSystem"), "sendai-tobu");
});

test("selection URL parser rejects incomplete selections", () => {
    assert.deepEqual(readSelectionFromSearch("?direction=up&kp=２５．５&kpSystem=route"), {
        direction: "up",
        kp: 25.5,
        kpSystemId: "route"
    });
    assert.equal(readSelectionFromSearch("?direction=up"), null);
    assert.equal(readSelectionFromSearch("?direction=side&kp=10"), null);
});
