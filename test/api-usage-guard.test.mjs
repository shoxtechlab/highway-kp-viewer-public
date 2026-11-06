import test from "node:test";
import assert from "node:assert/strict";

import {
  apiIsEnabled,
  dailyApiLimit,
  isProtectedBatchApiPath,
  isRouteApiPath,
  utcUsageWindow
} from "../server/api-usage-guard.js";

test("route-data and live-location APIs share the daily safety guard", () => {
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
