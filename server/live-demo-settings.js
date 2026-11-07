import { requireAdmin } from "./annotation-service.js";
import { privateApiHandler } from "./api-response.js";

export const DEMO_ROUTES = Object.freeze({
    e28: { name: "神戸淡路鳴門自動車道", endKp: 89, startKp: 44.4 },
    e30: { name: "瀬戸中央自動車道", endKp: 37.3, startKp: 0 },
    e76: { name: "西瀬戸自動車道", endKp: 59.2, startKp: 0 }
});
export const DEMO_RUNTIME_MS = 60 * 60 * 1000;
const fail = (status, message) => Object.assign(new Error(message), { status });
const defaults = routeId => ({ routeId, ...DEMO_ROUTES[routeId], enabled: false, direction: "down", speedKmh: 80, startedAt: 0 });
const COLUMNS = "route_id AS routeId, enabled, start_kp AS startKp, direction, speed_kmh AS speedKmh, started_at AS startedAt";
export function d1DemoSettingsStore(db) {
    return {
        async get(routeId) { return db.prepare(`SELECT ${COLUMNS} FROM live_demo_settings WHERE route_id=?`).bind(routeId).first(); },
        async set(c) { await db.prepare("UPDATE live_demo_settings SET enabled=?, start_kp=?, direction=?, speed_kmh=?, started_at=? WHERE route_id=?")
            .bind(c.enabled ? 1 : 0, c.startKp, c.direction, c.speedKmh, c.startedAt, c.routeId).run(); },
        async stopAll() { await db.prepare("UPDATE live_demo_settings SET enabled=0").run(); }
    };
}
export function memoryDemoSettingsStore() {
    const rows = new Map(Object.keys(DEMO_ROUTES).map(id => [id, defaults(id)]));
    return { async get(id) { return { ...rows.get(id) }; }, async set(c) { rows.set(c.routeId, { ...c }); },
        async stopAll() { for (const c of rows.values()) c.enabled = false; } };
}
export async function readDemoSettings(store, routeId, now = Date.now()) {
    if (!Object.hasOwn(DEMO_ROUTES, routeId)) return null;
    const row = await store.get(routeId);
    const config = { ...defaults(routeId), ...row };
    const expiresAt = config.startedAt > 0 ? config.startedAt + DEMO_RUNTIME_MS : null;
    // 閲覧者や管理画面が不在でも期限を延長しない。サーバー時刻で実効状態を決める。
    return { ...config, expiresAt, enabled: (row?.enabled === true || row?.enabled === 1) && expiresAt !== null && now < expiresAt };
}
export async function handleDemoAdminRequest(request, { store, adminKey, now = Date.now } = {}) {
    return privateApiHandler(async () => {
        // 認証前はDBを読まない。キーは既存の共有編集管理者キーを使う。
        await requireAdmin(request, adminKey);
        if (!store) throw fail(503, "デモ車の保存先が未設定です。");
        if (request.method !== "GET") {
            const origin = request.headers.get("Origin");
            if (origin && origin !== new URL(request.url).origin) throw fail(403, "別サイトからの操作はできません。");
            if (!["PUT", "POST"].includes(request.method)) throw fail(405, "Method not allowed.");
            if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw fail(415, "JSONを指定してください。");
            const reader = request.body?.getReader(), chunks = []; let length = 0;
            if (reader) for (;;) {
                const { done, value } = await reader.read(); if (done) break;
                length += value.byteLength;
                if (length > 2048) { await reader.cancel(); throw fail(413, "入力が大きすぎます。"); }
                chunks.push(value);
            }
            let body;
            try { body = JSON.parse(await new Blob(chunks).text()); } catch { throw fail(400, "JSONが不正です。"); }
            if (request.method === "POST") {
                if (body?.action !== "stopAll") throw fail(400, "操作が不正です。");
                await store.stopAll();
            } else {
                const previous = await readDemoSettings(store, body?.routeId, now());
                if (!previous || typeof body.enabled !== "boolean") throw fail(400, "路線・状態が不正です。");
                if (!body.enabled) await store.set({ ...previous, enabled: false });
                else {
                    if (typeof body.startKp !== "number" || !Number.isFinite(body.startKp) || body.startKp < 0 || body.startKp > previous.endKp
                        || !["up", "down"].includes(body.direction) || typeof body.speedKmh !== "number" || !Number.isFinite(body.speedKmh)
                        || body.speedKmh < 1 || body.speedKmh > 1000) throw fail(400, "出発KP・方向・速度を確認してください。");
                    await store.set({ ...previous, enabled: true, startKp: body.startKp, direction: body.direction, speedKmh: body.speedKmh, startedAt: now() });
                }
            }
        }
        const serverNow = now();
        return { serverNow, configs: await Promise.all(Object.keys(DEMO_ROUTES).map(id => readDemoSettings(store, id, serverNow))) };
    });
}
