import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { createLiveLocationService, memoryLiveLocationStore, d1LiveLocationStore } from "../server/live-location-service.js";
import { handleLiveLocationRequest, cloudLiveLocationService } from "../server/live-location-handler.js";
import { drivePublicPosition } from "../js/liveLocations.js";
import { onRequest as middleware } from "../functions/_middleware.js";

const origin = "https://example.test";
const fix = time => ({ routeId: "e6", direction: "down", routeKp: 302.245, kp: 2.245, kpSystemId: "sendai-tobu", measuredAt: time });
function setup(store = memoryLiveLocationStore(), dailyLimit) {
    let time = Date.parse("2026-11-06T00:00:00Z");
    const service = createLiveLocationService(store, { routeIds: async () => ["e6", "e28"], now: () => time, dailyLimit });
    return { service, time: () => time, advance: ms => { time += ms; } };
}

for (const kind of ["memory", "D1-compatible SQLite"]) test(`${kind}: numbering, route change, expiry and own-token deletion`, async () => {
    let sqlite;
    if (kind !== "memory") {
        sqlite = new DatabaseSync(":memory:");
        sqlite.exec(await readFile(new URL("../migrations/0003_live_locations.sql", import.meta.url), "utf8"));
        sqlite.exec(await readFile(new URL("../migrations/0004_live_location_demo.sql", import.meta.url), "utf8"));
    }
    const db = sqlite && {
        prepare(sql) { return { bind(...args) { const stmt = sqlite.prepare(sql); return {
            async first() { return stmt.get(...args) || null; }, async all() { return { results: stmt.all(...args) }; }, async run() { stmt.run(...args); }
        }; } }; },
        async batch(statements) { sqlite.exec("BEGIN"); try { for (const statement of statements) await statement.run(); sqlite.exec("COMMIT"); } catch (error) { sqlite.exec("ROLLBACK"); throw error; } }
    };
    try {
        const { service, time, advance } = setup(db ? d1LiveLocationStore(db) : memoryLiveLocationStore());
        const a = await service.create(fix(time()));
        const b = await service.create({ ...fix(time()), demo: true });
        assert.equal(a.label, "ユーザー001"); assert.equal(b.label, "デモ・ユーザー002");
        assert.equal(b.demo, true);
        assert.equal(a.kp, 2.2); assert.equal(a.routeKp, 302.2);
        const list = await service.list("e6");
        assert.equal(list.positions.length, 2);
        assert.equal("token" in list.positions[0], false);
        assert.equal("tokenHash" in list.positions[0], false);
        assert.equal("lat" in list.positions[0], false);
        await assert.rejects(service.update(a.token, fix(time())), error => error.status === 429);
        advance(10_000);
        await service.update(a.token, { ...fix(time()), routeId: "e28", kp: 10.1, routeKp: 10.1 });
        assert.equal((await service.list("e6")).positions.length, 1);
        assert.equal((await service.list("e28")).positions[0].id, a.id);
        await service.remove(b.token);
        assert.deepEqual((await service.list("e6")).positions, []);
        await assert.rejects(service.update(b.token, fix(time())), error => error.status === 404);
        advance(30_001);
        assert.deepEqual((await service.list("e28")).positions, []);
        await assert.rejects(service.update(a.token, fix(time())), error => error.status === 404);
    } finally { sqlite?.close(); }
});

test("invalid, stale and unknown-route positions are refused; budget still permits stopping", async () => {
    const { service, time, advance } = setup(undefined, 1);
    await assert.rejects(service.create({ ...fix(time()), measuredAt: time() - 16000 }), error => error.status === 400);
    await assert.rejects(service.create({ ...fix(time()), routeId: "e999" }), error => error.status === 400);
    await assert.rejects(service.create({ ...fix(time()), kp: -1 }), error => error.status === 400);
    const a = await service.create(fix(time())); advance(10000);
    await assert.rejects(service.update(a.token, fix(time())), error => error.status === 429);
    await service.remove(a.token);
    assert.deepEqual((await service.list("e6")).positions, []);
});

test("only fresh, confirmed, accurate on-road driving positions are eligible; local KP stays distinct", () => {
    const time = Date.now();
    const input = { driving: true, demo: false, onRoad: true, confirmed: true, measuredAt: time, accuracy: 10,
        match: { route: "e6", direction: "down", routeKp: 302.2, localKp: 2.2, distanceM: 5 } };
    assert.equal(drivePublicPosition(input, time).kp, 2.2);
    assert.equal(drivePublicPosition({ ...input, demo: true }, time).demo, true);
    for (const change of [{ driving: false }, { onRoad: false }, { confirmed: false }, { measuredAt: time - 11000 }, { accuracy: 200 }, { match: { ...input.match, distanceM: 200 } }]) {
        assert.equal(drivePublicPosition({ ...input, ...change }, time), null);
    }
});

test("HTTP is no-store, disabled by default, bounded and same-origin for mutations", async () => {
    assert.equal(cloudLiveLocationService({}), null);
    const disabled = await handleLiveLocationRequest(new Request(`${origin}/api/live-locations?status=1`), null);
    assert.equal((await disabled.json()).enabled, false);
    assert.equal(disabled.headers.get("Cache-Control"), "no-store");
    const { service, time } = setup();
    const post = (body, source = origin) => new Request(`${origin}/api/live-locations`, {
        method: "POST", headers: { Origin: source, "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    assert.equal((await handleLiveLocationRequest(post(fix(time()), "https://foreign.test"), service)).status, 403);
    assert.equal((await handleLiveLocationRequest(post({ extra: "x".repeat(3000) }), service)).status, 413);
    const response = await handleLiveLocationRequest(post(fix(time())), service);
    assert.equal(response.status, 200);
    const record = await response.json();
    const stopped = await handleLiveLocationRequest(new Request(`${origin}/api/live-locations`, { method: "DELETE", headers: { Authorization: `Bearer ${record.token}` } }), service);
    assert.equal(stopped.status, 200);
    assert.deepEqual((await service.list("e6")).positions, []);
});

test("daily request cap blocks location updates but never prevents own-session deletion", async () => {
    const db = { prepare() { return { bind() { return { async first() { return null; } }; } }; } };
    let nextCalls = 0;
    const next = () => { nextCalls++; return Response.json({ ok: true }); };
    const limited = await middleware({ request: new Request(`${origin}/api/live-locations`, { method: "POST" }), env: { ANNOTATIONS_DB: db }, next });
    assert.equal(limited.status, 429); assert.equal(nextCalls, 0);
    const removal = await middleware({ request: new Request(`${origin}/api/live-locations`, { method: "DELETE" }), env: {}, next });
    assert.equal(removal.status, 200); assert.equal(nextCalls, 1);
});
