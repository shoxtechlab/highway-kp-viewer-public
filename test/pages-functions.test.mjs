import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { onRequestGet as getRoute } from "../functions/api/route/[routeId].js";
import { onRequestGet as getPosition } from "../functions/api/position.js";
import { onRequestGet as getNearest } from "../functions/api/nearest.js";
import { onRequestPost as batchPosition } from "../functions/api/batch/position.js";
import { onRequestPost as batchNearest } from "../functions/api/batch/nearest.js";
import { apiHandler } from "../server/api-response.js";

const bucket = {
  async get(key) {
    if (key === "_index/routes.json") {
      return {
        text: async () => JSON.stringify({
          routes: [{
            id: "e76",
            name: "E76 西瀬戸自動車道",
            bbox: [132.95, 34.03, 133.22, 34.44]
          }]
        })
      };
    }
    try {
      const text = await readFile(new URL(`../data/${key}`, import.meta.url), "utf8");
      return { text: async () => text };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
};

test("Pages route function reads road data from the R2 binding", async () => {
  const response = await getRoute({
    env: { ROUTE_DATA: bucket },
    params: { routeId: "e76" }
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.road.id, "e76");
  assert.equal("features" in body, false);
});

test("Pages position function returns one point", async () => {
  const response = await getPosition({
    env: { ROUTE_DATA: bucket },
    request: new Request(
      "https://example.test/api/position?route=e76&direction=down&kp=20.5"
    )
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.kp, 20.5);
  assert.equal(body.directionLabel, "下り");
  assert.ok(Number.isFinite(body.lat));
  assert.equal("coordinates" in body, false);
});

test("Pages nearest function maps coordinates without exposing geometry", async () => {
  const response = await getNearest({
    env: { ROUTE_DATA: bucket },
    request: new Request(
      "https://example.test/api/nearest?route=e76&lat=34.12895614466629&lon=133.03345313243437&preferredDirection=down"
    )
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.direction, "down");
  assert.ok(Math.abs(body.kp - 46.9) < 0.02);
});

test("Pages function fails safely when R2 is not bound", async () => {
  const response = await getPosition({
    env: {},
    request: new Request(
      "https://example.test/api/position?route=e76&direction=down&kp=20.5"
    )
  });
  assert.equal(response.status, 503);
});

test("unexpected API errors do not expose internal messages", async () => {
  const response = await apiHandler(() => {
    throw new Error("C:\\private\\route-data\\secret.json");
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Internal server error." });
});

test("Pages nearest function discovers the route and accepts motion data", async () => {
  const response = await getNearest({
    env: { ROUTE_DATA: bucket },
    request: new Request(
      "https://example.test/api/nearest?lat=34.12895614466629&lon=133.03345313243437&heading=210&speed=20&accuracy=8"
    )
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.route, "e76");
  assert.equal(body.routeName, "E76 西瀬戸自動車道");
  assert.equal(body.locationAccuracyM, 8);
  assert.ok(["up", "down"].includes(body.direction));
});

test("batch position converts rows independently and requires its own admin key", async () => {
  const unauthorized = await batchPosition({
    env: { ROUTE_DATA: bucket, BATCH_API_ADMIN_KEY: "batch-secret" },
    request: new Request("https://example.test/api/batch/position", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ route: "e76", direction: "down", kp: 20.5 }] })
    })
  });
  assert.equal(unauthorized.status, 401);

  const response = await batchPosition({
    env: { ROUTE_DATA: bucket, BATCH_API_ADMIN_KEY: "batch-secret" },
    request: new Request("https://example.test/api/batch/position", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer batch-secret"
      },
      body: JSON.stringify({ records: [
        { route: "e76", direction: "down", kp: 20.5 },
        { route: "e76", direction: "sideways", kp: 20.5 }
      ] })
    })
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.equal(body.successCount, 1);
  assert.equal(body.errorCount, 1);
  assert.equal(body.results[0].status, "ok");
  assert.equal(body.results[1].status, "error");
});

test("batch nearest accepts latitude and longitude CSV-style field names", async () => {
  const response = await batchNearest({
    env: { ROUTE_DATA: bucket, BATCH_API_ADMIN_KEY: "batch-secret" },
    request: new Request("https://example.test/api/batch/nearest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": "batch-secret"
      },
      body: JSON.stringify({ records: [{
        route: "e76",
        latitude: 34.12895614466629,
        longitude: 133.03345313243437,
        direction: "down"
      }] })
    })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.successCount, 1);
  assert.equal(body.results[0].direction, "down");
  assert.ok(Math.abs(body.results[0].kp - 46.9) < 0.02);
});
