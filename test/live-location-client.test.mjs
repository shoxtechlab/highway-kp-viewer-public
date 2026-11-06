import test from "node:test";
import assert from "node:assert/strict";
import { createLivePublisher } from "../js/liveLocations.js";

const flush = () => new Promise(resolve => setImmediate(resolve));
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
