import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { d1DemoSettingsStore, memoryDemoSettingsStore, readDemoSettings, handleDemoAdminRequest, DEMO_RUNTIME_MS } from "../server/live-demo-settings.js";
import { liveDemoPosition } from "../server/live-location-demo.js";
const url = "https://example.test/api/admin/demo-cars";
const request = (method = "GET", body, key = "test-only-admin") => new Request(url, { method,
    headers: { Authorization: `Bearer ${key}`, Origin: "https://example.test", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
for (const kind of ["memory", "sqlite"]) test(`${kind}: admin defaults off, validates settings, persists start, stops independently and all`, async () => {
    let db;
    let store = memoryDemoSettingsStore();
    if (kind === "sqlite") {
        db = new DatabaseSync(":memory:");
        db.exec(await readFile(new URL("../migrations/0005_live_demo_settings.sql", import.meta.url), "utf8"));
        store = d1DemoSettingsStore({ prepare(sql) { const statement = db.prepare(sql); return {
            bind(...args) { return { async first() { return statement.get(...args); }, async run() { statement.run(...args); } }; },
            async run() { statement.run(); }
        }; } });
    }
    try {
        let time = Date.now();
        const handle = r => handleDemoAdminRequest(r, { store, adminKey: "test-only-admin", now: () => time });
        assert.equal((await handle(request("GET", null, "wrong"))).status, 401);
        const response = await handle(request());
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        const { configs } = await response.json();
        assert.deepEqual(configs.map(c => [c.routeId, c.startKp, c.direction, c.enabled]), [["e28", 44.4, "down", false], ["e30", 0, "down", false], ["e76", 0, "down", false]]);
        const input = { routeId: "e28", enabled: true, startKp: 44.4, direction: "up", speedKmh: 80 };
        assert.equal((await handle(request("PUT", { ...input, startKp: 90 }))).status, 400);
        assert.equal((await handle(request("PUT", { ...input, direction: "invalid" }))).status, 400);
        assert.equal((await handle(request("PUT", input))).status, 200);
        assert.equal((await readDemoSettings(store, "e28")).startedAt, time);
        assert.equal(liveDemoPosition(await readDemoSettings(store, "e28"), "e28", time + 360000).kp, 36.4);
        const deadline = time + DEMO_RUNTIME_MS;
        assert.equal((await readDemoSettings(store, "e28", deadline - 1)).enabled, true);
        assert.equal((await readDemoSettings(store, "e28", deadline)).enabled, false);
        assert.equal(liveDemoPosition(await readDemoSettings(store, "e28", deadline), "e28", deadline), null);
        assert.equal((await readDemoSettings(store, "e28", deadline + 24 * DEMO_RUNTIME_MS)).enabled, false);
        time = deadline;
        const restarted = await (await handle(request("PUT", input))).json();
        assert.equal(restarted.configs[0].enabled, true);
        assert.equal(restarted.configs[0].expiresAt, deadline + DEMO_RUNTIME_MS);
        time += 10000;
        await handle(request("PUT", { ...input, routeId: "e30", startKp: 10 }));
        await handle(request("PUT", { routeId: "e28", enabled: false }));
        assert.equal((await readDemoSettings(store, "e28")).enabled, false);
        assert.equal((await readDemoSettings(store, "e30")).enabled, true);
        await handle(request("POST", { action: "stopAll" }));
        assert.equal((await readDemoSettings(store, "e30")).enabled, false);
        assert.equal(await readDemoSettings(store, "e4"), null);
        const foreign = new Request(url, { method: "POST", headers: { Authorization: "Bearer test-only-admin", Origin: "https://foreign.test", "Content-Type": "application/json" }, body: '{"action":"stopAll"}' });
        assert.equal((await handle(foreign)).status, 403);
    } finally { db?.close(); }
});
test("authentication is checked before reading or changing stored settings", async () => {
    let calls = 0;
    const store = { get() { calls++; }, set() { calls++; }, stopAll() { calls++; } };
    const response = await handleDemoAdminRequest(request("POST", { action: "stopAll" }, "wrong"), { store, adminKey: "test-only-admin" });
    assert.equal(response.status, 401); assert.equal(calls, 0);
});
