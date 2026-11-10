import test from "node:test";
import assert from "node:assert/strict";
import { createLivePublisher, createLiveLocationReader } from "../js/liveLocations.js";

const flush = () => new Promise(resolve => setImmediate(resolve));
test("reader adapts polling to focus, visibility, empty results and quota reset", async t => {
    const original = Object.fromEntries(["fetch", "document", "window", "setTimeout", "clearTimeout", "setInterval", "clearInterval"].map(k => [k, globalThis[k]]));
    t.after(() => Object.assign(globalThis, original));
    const timers = new Map(), events = new Map(); let id = 0, focused = true, calls = 0, empty = false, limited = false;
    globalThis.setTimeout = (fn, ms) => { timers.set(++id, { fn, ms }); return id; };
    globalThis.clearTimeout = key => timers.delete(key);
    globalThis.setInterval = () => 1; globalThis.clearInterval = () => {};
    const addEventListener = (name, fn) => events.set(name, fn), removeEventListener = name => events.delete(name);
    globalThis.document = { hidden: false, hasFocus: () => focused, addEventListener, removeEventListener };
    globalThis.window = { addEventListener, removeEventListener };
    const reset = Date.now() + 3_600_000;
    globalThis.fetch = async () => { calls++; return limited
        ? Response.json({ resetAt: new Date(reset).toISOString() }, { status: 429 })
        : Response.json({ enabled: true, serverNow: Date.now(), positions: empty ? [] : [{ expiresAt: Date.now() + 30_000 }] }); };
    const reader = createLiveLocationReader({ routeId: "e28", onChange: () => {} });
    const delay = () => [...timers.values()][0]?.ms;
    const tick = async () => { const timer = [...timers.values()][0]; timers.clear(); timer.fn(); await flush(); };
    assert.equal(calls, 0);
    reader.setVisible(true); await flush(); assert.equal(calls, 1); assert.equal(delay(), 10_000);
    focused = false; events.get("blur")(); assert.equal(delay(), 30_000);
    await tick(); assert.equal(delay(), 30_000);
    focused = true; events.get("focus")(); await flush(); assert.equal(delay(), 10_000);
    empty = true; await tick(); assert.equal(delay(), 30_000);
    await tick(); await tick(); assert.equal(delay(), 60_000);
    document.hidden = true; events.get("visibilitychange")(); assert.equal(timers.size, 0);
    document.hidden = false; events.get("visibilitychange")(); await flush();
    reader.setVisible(false); assert.equal(timers.size, 0);
    const before = calls; reader.setVisible(true); await flush(); assert.equal(calls, before + 1);
    limited = true; await tick(); assert.ok(delay() > 3_500_000);
    const after = calls; reader.setVisible(false); reader.setVisible(true); await flush(); assert.equal(calls, after);
    reader.stop(); assert.equal(timers.size, 0); assert.equal(events.size, 0);
});
test("publication requires opt-in, withdraws on stale/offroad state and ignores a late create after opt-out", async t => {
    const previous = { fetch: globalThis.fetch, document: globalThis.document, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
    t.after(() => Object.assign(globalThis, previous));
    globalThis.document = { hidden: false };
    const timers = new Map(); let nextTimer = 0;
    globalThis.setInterval = callback => { timers.set(++nextTimer, callback); return nextTimer; };
    globalThis.clearInterval = id => timers.delete(id);
    const calls = [], statuses = []; let position = { routeId: "e28", direction: "down", routeKp: 10, kp: 10, measuredAt: Date.now() };
    let release;
    globalThis.fetch = async (url, options = {}) => {
        calls.push({ url, method: options.method || "GET" });
        if (String(url).includes("status=1")) return Response.json({ enabled: true });
        if (options.method === "POST") return new Promise(resolve => { release = () => resolve(Response.json({ token: "a".repeat(64), label: "ユーザー001" })); });
        if (options.method === "DELETE") return Response.json({ removed: true });
        throw new Error("Unexpected request");
    };
    const publisher = createLivePublisher({ getPosition: () => position, onStatus: status => statuses.push(status) });
    assert.equal(calls.length, 0);
    await publisher.setEnabled(true);
    assert.equal(calls.filter(call => call.method === "POST").length, 1);
    await publisher.setEnabled(false);
    release(); await flush(); await flush();
    assert.equal(calls.filter(call => call.method === "DELETE").length, 1);
    assert.equal(statuses.some(status => status.state === "public"), false);
    assert.equal(timers.size, 0);

    globalThis.fetch = async (url, options = {}) => {
        calls.push({ url, method: options.method || "GET" });
        return Response.json(String(url).includes("status=1") ? { enabled: true } : options.method === "POST" ? { token: "b".repeat(64), label: "ユーザー002" } : { removed: true });
    };
    await publisher.setEnabled(true); await flush();
    assert.equal(statuses.at(-1).state, "public");
    position = null;
    for (const callback of timers.values()) await callback();
    await flush();
    assert.equal(statuses.at(-1).state, "waiting");
    assert.equal(calls.filter(call => call.method === "DELETE").length, 2);
    publisher.stop(); assert.equal(timers.size, 0);
});
