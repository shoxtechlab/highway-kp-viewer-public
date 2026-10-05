import test from "node:test";
import assert from "node:assert/strict";
import { resolveRouteScope, resolveScopeBoundary } from "../js/routeScope.js";

const road = {
    sections: [
        {
            id: "west",
            route_start_km: 0,
            route_end_km: 54.41264100617079,
            local_start_kp: 0.5335249940682125,
            kp_direction: 1
        },
        {
            id: "east",
            route_start_km: 59.41264100617079,
            route_end_km: 139.69520495201456,
            local_start_kp: 100.13615674181361,
            kp_direction: 1
        }
    ]
};

test("区間内KPを通算描画位置へ変換する", () => {
    const value = resolveScopeBoundary({ section: "west", kp: 30.4 }, road);
    assert.ok(Math.abs(value - 29.86647500593179) < 1e-9);
});

test("OSM線形より外側の区間内KPは描画可能な端へ合わせる", () => {
    assert.equal(resolveScopeBoundary({ section: "west", kp: 0 }, road), 0);
});

test("異なる区間にまたがるスコープも実KPから解決する", () => {
    const group = {
        name: "事務所管内",
        home: "office/",
        routes: {
            e50: {
                start: { section: "west", kp: 30.4 },
                end: { section: "east", kp: 140.76 }
            }
        }
    };
    const scope = resolveRouteScope(group, "e50", road);
    assert.ok(Math.abs(scope.start - 29.86647500593179) < 1e-9);
    assert.ok(Math.abs(scope.end - 100.03648426435718) < 1e-9);
});

test("従来の数値スコープも維持する", () => {
    assert.equal(resolveScopeBoundary(37.5, road), 37.5);
});
