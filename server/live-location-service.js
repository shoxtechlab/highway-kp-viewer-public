const ROUTE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const LIVE_TTL_MS = 30_000;
export const LIVE_WRITE_INTERVAL_MS = 9000;
const fail = (status, message) => Object.assign(new Error(message), { status });
export function normalizeLivePosition(input, now = Date.now()) {
    if (!ROUTE.test(input?.routeId || "") || !["up", "down"].includes(input.direction)) throw fail(400, "路線・方向が不正です。");
    for (const key of ["routeKp", "kp"]) {
        if (typeof input[key] !== "number" || !Number.isFinite(input[key]) || input[key] < 0 || input[key] > 2000) throw fail(400, "KPが不正です。");
    }
    if (typeof input.measuredAt !== "number" || !Number.isFinite(input.measuredAt)
        || now - input.measuredAt > 15_000 || input.measuredAt > now + 5000) throw fail(400, "位置情報が古いか、端末の時刻がずれています。");
    const kpSystemId = input.kpSystemId || "route";
    if (typeof kpSystemId !== "string" || !ROUTE.test(kpSystemId) || kpSystemId.length > 80) throw fail(400, "KP体系が不正です。");
    // 写真・緯度経度・速度・IP・履歴は保存しない。公開位置は0.1KPへ丸める。
    return { routeId: input.routeId, direction: input.direction,
        routeKp: Math.round(input.routeKp * 10) / 10, kp: Math.round(input.kp * 10) / 10,
        kpSystemId, demo: input.demo === true, measuredAt: Math.round(input.measuredAt), updatedAt: now, expiresAt: now + LIVE_TTL_MS };
}
export function publicLivePosition(row) {
    const { id, routeId, direction, routeKp, kp, kpSystemId, measuredAt, expiresAt } = row;
    const demo = row.demo === true || row.demo === 1;
    return { id, label: `${demo ? "デモ・" : ""}ユーザー${String(id).padStart(3, "0")}`, demo, routeId, direction, routeKp, kp, kpSystemId, measuredAt, expiresAt };
}
async function tokenHash(token) {
    if (!/^[a-f0-9]{64}$/.test(token || "")) throw fail(401, "公開セッションが無効です。");
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map(n => n.toString(16).padStart(2, "0")).join("");
}
export function createLiveLocationService(store, { routeIds, now = () => Date.now(), dailyLimit = 20_000 } = {}) {
    const normalize = async input => {
        const value = normalizeLivePosition(input, now());
        if (!(await routeIds()).includes(value.routeId)) throw fail(400, "未収録の路線です。");
        return value;
    };
    const budget = async () => {
        if (!await store.consumeBudget(new Date(now()).toISOString().slice(0, 10), dailyLimit)) throw fail(429, "本日の位置公開の更新上限に達しました。");
    };
    return {
        async list(routeId) {
            if (!ROUTE.test(routeId || "")) throw fail(400, "路線が不正です。");
            return { enabled: true, serverNow: now(), ttlMs: LIVE_TTL_MS, positions: (await store.list(routeId, now())).map(publicLivePosition) };
        },
        async create(input) {
            const position = await normalize(input);
            await budget();
            const token = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, "0")).join("");
            const row = await store.create(await tokenHash(token), position);
            if (!row) throw fail(429, "現在の公開人数の上限に達しました。");
            return { ...publicLivePosition(row), token };
        },
        async update(token, input) {
            const hash = await tokenHash(token), time = now();
            const previous = await store.get(hash);
            if (!previous || previous.expiresAt <= time) throw fail(404, "公開セッションが終了しました。");
            if (time - previous.updatedAt < LIVE_WRITE_INTERVAL_MS) throw fail(429, "公開更新の間隔が短すぎます。");
            const position = await normalize(input);
            if (position.measuredAt < previous.measuredAt) throw fail(409, "古い位置情報です。");
            await budget();
            const row = await store.update(hash, position);
            if (!row) throw fail(404, "公開セッションが終了しました。");
            return publicLivePosition(row);
        },
        async remove(token) { await store.remove(await tokenHash(token)); return { removed: true }; }
    };
}

const COLUMNS = "id, route_id AS routeId, direction, route_kp AS routeKp, kp, kp_system_id AS kpSystemId, measured_at AS measuredAt, updated_at AS updatedAt, expires_at AS expiresAt, is_demo AS demo";
const values = p => [p.routeId, p.direction, p.routeKp, p.kp, p.kpSystemId, p.measuredAt, p.updatedAt, p.expiresAt, p.demo ? 1 : 0];
export function d1LiveLocationStore(db) {
    return {
        async consumeBudget(day, limit) {
            const row = await db.prepare("INSERT INTO live_location_usage(day, write_count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET write_count=write_count+1 WHERE write_count < ? RETURNING write_count").bind(day, limit).first();
            return !!row;
        },
        async create(hash, p) {
            await db.batch([
                db.prepare("DELETE FROM live_locations WHERE expires_at <= ?").bind(p.updatedAt),
                db.prepare("DELETE FROM live_location_usage WHERE day < ?").bind(new Date(p.updatedAt).toISOString().slice(0, 10))
            ]);
            return db.prepare(`INSERT INTO live_locations(token_hash,route_id,direction,route_kp,kp,kp_system_id,measured_at,updated_at,expires_at,is_demo) SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM live_locations) < 200 RETURNING ${COLUMNS}`).bind(hash, ...values(p)).first();
        },
        async get(hash) { return db.prepare(`SELECT ${COLUMNS} FROM live_locations WHERE token_hash=?`).bind(hash).first(); },
        async update(hash, p) {
            return db.prepare(`UPDATE live_locations SET route_id=?,direction=?,route_kp=?,kp=?,kp_system_id=?,measured_at=?,updated_at=?,expires_at=?,is_demo=? WHERE token_hash=? AND expires_at > ? AND updated_at <= ? AND measured_at <= ? RETURNING ${COLUMNS}`)
                .bind(...values(p), hash, p.updatedAt, p.updatedAt - LIVE_WRITE_INTERVAL_MS, p.measuredAt).first();
        },
        async list(routeId, time) {
            return (await db.prepare(`SELECT ${COLUMNS} FROM live_locations WHERE route_id=? AND expires_at>? ORDER BY id LIMIT 200`).bind(routeId, time).all()).results || [];
        },
        async remove(hash) { await db.prepare("DELETE FROM live_locations WHERE token_hash=?").bind(hash).run(); }
    };
}

// 開発サーバー用。位置情報をディスクへ残さず、本番と同じサービス処理を通す。
export function memoryLiveLocationStore() {
    const rows = new Map(), usage = new Map(); let sequence = 0;
    return {
        async consumeBudget(day, limit) { const n = usage.get(day) || 0; if (n >= limit) return false; usage.clear(); usage.set(day, n + 1); return true; },
        async create(hash, p) { for (const [key, row] of rows) if (row.expiresAt <= p.updatedAt) rows.delete(key); if (rows.size >= 200) return null; const row = { id: ++sequence, ...p }; rows.set(hash, row); return { ...row }; },
        async get(hash) { return rows.get(hash); },
        async update(hash, p) { const old = rows.get(hash); if (!old || old.expiresAt <= p.updatedAt || old.updatedAt > p.updatedAt - LIVE_WRITE_INTERVAL_MS || old.measuredAt > p.measuredAt) return null; const row = { id: old.id, ...p }; rows.set(hash, row); return { ...row }; },
        async list(routeId, time) { return [...rows.values()].filter(row => row.routeId === routeId && row.expiresAt > time); },
        async remove(hash) { rows.delete(hash); }
    };
}
