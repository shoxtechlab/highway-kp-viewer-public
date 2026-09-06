function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

/**
 * 管理区間などの「区間内KP」を、描画で使う通算位置へ変換する。
 * OSM線形が0KPから始まらない場合でも、sectionの実KP定義を基準にする。
 */
export function resolveScopeBoundary(boundary, road) {
    // 従来の単一路線スコープは通算位置を数値で保持している。
    if (finiteNumber(boundary)) return boundary;
    if (!boundary || typeof boundary !== "object") return NaN;
    if (finiteNumber(boundary.routeKp)) return boundary.routeKp;

    const sectionId = boundary.section;
    const localKp = boundary.kp;
    if (typeof sectionId !== "string" || !finiteNumber(localKp)) return NaN;

    const section = road?.sections?.find(item => item.id === sectionId);
    if (!section) throw new Error(`スコープの区間が見つかりません: ${sectionId}`);
    if (![section.route_start_km, section.route_end_km, section.local_start_kp, section.kp_direction].every(finiteNumber)
        || section.kp_direction === 0) {
        throw new Error(`スコープ変換に必要な区間定義が不正です: ${sectionId}`);
    }

    const routeKp = section.route_start_km
        + (localKp - section.local_start_kp) / section.kp_direction;

    // 実KPがOSM収録範囲の外側にある場合は、最も近い描画可能位置へ合わせる。
    return Math.max(section.route_start_km, Math.min(section.route_end_km, routeKp));
}

export function resolveRouteScope(group, routeId, road) {
    const route = group?.routes?.[routeId];
    if (!group || !route) return null;

    const start = resolveScopeBoundary(route.start, road);
    const end = resolveScopeBoundary(route.end, road);
    if (!finiteNumber(start) || !finiteNumber(end) || end <= start) {
        throw new Error(`表示範囲が不正です: ${routeId}`);
    }

    return {
        ...route,
        start,
        end,
        name: group.name,
        home: group.home
    };
}
