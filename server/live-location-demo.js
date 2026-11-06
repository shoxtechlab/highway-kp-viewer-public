// 常駐タイマーやDB書込を使わず、共通の開始時刻から全閲覧者に同じ位置を返す。
// LIVE_LOCATION_DEMO は管理者が設定するJSON。未設定・enabled:falseで停止する。
export function liveDemoPosition(raw, routeId, now = Date.now()) {
    let config;
    try { config = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
    if (!config || config.enabled !== true || !["e28", "e30", "e76"].includes(routeId)
        || routeId !== (config.routeId || "e28")) return null;
    if (config.expiresAt != null && (!Number.isFinite(config.expiresAt) || now >= config.expiresAt)) return null;
    const { startedAt, startKp, endKp, speedKmh } = config;
    if (![startedAt, startKp, endKp, speedKmh].every(Number.isFinite)
        || startedAt > now || startKp < 0 || startKp > endKp || endKp <= 0 || speedKmh <= 0) return null;
    if (config.direction !== undefined && !["up", "down"].includes(config.direction)) return null;
    const origin = config.direction === "up" ? 2 * endKp - startKp : startKp;
    const phase = (origin + (now - startedAt) * speedKmh / 3_600_000) % (2 * endKp);
    const kp = Math.round((phase < endKp ? phase : 2 * endKp - phase) * 10) / 10;
    return { id: `demo-${routeId}`, label: `デモ車（${speedKmh}km/h）`, demo: true, routeId,
        direction: phase < endKp ? "down" : "up", routeKp: kp, kp, kpSystemId: "route",
        measuredAt: now, expiresAt: Math.min(now + 30_000, config.expiresAt ?? Infinity) };
}
