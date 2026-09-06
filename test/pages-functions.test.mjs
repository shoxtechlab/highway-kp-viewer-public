import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { onRequestGet as getRoute } from "../functions/api/route/[routeId].js";
import { onRequestGet as getPosition } from "../functions/api/position.js";
import { onRequestGet as getNearest } from "../functions/api/nearest.js";

const bucket = {
  async get(key) {
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
