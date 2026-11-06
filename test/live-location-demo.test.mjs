import test from "node:test";
import assert from "node:assert/strict";
import { liveDemoPosition } from "../server/live-location-demo.js";
const config = { enabled: true, startedAt: 1000, startKp: 44.4, endKp: 89, speedKmh: 80 };
const at = hours => liveDemoPosition(config, "e28", 1000 + hours * 3_600_000);
test("demo starts at Tsuna down, reflects at both endpoints and repeats at 80km/h", () => {
    assert.equal(at(0).kp, 44.4);
    assert.equal(at(0).direction, "down");
    assert.equal(at(0.1).kp, 52.4);
    assert.equal(at((89 - 44.4 + 8) / 80).kp, 81);
    assert.equal(at((89 - 44.4 + 8) / 80).direction, "up");
    assert.equal(at((178 - 44.4 + 8) / 80).kp, 8);
    assert.equal(at((178 - 44.4 + 8) / 80).direction, "down");
    assert.equal(at(178 / 80).kp, 44.4);
});
test("demo is absent when disabled, invalid or on other routes", () => {
    assert.equal(liveDemoPosition(undefined, "e28"), null);
    assert.equal(liveDemoPosition("bad json", "e28"), null);
    assert.equal(liveDemoPosition({ ...config, enabled: false }, "e28"), null);
    assert.equal(liveDemoPosition(config, "e30"), null);
    assert.equal(liveDemoPosition({ ...config, endKp: 0 }, "e28"), null);
});
test("E30 and E76 have independent identities and endpoints without changing E28", () => {
    for (const [routeId, endKp] of [["e30", 37.3], ["e76", 59.2]]) {
        const own = { ...config, routeId, startKp: 0, endKp };
        const start = liveDemoPosition(own, routeId, 1000);
        assert.equal(start.id, `demo-${routeId}`);
        assert.equal(start.direction, "down");
        assert.equal(start.kp, 0);
        const returned = liveDemoPosition(own, routeId, 1000 + (endKp + 1) / 80 * 3_600_000);
        assert.equal(returned.direction, "up");
        assert.equal(returned.kp, Math.round((endKp - 1) * 10) / 10);
        assert.equal(liveDemoPosition(own, "e28", 1000), null);
    }
    assert.equal(at(0).kp, 44.4);
});
test("an up-direction start counts down, then returns on the down side", () => {
    const up = { ...config, direction: "up" };
    assert.equal(liveDemoPosition(up, "e28", 1000).direction, "up");
    assert.equal(liveDemoPosition(up, "e28", 1000 + 360000).kp, 36.4);
    const turned = liveDemoPosition(up, "e28", 1000 + (44.4 + 8) / 80 * 3600000);
    assert.equal(turned.direction, "down"); assert.equal(turned.kp, 8);
});
test("demo expiry is capped at its shutdown time, including the last listing before shutdown", () => {
    const expiresAt = 1000 + 3600000;
    const limited = { ...config, expiresAt };
    assert.equal(liveDemoPosition(limited, "e28", expiresAt - 1000).expiresAt, expiresAt);
    assert.equal(liveDemoPosition(limited, "e28", expiresAt), null);
});
