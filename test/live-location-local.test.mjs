import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../local-api-server.mjs";

test("local API shares positions across clients and accepts trusted HTTPS proxy origins", async () => {
    const server = createAppServer();
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        const response = await fetch(`${base}/api/live-locations`, {
            method: "POST", headers: { "Content-Type": "application/json", Origin: "https://preview.test",
                "X-Forwarded-Proto": "https", "X-Forwarded-Host": "preview.test" },
            body: JSON.stringify({ routeId: "e28", direction: "down", routeKp: 10.24, kp: 10.24, measuredAt: Date.now() })
        });
        assert.equal(response.status, 200);
        const posted = await response.json();
        const list = await (await fetch(`${base}/api/live-locations?route=e28`)).json();
        assert.equal(list.positions[0].label, "ユーザー001");
        assert.equal(list.positions[0].kp, 10.2);
        assert.equal("token" in list.positions[0], false);
        await fetch(`${base}/api/live-locations`, { method: "DELETE", headers: { Authorization: `Bearer ${posted.token}` } });
        assert.deepEqual((await (await fetch(`${base}/api/live-locations?route=e28`)).json()).positions, []);
    } finally { await new Promise(resolve => server.close(resolve)); }
});
test("local administrator starts a visible up-direction demo and stops all without deployment", async () => {
    const previous = process.env.ANNOTATIONS_ADMIN_KEY;
    process.env.ANNOTATIONS_ADMIN_KEY = "local-test-admin";
    const server = createAppServer();
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        const admin = (method, body) => fetch(`${base}/api/admin/demo-cars`, { method, headers: { Authorization: "Bearer local-test-admin", "Content-Type": "application/json", Origin: base }, body: JSON.stringify(body) });
        const response = await admin("PUT", { routeId: "e28", enabled: true, startKp: 44.4, direction: "up", speedKmh: 80 });
        assert.equal(response.status, 200);
        const list = await (await fetch(`${base}/api/live-locations?route=e28`)).json();
        assert.equal(list.positions[0].demo, true); assert.equal(list.positions[0].direction, "up");
        await admin("POST", { action: "stopAll" });
        assert.deepEqual((await (await fetch(`${base}/api/live-locations?route=e28`)).json()).positions, []);
    } finally {
        await new Promise(resolve => server.close(resolve));
        if (previous === undefined) delete process.env.ANNOTATIONS_ADMIN_KEY; else process.env.ANNOTATIONS_ADMIN_KEY = previous;
    }
});
