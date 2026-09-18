const PIXELS_PER_KM = 120;
const API_INTERVAL_MS = 5000;
const DISPLAY_INTERVAL_MS = 500;
const MAX_PREDICTION_MS = 7000;
const ROUTE_SWITCH_FIXES = 2;
const OUTSIDE_FIXES = 2;
const ROAD_DISTANCE_MIN_M = 300;

const params = new URLSearchParams(location.search);
const portalId = params.get("portal");
const demoMode = params.get("demo") === "1";
const demoKp = Number(params.get("demoKp")) || 125.9;
let currentRouteId = params.get("route");
let currentRoute = null;
let watchId = null;
let requestPending = false;
let lastMatch = null;
let switchCandidate = null;
let switchCount = 0;
let outsideCount = 0;
let routeChangeTimer = null;
let apiTimer = null;
let predictionTimer = null;
let latestPoint = null;
let lastApiAt = 0;
let lastMatchAt = 0;

const routeNumber = document.getElementById("drive-route-number");
const routeName = document.getElementById("drive-route-name");
const directionEl = document.getElementById("drive-direction");
const kpEl = document.getElementById("drive-kp");
const speedEl = document.getElementById("drive-speed");
const itemsEl = document.getElementById("drive-items");
const statusEl = document.getElementById("drive-status");
const routeChangeEl = document.getElementById("drive-route-change");
const stopButton = document.getElementById("drive-stop");

applyStoredTheme();
stopButton.addEventListener("click", () => stopDriveMode({ returnToViewer: true }));
window.addEventListener("pagehide", clearPositionWatch);

start().catch(error => endWithError(error.message || "走行モードを開始できませんでした。"));

async function start() {
    const saved = readStartPosition();
    if (!currentRouteId && saved?.match?.route) currentRouteId = saved.match.route;
    if (!currentRouteId) throw new Error("開始路線を判定できませんでした。");
    await loadRoute(currentRouteId);
    if (demoMode) {
        const demoMatch = {
            route: currentRouteId,
            routeName: currentRoute.road.name,
            section: null,
            direction: "down",
            directionLabel: currentRoute.road.direction_labels?.down || "下り",
            kp: demoKp,
            routeKp: demoKp,
            localKp: demoKp,
            distanceM: 4.2,
            headingDifference: 3
        };
        const demoPoint = { accuracy: 8, speed: 25.6, heading: 12 };
        lastMatch = demoMatch;
        latestPoint = demoPoint;
        lastMatchAt = Date.now();
        renderMatch(demoMatch, demoPoint);
        statusEl.textContent = "表示確認用デモ / GPS精度 ±8m / 道路から約4m";
        return;
    }
    if (saved?.match?.route === currentRouteId) {
        lastMatch = saved.match;
        latestPoint = saved.point;
        lastMatchAt = Date.now();
        renderMatch(saved.match, saved.point);
    }

    if (!navigator.geolocation) throw new Error("このブラウザは位置情報に対応していません。");
    watchId = navigator.geolocation.watchPosition(queuePosition, handlePositionError, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 3000
    });
    predictionTimer = setInterval(renderPredictedPosition, DISPLAY_INTERVAL_MS);
}

function readStartPosition() {
    const raw = sessionStorage.getItem("kp-viewer-drive-start");
    sessionStorage.removeItem("kp-viewer-drive-start");
    try { return raw ? JSON.parse(raw) : null; }
    catch { return null; }
}

function queuePosition(position) {
    latestPoint = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy,
        heading: position.coords.heading,
        speed: position.coords.speed
    };
    const wait = Math.max(0, API_INTERVAL_MS - (Date.now() - lastApiAt));
    if (wait === 0) {
        void processLatestPosition();
    } else if (apiTimer == null) {
        apiTimer = setTimeout(() => {
            apiTimer = null;
            void processLatestPosition();
        }, wait);
    }
}

