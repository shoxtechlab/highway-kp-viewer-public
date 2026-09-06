import test from "node:test";
import assert from "node:assert/strict";

import { createAppServer, handleApi } from "../local-api-server.mjs";
import { createRouteService } from "../server/route-service.js";

test("composite route converts E6 route KP to a section-local KP", async () => {
  const road = {
    id: "e6",
    sections: [
      { id: "joban", geojson: "sections/joban/route.geojson", route_start_km: 0, route_end_km: 300.4, local_start_kp: 0, kp_direction: 1 },
      { id: "sendai-tobu", geojson: "sections/sendai-tobu/route.geojson", route_start_km: 300.4, route_end_km: 323.8, local_start_kp: 1.4, kp_direction: 1 }
    ]
  };
  const geometry = chainage => JSON.stringify({
    type: "FeatureCollection",
    features: ["down", "up"].map((name, offset) => ({
      type: "Feature",
      properties: { name, chainage_m: chainage },
      geometry: { type: "LineString", coordinates: [[140, 38 + offset * 0.001], [140.2, 38 + offset * 0.001]] }
    }))
  });
  const files = {
    "road.json": JSON.stringify(road),
    "sections/joban/route.geojson": geometry([0, 300400]),
    "sections/sendai-tobu/route.geojson": geometry([1400, 24800])
  };
  const service = createRouteService(async (_routeId, fileName) => files[fileName]);
  const position = await service.getPosition({ routeId: "e6", direction: "down", kp: 320 });
  assert.equal(position.section, "sendai-tobu");
  assert.ok(Math.abs(position.localKp - 21) < 1e-9);
  assert.equal(position.routeKp, 320);
});

test("composite route accepts an endpoint affected only by floating-point rounding", async () => {
  const road = {
    id: "e6",
    sections: [
      {
        id: "sendai-hokubu",
        geojson: "sections/sendai-hokubu/route.geojson",
        route_start_km: 329.464,
        route_end_km: 342.264,
        local_start_kp: 0.7,
        kp_direction: 1
      }
    ]
  };
  const geometry = JSON.stringify({
    type: "FeatureCollection",
    features: ["down", "up"].map((name, offset) => ({
      type: "Feature",
      properties: { name, chainage_m: [700, 13500] },
      geometry: { type: "LineString", coordinates: [[140, 38 + offset * 0.001], [140.2, 38 + offset * 0.001]] }
    }))
  });
  const files = {
    "road.json": JSON.stringify(road),
    "sections/sendai-hokubu/route.geojson": geometry
  };
  const service = createRouteService(async (_routeId, fileName) => files[fileName]);
  const position = await service.getPosition({ routeId: "e6", direction: "down", kp: 342.264 });

  assert.equal(position.section, "sendai-hokubu");
  assert.ok(Math.abs(position.localKp - 13.5) < 1e-9);
  assert.equal(position.lat, 38);
  assert.equal(position.lon, 140.2);
});

test("E1A keeps the unopened KP gap and resumes the west section at 46.6 KP", async () => {
  const position = await handleApi(new URL(
    "http://local/api/position?route=e1a&direction=down&kp=46.6"
  ));
  const nearest = await handleApi(new URL(
    `http://local/api/nearest?route=e1a&lat=${position.lat}&lon=${position.lon}&preferredDirection=down`
  ));

  assert.ok(Math.abs(nearest.routeKp - 46.6) < 0.02);
  assert.ok(Math.abs(nearest.localKp - 46.6) < 0.02);
  await assert.rejects(
    () => handleApi(new URL("http://local/api/position?route=e1a&direction=down&kp=30")),
    /outside configured sections/
  );
});

test("route endpoint returns road metadata and coordinate coverage", async () => {
  const result = await handleApi(new URL("http://local/api/route/e76"));
  assert.equal(result.road.id, "e76");
  assert.ok(result.road.structures.length > 0);
  assert.ok(result.coordinateCoverage.up.start <= 0.4);
  assert.ok(result.coordinateCoverage.down.end >= 59.2);
  assert.equal("features" in result, false);
});

