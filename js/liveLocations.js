const ENDPOINT = "/api/live-locations";
export const LIVE_SEND_MS = 10_000;
export const LIVE_FIX_MAX_AGE_MS = 10_000;
export function drivePublicPosition({ driving, demo, onRoad, confirmed, measuredAt, accuracy, match, kpSystemId = "route" }, now = Date.now()) {
    if (!driving || !onRoad || !confirmed || !match || match.reference
        || !Number.isFinite(measuredAt) || now - measuredAt > LIVE_FIX_MAX_AGE_MS || measuredAt > now + 1000
        || !Number.isFinite(accuracy) || accuracy > 100 || !Number.isFinite(match.distanceM) || match.distanceM > 100) return null;
    const routeKp = Number(match.routeKp ?? match.kp), kp = Number(match.localKp ?? match.kp);
    if (![routeKp, kp].every(Number.isFinite) || !["up", "down"].includes(match.direction)) return null;
    return { routeId: match.route, direction: match.direction, routeKp, kp, kpSystemId, measuredAt, demo: demo === true };
}
async function call(method, body, token, keepalive = false) {
    const response = await fetch(ENDPOINT, { method, cache: "no-store", credentials: "omit", keepalive,
        headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: keepalive ? undefined : AbortSignal.timeout(10_000) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || "位置公開に失敗しました。"), { status: response.status });
    return result;
}
export function createLivePublisher({ getPosition, onStatus }) {
    let enabled = false, token = null, label = "", timer = null, pending = false, generation = 0, lastAttempt = 0;
    const report = (state, message) => onStatus?.({ enabled, state, message, label });
    const remove = value => value ? call("DELETE", null, value, true).catch(() => {}) : Promise.resolve();
    const withdraw = () => { const old = token; token = null; label = ""; return remove(old); };
    async function tick() {
        if (!enabled) return;
        const position = document.hidden ? null : getPosition();
        if (!position) { void withdraw(); report("waiting", "公開待機（本線上の新しい位置が確認できると再開）"); return; }
        if (pending || Date.now() - lastAttempt < LIVE_SEND_MS) return;
        const request = generation, previousToken = token;
        pending = true; lastAttempt = Date.now();
        try {
            const result = await call(previousToken ? "PUT" : "POST", position, previousToken);
            const receivedToken = previousToken || result.token;
            const current = getPosition();
            if (!enabled || request !== generation || document.hidden || !current || current.routeId !== position.routeId || current.direction !== position.direction) { await remove(receivedToken); return; }
            token = receivedToken; label = result.label;
            report("public", `${label}として位置を公開中`);
        } catch (error) {
            if (request !== generation) return;
            void withdraw();
            report("error", `${error.message} 更新されない位置は30秒で非表示になります。`);
        } finally { pending = false; }
    }
    return {
        async setEnabled(value) {
            const request = ++generation;
            clearInterval(timer); timer = null;
            enabled = false; void withdraw();
            if (!value) { report("off", "位置公開オフ"); return; }
            report("checking", "位置公開の設定を確認しています…");
            try {
                const response = await fetch(`${ENDPOINT}?status=1`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
                const status = await response.json();
                if (request !== generation) return;
                if (!response.ok || !status.enabled) throw new Error("位置公開は現在設定されていません。");
                enabled = true; lastAttempt = 0; report("waiting", "公開待機（本線位置を確認中）");
                timer = setInterval(tick, 1000); void tick();
            } catch (error) { if (request === generation) report("error", error.message); }
        },
        suspend() { generation++; void withdraw(); if (enabled) report("waiting", "画面が非表示のため公開を一時停止しています。"); },
        stop() { generation++; enabled = false; clearInterval(timer); timer = null; void withdraw(); report("off", "位置公開オフ"); }
    };
}

export function createLiveLocationReader({ routeId, onChange, onAvailability }) {
    let visible = false, positions = [], offset = 0, generation = 0, polling = false;
    const notify = () => { positions = positions.filter(p => p.expiresAt > Date.now() + offset); onChange(visible ? [...positions] : []); };
    async function poll() {
        if (!visible || document.hidden || polling) return;
        polling = true; const request = generation;
        try {
            const response = await fetch(`${ENDPOINT}?route=${encodeURIComponent(routeId)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
            const body = await response.json();
            if (request !== generation) return;
            if (!response.ok) throw new Error(body.error || "取得できませんでした。");
            onAvailability?.(body.enabled === true);
            positions = body.enabled ? body.positions || [] : [];
            offset = (Number(body.serverNow) || Date.now()) - Date.now(); notify();
            if (!body.enabled) { visible = false; }
        } catch { if (request === generation) { positions = []; notify(); } }
        finally { polling = false; }
    }
    const pollTimer = setInterval(poll, LIVE_SEND_MS);
    const expiryTimer = setInterval(() => { if (positions.length) notify(); }, 1000);
    const visibility = () => { if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", visibility);
    return {
        setVisible(value) { visible = value; generation++; if (!value) positions = []; notify(); if (value) void poll(); },
        stop() { visible = false; generation++; positions = []; clearInterval(pollTimer); clearInterval(expiryTimer); document.removeEventListener("visibilitychange", visibility); notify(); }
    };
}

export function renderLiveLocations(svg, positions, { start, end, kpToY }) {
    svg.querySelector(".live-location-layer")?.remove();
    const ns = "http://www.w3.org/2000/svg";
    const layer = document.createElementNS(ns, "g"); layer.classList.add("live-location-layer");
    layer.style.pointerEvents = "none";
    const add = (parent, tag, attributes, text) => {
        const element = document.createElementNS(ns, tag);
        for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
        if (text) element.textContent = text;
        parent.appendChild(element); return element;
    };
    for (const position of positions) {
        if (position.routeKp < start || position.routeKp > end) continue;
        const road = svg.querySelector(`.road[data-direction="${position.direction}"]`);
        if (!road) continue;
        const x = Number(road.getAttribute("x")) + Number(road.getAttribute("width")) / 2;
        const y = kpToY(position.routeKp);
        if (![x, y].every(Number.isFinite)) continue;
        const group = add(layer, "g", { transform: `translate(${x} ${y})` });
        add(group, "circle", { r: 16, fill: "#fff", stroke: "#1769b3", "stroke-width": 2 });
        add(group, "text", { "text-anchor": "middle", y: 9, "font-size": 25 }, position.demo ? "🚙" : "🚗");
        const side = position.direction === "up" ? -1 : 1;
        const text = { x: side * 21, "text-anchor": side < 0 ? "end" : "start", fill: "#165a92", stroke: "#fff", "stroke-width": 3, "paint-order": "stroke", "font-family": "system-ui,sans-serif", "font-weight": 700 };
        add(group, "text", { ...text, y: -2, "font-size": 12 }, position.label);
        add(group, "text", { ...text, y: 12, "font-size": 11 }, `${Number(position.kp).toFixed(1)} KP`);
    }
    // SVGは後の要素ほど手前。施設・追加ラベル・選択マーカーより車両を優先する。
    svg.appendChild(layer);
}