async function processLatestPosition() {
    if (requestPending) return;
    requestPending = true;
    const point = latestPoint;
    if (!point) {
        requestPending = false;
        return;
    }
    lastApiAt = Date.now();
    try {
        const query = new URLSearchParams({
            lat: point.lat,
            lon: point.lon,
            preferredRoute: currentRouteId,
            preferredDirection: lastMatch?.direction || "down"
        });
        for (const key of ["accuracy", "heading", "speed"]) {
            if (Number.isFinite(point[key])) query.set(key, point[key]);
        }
        const match = await fetchApi(`/api/nearest?${query}`);
        const allowedDistance = Math.max(ROAD_DISTANCE_MIN_M, (point.accuracy || 0) * 2);
        if (match.distanceM > allowedDistance) {
            outsideCount += 1;
            statusEl.textContent = `収録路線から離れています（約${formatDistance(match.distanceM)}）。`;
            if (outsideCount >= OUTSIDE_FIXES) {
                stopDriveMode({ message: "収録路線外へ移動したため、走行モードを終了しました。" });
            }
            return;
        }
        outsideCount = 0;

        if (match.route !== currentRouteId) {
            if (switchCandidate === match.route) switchCount += 1;
            else {
                switchCandidate = match.route;
                switchCount = 1;
            }
            statusEl.textContent = `${match.routeName || match.route.toUpperCase()}への移動を確認しています。`;
            if (switchCount < ROUTE_SWITCH_FIXES) return;
            await switchRoute(match.route, match.routeName);
        } else {
            switchCandidate = null;
            switchCount = 0;
        }

        lastMatch = match;
        lastMatchAt = Date.now();
        renderMatch(match, point);
    } catch (error) {
        console.error(error);
        statusEl.className = "is-error";
        statusEl.textContent = "路線照合に失敗しました。次の位置情報で再試行します。";
    } finally {
        requestPending = false;
    }
}

function renderPredictedPosition() {
    if (!lastMatch || !latestPoint || watchId == null) return;
    const elapsedMs = Math.min(Date.now() - lastMatchAt, MAX_PREDICTION_MS);
    const speed = Number(latestPoint.speed);
    const headingUsable = lastMatch.headingDifference == null || lastMatch.headingDifference <= 60;
    if (!Number.isFinite(speed) || speed < 1 || !headingUsable || elapsedMs <= 0) return;

    // API照合間は、直前の方向とGPS速度からKPだけを前進させる。
    // 次回API応答で実測線形上の値へ戻るため、予測時間は短く上限を設ける。
    const directionSign = lastMatch.direction === "down" ? 1 : -1;
    const routeDeltaKm = directionSign * speed * elapsedMs / 1_000_000;
    const section = currentRoute.road.sections?.find(item => item.id === lastMatch.section);
    const localDeltaKm = routeDeltaKm * (section?.kp_direction || 1);
    renderMatch({
        ...lastMatch,
        kp: lastMatch.kp + routeDeltaKm,
        routeKp: (lastMatch.routeKp ?? lastMatch.kp) + routeDeltaKm,
        localKp: (lastMatch.localKp ?? lastMatch.kp) + localDeltaKm
    }, latestPoint, { predicted: true });
}

async function switchRoute(routeId, reportedName) {
    await loadRoute(routeId);
    currentRouteId = routeId;
    switchCandidate = null;
    switchCount = 0;
    const url = new URL(location.href);
    url.searchParams.set("route", routeId);
    history.replaceState(null, "", url);
    showRouteChange(`${reportedName || currentRoute?.road?.name || routeId.toUpperCase()}に切り替わりました`);
}

async function loadRoute(routeId) {
    currentRoute = await fetchApi(`/api/route/${routeId}`);
    const road = currentRoute.road;
    const numberMatch = road.name?.match(/^([A-Z]\d+[A-Z]?|C\d+)\s*/i);
    routeNumber.textContent = numberMatch?.[1]?.toUpperCase() || routeId.toUpperCase();
    routeName.textContent = road.name?.replace(numberMatch?.[0] || "", "") || road.name || routeId.toUpperCase();
    document.title = `${road.name || routeId.toUpperCase()} 走行モード | KP Viewer`;
}

function renderMatch(match, point, { predicted = false } = {}) {
    const road = currentRoute.road;
    const directionLabel = match.directionLabel
        || road.direction_labels?.[match.direction]
        || (match.direction === "up" ? "上り" : "下り");
    directionEl.textContent = directionLabel;
    kpEl.textContent = Number(match.localKp ?? match.kp).toFixed(2);
    speedEl.textContent = Number.isFinite(point.speed) ? String(Math.max(0, Math.round(point.speed * 3.6))) : "--";
    statusEl.className = "";
    statusEl.textContent = `${predicted ? "速度補間中 / " : ""}GPS精度 ±${formatDistance(point.accuracy)} / 道路から約${formatDistance(match.distanceM)}`;
    renderRoadItems(match);
}