// Route IDs are not E-number-specific: C4 uses the same public API contract.
for (const routeId of ["c4", "e1-meishin", "e1a", "e2-sanyo", "e2a-chugoku", "e18", "e19", "e28", "e30", "e76", "e93-daini-shinmei"]) {
  test(`${routeId} supports route, position, and nearest APIs`, async () => {
    const route = await handleApi(new URL(`http://local/api/route/${routeId}`));
    for (const direction of ["up", "down"]) {
      const range = route.coordinateCoverage[direction];
      const kp = (range.start + range.end) / 2;
      const position = await handleApi(new URL(
        `http://local/api/position?route=${routeId}&direction=${direction}&kp=${kp}`
      ));
      const nearest = await handleApi(new URL(
        `http://local/api/nearest?route=${routeId}&lat=${position.lat}&lon=${position.lon}&preferredDirection=${direction}`
      ));
      assert.ok(Math.abs(nearest.kp - kp) < 0.02);
      assert.ok(nearest.distanceM < 1);
    }
  });
}

test("hyphenated composite route IDs support section-local KP", async () => {
  const route = await handleApi(new URL("http://local/api/route/e1a-shin-meishin"));
  assert.equal(route.road.id, "e1a-shin-meishin");
  const position = await handleApi(new URL(
    "http://local/api/position?route=e1a-shin-meishin&section=west&direction=down&kp=120"
  ));
  assert.equal(position.section, "west");
  assert.ok(Number.isFinite(position.lat));
  assert.ok(Number.isFinite(position.lon));
});

test("position endpoint returns one interpolated point without route geometry", async () => {
  const result = await handleApi(
    new URL("http://local/api/position?route=e76&direction=down&kp=20.5")
  );
  assert.equal(result.route, "e76");
  assert.equal(result.direction, "down");
  assert.equal(result.kp, 20.5);
  assert.ok(Number.isFinite(result.lat));
  assert.ok(Number.isFinite(result.lon));
  assert.ok(Number.isFinite(result.heading));
  assert.match(result.url, /^https:\/\/www\.google\.com\/maps\//);
  assert.equal("coordinates" in result, false);
});

test("nearest endpoint maps a known E76 point to its direction and KP", async () => {
  const result = await handleApi(new URL(
    "http://local/api/nearest?route=e76&lat=34.12895614466629&lon=133.03345313243437&preferredDirection=down"
  ));
  assert.equal(result.direction, "down");
  assert.ok(Math.abs(result.kp - 46.9) < 0.02);
  assert.ok(result.distanceM < 10);
});

test("invalid API input is rejected", async () => {
  await assert.rejects(
    handleApi(new URL("http://local/api/position?route=e76&direction=side&kp=20")),
    error => error.status === 400
  );
});

test("local server serves the app and API from one origin", async t => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  const [
    pageResponse,
    naganoPortalResponse,
    honshiPortalResponse,
    apiResponse,
    geoResponse,
    roadResponse,
    kpModuleResponse,
    matcherModuleResponse,
    streetViewModuleResponse
  ] = await Promise.all([
    fetch(`${origin}/viewer.html?route=e76`),
    fetch(`${origin}/nagano-office/`),
    fetch(`${origin}/honshi/`),
    fetch(`${origin}/api/route/e76`),
    fetch(`${origin}/data/e76/route.geojson`),
    fetch(`${origin}/data/e76/road.json`),
    fetch(`${origin}/js/kpGeo.js`),
    fetch(`${origin}/js/routeMatcher.js`),
    fetch(`${origin}/js/svEngine.js`)
  ]);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /id="app"/);
  assert.equal(naganoPortalResponse.status, 200);
  assert.match(await naganoPortalResponse.text(), /長野/);
  assert.equal(honshiPortalResponse.status, 200);
  assert.match(await honshiPortalResponse.text(), /本州四国/);
  assert.equal(apiResponse.status, 200);
  assert.equal((await apiResponse.json()).road.id, "e76");
  assert.equal(geoResponse.status, 404);
  assert.equal(roadResponse.status, 404);
  assert.equal(kpModuleResponse.status, 404);
  assert.equal(matcherModuleResponse.status, 404);
  assert.equal(streetViewModuleResponse.status, 404);
});
