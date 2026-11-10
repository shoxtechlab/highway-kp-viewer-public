import test from "node:test";
import assert from "node:assert/strict";

import {
  apiIsEnabled,
  consumeDailyApiRequest,
  dailyApiLimit,
  isProtectedBatchApiPath,
  isRouteApiPath,
  utcUsageWindow
} from "../server/api-usage-guard.js";

test("route-data and live-location APIs are guarded", () => {
  assert.equal(isRouteApiPath("/api/route/e28"), true);
  assert.equal(isRouteApiPath("/api/position"), true);
  assert.equal(isRouteApiPath("/api/nearest"), true);
  assert.equal(isRouteApiPath("/api/batch/position"), true);
  assert.equal(isRouteApiPath("/api/batch/nearest"), true);
  assert.equal(isRouteApiPath("/api/live-locations"), true);
  assert.equal(isRouteApiPath("/api/annotations"), false);
  assert.equal(isProtectedBatchApiPath("/api/batch/position"), true);
  assert.equal(isProtectedBatchApiPath("/api/position"), false);
});

test("live and route quota use independent tables and preserve atomic limits", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE api_daily_usage (usage_date TEXT PRIMARY KEY, request_count INTEGER, updated_at TEXT)");
  const store = { prepare(sql) { return { async run() { db.exec(sql); }, bind(...args) { return { async first() { return db.prepare(sql).get(...args); } }; } }; } };
  try {
    assert.equal((await consumeDailyApiRequest(store, { limit: 1, bucket: "live" })).allowed, true);
    assert.equal((await consumeDailyApiRequest(store, { limit: 1, bucket: "live" })).allowed, false);
    assert.equal((await consumeDailyApiRequest(store, { limit: 1 })).allowed, true);
    assert.equal((await consumeDailyApiRequest(store, { limit: 1 })).allowed, false);
    const { onRequest } = await import("../functions/_middleware.js");
    const next = async () => Response.json({ ok: true });
    const env = { ANNOTATIONS_DB: store, API_DAILY_LIMIT: "1", LIVE_LOCATIONS_DAILY_REQUESTS: "2" };
    const context = (path, method = "GET") => ({ request: new Request(`https://example.test${path}`, { method }), env, next });
    assert.equal((await onRequest(context("/api/position"))).status, 429);
    const live = await onRequest(context("/api/live-locations?route=e28"));
    assert.equal(live.status, 200);
    assert.equal(live.headers.get("X-RateLimit-Limit"), "2");
    assert.equal((await onRequest(context("/api/live-locations?route=e28"))).status, 429);
    assert.equal((await onRequest(context("/api/live-locations", "DELETE"))).status, 200);
  } finally { db.close(); }
});

test("emergency switch defaults on and recognizes false values", () => {
  assert.equal(apiIsEnabled(undefined), true);
  assert.equal(apiIsEnabled("false"), false);
  assert.equal(apiIsEnabled("OFF"), false);
});

test("daily limit defaults to fifty thousand", () => {
  assert.equal(dailyApiLimit(undefined), 50_000);
  assert.equal(dailyApiLimit("25000"), 25_000);
});

test("usage day resets at UTC midnight", () => {
  assert.deepEqual(utcUsageWindow(new Date("2026-09-29T12:34:56Z")), {
    day: "2026-09-29",
    resetAt: "2026-09-30T00:00:00.000Z"
  });
});