function renderRoadItems(match) {
    itemsEl.replaceChildren();
    const road = currentRoute.road;
    const currentKp = match.kp;
    const forwardSign = match.direction === "down" ? 1 : -1;
    const viewHeight = document.getElementById("drive-road-view").clientHeight;
    const anchorY = viewHeight * .72;

    for (const [index, facility] of (road.facilities || []).entries()) {
        const routeKp = itemRouteKp(facility, match.direction, road);
        if (!Number.isFinite(routeKp)) continue;
        let y = anchorY - (routeKp - currentKp) * forwardSign * PIXELS_PER_KM;
        if (y < -30 || y > viewHeight + 30) continue;
        if (Math.abs(y - anchorY) < 35) y -= 44;
        const element = document.createElement("div");
        element.className = `drive-item${index % 2 ? " is-left" : ""}`;
        element.style.top = `${y}px`;
        element.innerHTML = `<span>${escapeHtml(facility.name)}</span><small>${formatLocalKp(facility, match.direction)} KP・${escapeHtml(facility.type || "施設")}</small>`;
        itemsEl.appendChild(element);
    }

    for (const structure of (road.structures || [])) {
        const endpoints = structureRouteRange(structure, match.direction, road);
        if (!endpoints) continue;
        const y1 = anchorY - (endpoints.start - currentKp) * forwardSign * PIXELS_PER_KM;
        const y2 = anchorY - (endpoints.end - currentKp) * forwardSign * PIXELS_PER_KM;
        const top = Math.min(y1, y2);
        const bottom = Math.max(y1, y2);
        if (bottom < 0 || top > viewHeight) continue;
        const element = document.createElement("div");
        element.className = `drive-structure ${String(structure.type).toLowerCase()}`;
        element.style.top = `${Math.max(-4, top)}px`;
        element.style.height = `${Math.max(5, Math.min(viewHeight + 8, bottom) - Math.max(-4, top))}px`;
        element.title = structure.name;
        const label = document.createElement("span");
        label.textContent = structure.name;
        element.appendChild(label);
        itemsEl.appendChild(element);
    }
}

function itemRouteKp(item, direction, road) {
    const localKp = Number(item?.[direction]?.kp);
    if (!Number.isFinite(localKp)) return null;
    if (!item.section || !Array.isArray(road.sections)) return localKp;
    const section = road.sections.find(candidate => candidate.id === item.section);
    if (!section || !Number.isFinite(section.route_start_km) || !Number.isFinite(section.local_start_kp)) return localKp;
    return section.route_start_km + (localKp - section.local_start_kp) / (section.kp_direction || 1);
}

function structureRouteRange(item, direction, road) {
    const value = item?.[direction];
    const start = Number(value?.start_kp ?? value?.start);
    const end = Number(value?.end_kp ?? value?.end);
    if (!value || !Number.isFinite(start) || !Number.isFinite(end)) return null;
    return {
        start: itemRouteKp({ section: item.section, [direction]: { kp: start } }, direction, road),
        end: itemRouteKp({ section: item.section, [direction]: { kp: end } }, direction, road)
    };
}

function formatLocalKp(item, direction) {
    return Number(item?.[direction]?.kp).toFixed(2);
}

function handlePositionError(error) {
    const messages = {
        1: "位置情報の利用が許可されていません。",
        2: "現在地を取得できませんでした。",
        3: "位置情報の取得がタイムアウトしました。"
    };
    endWithError(messages[error.code] || "位置情報を取得できませんでした。");
}

function stopDriveMode({ message, returnToViewer = false } = {}) {
    clearPositionWatch();
    if (returnToViewer) {
        const target = new URL("viewer.html", location.href);
        target.searchParams.set("route", currentRouteId);
        if (portalId) target.searchParams.set("portal", portalId);
        location.assign(target.href);
        return;
    }
    statusEl.className = "is-error";
    statusEl.textContent = message || "走行モードを終了しました。";
    stopButton.textContent = "viewerへ戻る";
    stopButton.onclick = () => stopDriveMode({ returnToViewer: true });
}

function clearPositionWatch() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    clearTimeout(apiTimer);
    clearInterval(predictionTimer);
    apiTimer = null;
    predictionTimer = null;
}

function endWithError(message) {
    stopDriveMode({ message });
}

function showRouteChange(message) {
    clearTimeout(routeChangeTimer);
    routeChangeEl.textContent = message;
    routeChangeEl.hidden = false;
    routeChangeTimer = setTimeout(() => { routeChangeEl.hidden = true; }, 4000);
}

function applyStoredTheme() {
    const dark = localStorage.getItem("kp-viewer-theme") === "dark";
    document.body.classList.toggle("dark-theme", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#152019" : "#00973a");
}

async function fetchApi(path) {
    const response = await fetch(path);
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || `API request failed: ${response.status}`);
    return body;
}

function formatDistance(value) {
    if (!Number.isFinite(value)) return "不明";
    return value < 1000 ? `${Math.round(value)}m` : `${(value / 1000).toFixed(1)}km`;
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[char]);
}
