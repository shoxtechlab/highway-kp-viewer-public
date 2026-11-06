const PIXELS_PER_KM = 120;
const API_INTERVAL_MS = 5000;
const DISPLAY_INTERVAL_MS = 500;
const MAX_PREDICTION_MS = 30000;
const GPS_STALE_WARNING_MS = 10000;
const TUNNEL_ENTRY_MARGIN_KM = .1;
const TUNNEL_RECOVERY_MARGIN_KM = .2;
const ROUTE_SWITCH_FIXES = 2;
const OUTSIDE_FIXES = 2;
const ROAD_DISTANCE_MIN_M = 300;
const BROWSE_WHEEL_FACTOR = .8;
const MATCH_CONFIRM_FIXES = 2;
const DRIVE_LAYER_STORAGE_KEY = "kp-drive-layer-visibility";
const DEFAULT_DRIVE_LAYERS = Object.freeze({
    bridges: true,
    tunnels: true,
    incident: true,
    construction: true,
    other: true
});

const params = new URLSearchParams(location.search);
const portalId = params.get("portal");
const demoMode = params.get("demo") === "1";
const tunnelDemo = demoMode && params.get("demoState") === "tunnel";
const demoKp = Number(params.get("demoKp")) || (tunnelDemo ? 10 : 125.9);
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
let lastPositionAt = 0;
let browseCenterRouteKp = null;
let browseRenderFrame = null;
let dragState = null;
let displayedMatch = null;
let driveState = "searching";
let startupInstantAvailable = true;
let startupProvisional = null;
let referenceMatch = null;
let tunnelEstimate = null;
let offroadNoticeShown = false;
let driveAnnotations = [];
let annotationLoadId = 0;
const driveLayers = readDriveLayerSettings();

const routeNumber = document.getElementById("drive-route-number");
const routeName = document.getElementById("drive-route-name");
const directionEl = document.getElementById("drive-direction");
const kpEl = document.getElementById("drive-kp");
const kpReadoutEl = document.querySelector(".drive-kp");
const readoutEl = document.querySelector(".drive-readout");
const speedEl = document.getElementById("drive-speed");
const itemsEl = document.getElementById("drive-items");
const statusEl = document.getElementById("drive-status");
const routeChangeEl = document.getElementById("drive-route-change");
const stopButton = document.getElementById("drive-stop");
const roadViewEl = document.getElementById("drive-road-view");
const currentMarkerEl = document.querySelector(".drive-current-marker");
const referenceMarkerEl = document.createElement("div");
referenceMarkerEl.className = "drive-reference-marker";
referenceMarkerEl.hidden = true;
roadViewEl.appendChild(referenceMarkerEl);
const followButton = document.getElementById("drive-follow");
const viewCenterEl = document.getElementById("drive-view-center");
const currentEdgeEl = document.getElementById("drive-current-edge");
const layerToggle = document.getElementById("drive-layer-toggle");
const layerMenu = document.getElementById("drive-layer-menu");
const offroadDialog = document.getElementById("drive-offroad-dialog");
const offroadMessage = document.getElementById("drive-offroad-message");
const offroadClose = document.getElementById("drive-offroad-close");

applyStoredTheme();
stopButton.addEventListener("click", () => stopDriveMode({ returnToViewer: true }));
offroadClose?.addEventListener("click", () => offroadDialog.close());
followButton.addEventListener("click", returnToCurrentPosition);
roadViewEl.addEventListener("pointerdown", beginRoadBrowse);
roadViewEl.addEventListener("pointermove", continueRoadBrowse);
roadViewEl.addEventListener("pointerup", endRoadBrowse);
roadViewEl.addEventListener("pointercancel", endRoadBrowse);
roadViewEl.addEventListener("wheel", browseWithWheel, { passive: false });
layerToggle.addEventListener("click", () => setLayerMenuOpen(layerMenu.hidden));
layerMenu.querySelectorAll("input[data-layer]").forEach(input => {
    input.checked = driveLayers[input.dataset.layer] !== false;
    input.addEventListener("change", () => {
        driveLayers[input.dataset.layer] = input.checked;
        localStorage.setItem(DRIVE_LAYER_STORAGE_KEY, JSON.stringify(driveLayers));
        if (displayedMatch) renderRoadItems(displayedMatch);
    });
});
document.addEventListener("click", event => {
    if (!layerMenu.hidden && !event.target.closest(".drive-header-actions")) setLayerMenuOpen(false);
});
document.addEventListener("keydown", event => {
    if (event.key === "Escape") setLayerMenuOpen(false);
});
window.addEventListener("pagehide", clearPositionWatch);

start().catch(error => endWithError(error.message || "走行モードを開始できませんでした。"));

async function start() {
    const saved = readStartPosition();
    if (!currentRouteId && (saved?.fallback?.route || saved?.match?.route)) {
        currentRouteId = saved.fallback?.route || saved.match.route;
    }
    if (currentRouteId) {
        await loadRoute(currentRouteId);
        renderRouteHeader();
    }
    if (demoMode) {
        if (!currentRoute) throw new Error("デモ表示する路線を指定してください。");
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
        if (tunnelDemo) {
            // 固定時刻のデモ。実GPSを取得せず、本番と同じ推定・出口制限・表示を通す。
            const lostSeconds = Math.max(10, Math.min(3600, Number(params.get("demoLost")) || 20));
            lastMatchAt = Date.now() - lostSeconds * 1000;
            lastPositionAt = lastMatchAt;
            beginTunnelEstimate();
            if (!tunnelEstimate) throw new Error("demoKpには登録済みトンネル内のKPを指定してください。");
            renderPredictedPosition();
            statusEl.textContent = `デモ・GPS未更新 ${lostSeconds}秒 / ${statusEl.textContent}`;
            return;
        }
        statusEl.textContent = "表示確認用デモ / GPS精度 ±8m / 道路から約4m";
        return;
    }
    latestPoint = saved?.point || null;
    if (latestPoint) lastPositionAt = Date.now();
    referenceMatch = createReferenceMatch(saved?.fallback || saved?.match);
    if (referenceMatch) renderReferenceView(referenceMatch, "現在地から収録路線を検索しています。参考位置を表示中です。");
    else renderRouteSearch(null, "現在地から収録路線を検索しています。");

    if (!navigator.geolocation) {
        statusEl.className = "is-error";
        statusEl.textContent = "位置情報に非対応のため、参考位置を表示しています。";
        return;
    }
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
    lastPositionAt = Date.now();
    latestPoint = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy,
        heading: position.coords.heading,
        speed: position.coords.speed
    };
    if (["searching", "standby", "offroad"].includes(driveState)) renderGpsSpeed(latestPoint);
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
        const query = new URLSearchParams({ lat: point.lat, lon: point.lon });
        // 起動直後の暫定表示を次の測位で検証するときは、最初の候補に
        // 引っ張られないよう優先路線・方向を付けずに全路線から再判定する。
        const usePreferredMatch = !startupProvisional && !["standby", "offroad"].includes(driveState);
        if (currentRouteId && usePreferredMatch) query.set("preferredRoute", currentRouteId);
        if (lastMatch?.direction && usePreferredMatch) query.set("preferredDirection", lastMatch.direction);
        for (const key of ["accuracy", "heading", "speed"]) {
            if (Number.isFinite(point[key])) query.set(key, point[key]);
        }
        const match = await fetchApi(`/api/nearest?${query}`);
        // トンネル中の別路線への位置飛びを採用しない。復帰は同一路線・方向と
        // 推定位置との整合を確認し、GPS精度100m以下の測位で確定する。
        if (tunnelEstimate) {
            const estimate = tunnelPrediction(Date.now());
            const toleranceKm = Math.max(TUNNEL_RECOVERY_MARGIN_KM, (point.accuracy || 0) * 2 / 1000);
            if (match.route !== tunnelEstimate.match.route || match.direction !== tunnelEstimate.match.direction
                || !Number.isFinite(point.accuracy) || point.accuracy > 100
                || match.distanceM > Math.max(100, point.accuracy * 2)
                || Math.abs(Number(match.routeKp ?? match.kp) - estimate.routeKp) > toleranceKm) {
                renderPredictedPosition();
                return;
            }
            tunnelEstimate = null;
        }
        const allowedDistance = Math.max(ROAD_DISTANCE_MIN_M, (point.accuracy || 0) * 2);
        if (match.distanceM > allowedDistance) {
            outsideCount += 1;
            if (outsideCount < OUTSIDE_FIXES && driveState === "tracking") {
                statusEl.textContent = `本線位置を再確認しています（道路から約${formatDistance(match.distanceM)}）。`;
                return;
            }
            switchCandidate = null;
            switchCount = 0;
            const wasTracking = driveState === "tracking";
            // 本線外では開いていた路線を維持。別路線のKPをこの路線へ流用しない。
            referenceMatch = match.route === currentRouteId
                ? { ...match, reference: true, nearest: true }
                : { ...(referenceMatch || displayedMatch || createReferenceMatch()), nearest: false };
            renderOffroadView(referenceMatch, point, { resetBrowse: wasTracking });
            showOffroadNotice(match);
            return;
        }
        outsideCount = 0;
        offroadNoticeShown = false;

        // 起動時だけは最初の有効な1回で暫定表示する。次の有効判定は
        // 路線・方向が異なっていても直ちに反映し、その後は通常の
        // 2回確認による路線切替へ戻る。
        if (["searching", "standby", "offroad"].includes(driveState) && startupInstantAvailable) {
            startupInstantAvailable = false;
            if (match.route !== currentRouteId) await switchRoute(match.route, match.routeName, { announce: false });
            else renderRouteHeader();
            startupProvisional = { route: match.route, direction: match.direction };
            lastMatch = match;
            lastMatchAt = Date.now();
            renderMatch(match, point);
            statusEl.textContent = "位置を確認中・暫定表示";
            return;
        }

        if (startupProvisional) {
            const provisional = startupProvisional;
            startupProvisional = null;
            if (match.route !== currentRouteId) {
                await switchRoute(match.route, match.routeName, { announce: false });
                showRouteChange(`${match.routeName || match.route.toUpperCase()}に補正しました`);
            } else if (match.direction !== provisional.direction) {
                const correctedDirection = match.directionLabel
                    || currentRoute?.road?.direction_labels?.[match.direction]
                    || (match.direction === "up" ? "上り" : "下り");
                showRouteChange(`${correctedDirection}に補正しました`);
            }
            switchCandidate = null;
            switchCount = 0;
            lastMatch = match;
            lastMatchAt = Date.now();
            renderMatch(match, point);
            return;
        }

        if (driveState === "searching" || match.route !== currentRouteId) {
            if (switchCandidate === match.route) switchCount += 1;
            else {
                switchCandidate = match.route;
                switchCount = 1;
            }
            const candidateName = match.routeName || match.route.toUpperCase();
            if (driveState === "searching") renderRouteSearch(point, `${candidateName}を確認しています（${switchCount}/${MATCH_CONFIRM_FIXES}）。`);
            else statusEl.textContent = `${candidateName}への移動を確認しています（${switchCount}/${ROUTE_SWITCH_FIXES}）。`;
            const requiredFixes = driveState === "searching" ? MATCH_CONFIRM_FIXES : ROUTE_SWITCH_FIXES;
            if (switchCount < requiredFixes) return;
            if (match.route !== currentRouteId) await switchRoute(match.route, match.routeName);
            else renderRouteHeader();
            switchCandidate = null;
            switchCount = 0;
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
    if (driveState !== "tracking" || !lastMatch || !latestPoint || (watchId == null && !demoMode)) return;
    const now = Date.now();
    const elapsedMs = Math.min(now - lastMatchAt, MAX_PREDICTION_MS);
    const lostMs = lastPositionAt ? now - lastPositionAt : 0;
    if (!tunnelEstimate && lostMs >= GPS_STALE_WARNING_MS) beginTunnelEstimate();
    if (tunnelEstimate) {
        const estimate = tunnelPrediction(now);
        renderMatch(estimate.match, tunnelEstimate.point, { predicted: true, lostMs });
        readoutEl.classList.add("is-gps-stale");
        speedEl.parentElement.querySelector("span").textContent = "km/h";
        speedEl.title = "進入時速度（現在の実測速度ではありません）";
        statusEl.className = "is-gps-stale";
        statusEl.textContent = `${tunnelEstimate.name} / ${estimate.atExit ? "出口付近・位置情報の復帰待ち" : "トンネル内・推定位置"} / 進入時速度 ${Math.round(tunnelEstimate.speed * 3.6)} km/h`;
        return;
    }
    speedEl.removeAttribute("title");
    const speed = Number(latestPoint.speed);
    const headingUsable = lastMatch.headingDifference == null || lastMatch.headingDifference <= 60;
    if (!Number.isFinite(speed) || speed < 1 || !headingUsable || elapsedMs <= 0) {
        renderGpsFreshness(latestPoint, lastMatch, { predicted: false, lostMs });
        return;
    }

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
    }, latestPoint, { predicted: true, lostMs });
}

function beginTunnelEstimate() {
    if (!lastMatch || !currentRoute?.road || latestPoint?.speed == null) return;
    const speed = Number(latestPoint.speed);
    if (!Number.isFinite(speed) || speed < 1 || (lastMatch.headingDifference != null && lastMatch.headingDifference > 60)) return;
    const sign = lastMatch.direction === "down" ? 1 : -1;
    const kp = Number(lastMatch.routeKp ?? lastMatch.kp);
    for (const structure of currentRoute.road.structures || []) {
        if (String(structure.type).toLowerCase() !== "tunnel") continue;
        const range = structureRouteRange(structure, lastMatch.direction, currentRoute.road);
        if (!range) continue;
        const entrance = sign === 1 ? Math.min(range.start, range.end) : Math.max(range.start, range.end);
        const exit = sign === 1 ? Math.max(range.start, range.end) : Math.min(range.start, range.end);
        if ((kp - entrance) * sign < -TUNNEL_ENTRY_MARGIN_KM || (exit - kp) * sign < 0) continue;
        tunnelEstimate = { name: structure.name, exit, sign, speed, match: { ...lastMatch }, point: { ...latestPoint }, startedAt: lastMatchAt };
        return;
    }
}

function tunnelPrediction(now) {
    const state = tunnelEstimate;
    const origin = Number(state.match.routeKp ?? state.match.kp);
    const distance = Math.min(Math.max(0, (state.exit - origin) * state.sign), state.speed * Math.max(0, now - state.startedAt) / 1_000_000);
    const delta = distance * state.sign;
    const section = currentRoute.road.sections?.find(item => item.id === state.match.section);
    const routeKp = origin + delta;
    return { routeKp, atExit: Math.abs(routeKp - state.exit) < .00001, match: {
        ...state.match, kp: routeKp, routeKp,
        localKp: Number(state.match.localKp ?? state.match.kp) + delta * (section?.kp_direction || 1)
    } };
}

async function switchRoute(routeId, reportedName, { announce = true } = {}) {
    await loadRoute(routeId);
    currentRouteId = routeId;
    renderRouteHeader();
    browseCenterRouteKp = null;
    const url = new URL(location.href);
    url.searchParams.set("route", routeId);
    history.replaceState(null, "", url);
    if (announce) showRouteChange(`${reportedName || currentRoute?.road?.name || routeId.toUpperCase()}に切り替わりました`);
}

async function loadRoute(routeId) {
    currentRoute = await fetchApi(`/api/route/${routeId}`);
    await loadDriveAnnotations(routeId);
}

function renderRouteHeader() {
    if (!currentRoute?.road) return;
    const road = currentRoute.road;
    const numberMatch = road.name?.match(/^([A-Z]\d+[A-Z]?|C\d+)\s*/i);
    routeNumber.textContent = numberMatch?.[1]?.toUpperCase() || currentRouteId?.toUpperCase() || "---";
    routeName.textContent = road.name?.replace(numberMatch?.[0] || "", "") || road.name || currentRouteId?.toUpperCase() || "路線";
    document.title = `${road.name || currentRouteId?.toUpperCase() || "路線"} 走行モード | KP Viewer`;
}

function renderMatch(match, point, { predicted = false, lostMs = 0 } = {}) {
    driveState = "tracking";
    displayedMatch = match;
    kpReadoutEl.hidden = false;
    kpReadoutEl.classList.remove("is-reference");
    roadViewEl.classList.remove("is-searching");
    const road = currentRoute.road;
    const directionLabel = match.directionLabel
        || road.direction_labels?.[match.direction]
        || (match.direction === "up" ? "上り" : "下り");
    directionEl.textContent = directionLabel;
    kpEl.textContent = Number(match.localKp ?? match.kp).toFixed(2);
    renderGpsSpeed(point);
    speedEl.parentElement.querySelector("span").textContent = "km/h";
    renderGpsFreshness(point, match, { predicted, lostMs });
    renderRoadItems(match);
}

function renderGpsFreshness(point, match, { predicted = false, lostMs = 0 } = {}) {
    const stale = !demoMode && lostMs >= GPS_STALE_WARNING_MS;
    readoutEl.classList.toggle("is-gps-stale", stale);
    statusEl.className = "";
    if (stale) {
        const seconds = Math.floor(lostMs / 1000);
        statusEl.classList.add("is-gps-stale");
        statusEl.textContent = lostMs >= MAX_PREDICTION_MS
            ? `GPS未更新 ${seconds}秒・GPS信号待ち（推定停止）`
            : `GPS未更新 ${seconds}秒・推定表示中`;
        return;
    }
    if (startupProvisional) {
        statusEl.textContent = "位置を確認中・暫定表示";
        return;
    }
    statusEl.textContent = `${predicted ? "速度補間中 / " : ""}GPS精度 ±${formatDistance(point?.accuracy)} / 道路から約${formatDistance(match?.distanceM)}`;
}

function renderRouteSearch(point, message) {
    referenceMarkerEl.hidden = true;
    driveState = "searching";
    lastMatch = null;
    displayedMatch = null;
    lastMatchAt = 0;
    browseCenterRouteKp = null;
    routeNumber.textContent = "走行モード";
    routeName.textContent = "路線を検索中";
    document.title = "路線を検索中 | KP Viewer";
    directionEl.textContent = "検索中";
    kpReadoutEl.hidden = true;
    kpReadoutEl.classList.remove("is-reference");
    roadViewEl.classList.add("is-searching");
    itemsEl.replaceChildren();
    currentMarkerEl.hidden = true;
    followButton.hidden = true;
    viewCenterEl.hidden = true;
    currentEdgeEl.hidden = true;
    readoutEl.classList.remove("is-gps-stale");
    renderGpsSpeed(point);
    statusEl.className = "";
    statusEl.textContent = message || "現在地から収録路線を検索しています。";
}

function createReferenceMatch(source) {
    if (!currentRoute?.road) return null;
    const bounds = routeKpBounds(currentRoute.road);
    const finiteNumber = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
        ? Number(value)
        : null;
    const routeKp = finiteNumber(source?.routeKp) ?? finiteNumber(source?.kp) ?? bounds?.min;
    if (!Number.isFinite(routeKp)) return null;
    const localKp = finiteNumber(source?.localKp) ?? routeKp;
    const direction = source?.direction === "up" ? "up" : "down";
    return {
        route: currentRouteId,
        routeName: currentRoute.road.name,
        section: source?.section || null,
        direction,
        directionLabel: currentRoute.road.direction_labels?.[direction] || (direction === "up" ? "上り" : "下り"),
        kp: routeKp,
        routeKp,
        localKp,
        distanceM: null,
        reference: true
    };
}

function renderReferenceView(match, message, { resetBrowse = true } = {}) {
    driveState = "standby";
    displayedMatch = match;
    lastMatch = null;
    lastMatchAt = 0;
    if (resetBrowse) browseCenterRouteKp = null;
    renderRouteHeader();
    kpReadoutEl.hidden = false;
    kpReadoutEl.classList.remove("is-reference");
    roadViewEl.classList.remove("is-searching");
    directionEl.textContent = match.directionLabel || (match.direction === "up" ? "上り" : "下り");
    kpEl.textContent = "--";
    renderGpsSpeed(latestPoint);
    readoutEl.classList.remove("is-gps-stale");
    renderRoadItems(match);
    currentMarkerEl.hidden = true;
    currentEdgeEl.hidden = true;
    statusEl.className = "is-reference";
    statusEl.textContent = message || "参考位置を表示中・現在地から路線を検索しています。";
}

function renderOffroadView(match, point, { resetBrowse = true } = {}) {
    driveState = "offroad";
    displayedMatch = match;
    lastMatch = null;
    lastMatchAt = 0;
    if (resetBrowse) browseCenterRouteKp = null;
    renderRouteHeader();
    directionEl.textContent = "本線外";
    kpReadoutEl.hidden = false;
    kpEl.textContent = "--";
    kpReadoutEl.classList.remove("is-reference");
    roadViewEl.classList.remove("is-searching");
    renderGpsSpeed(point);
    readoutEl.classList.remove("is-gps-stale");
    renderRoadItems(match);
    currentMarkerEl.hidden = true;
    currentEdgeEl.hidden = true;
    statusEl.className = "is-reference";
    statusEl.textContent = "本線外 / 開いていた路線を参考表示しています。";
}

function showOffroadNotice(match) {
    if (offroadNoticeShown) return;
    offroadNoticeShown = true;
    const routeLabel = currentRoute.road.name || currentRouteId.toUpperCase();
    const message = `現在地は収録路線から離れています。開いていた${routeLabel}を参考表示します。現在地KPは「--」と表示します。`;
    if (offroadMessage) offroadMessage.textContent = message;
    if (offroadDialog?.showModal) offroadDialog.showModal();
    else window.alert(message);
}

function renderGpsSpeed(point) {
    speedEl.textContent = Number.isFinite(point?.speed) ? String(Math.max(0, Math.round(point.speed * 3.6))) : "--";
}

function renderRoadItems(match) {
    itemsEl.replaceChildren();
    const road = currentRoute.road;
    const currentKp = match.kp;
    const forwardSign = match.direction === "down" ? 1 : -1;
    const viewHeight = document.getElementById("drive-road-view").clientHeight;
    const anchorY = viewHeight * .72;
    const viewKp = browseCenterRouteKp ?? currentKp;
    const labels = [];

    renderBrowseState(match, viewHeight, anchorY, viewKp);

    for (const [index, facility] of (road.facilities || []).entries()) {
        const routeKp = itemRouteKp(facility, match.direction, road);
        if (!Number.isFinite(routeKp)) continue;
        let y = anchorY - (routeKp - viewKp) * forwardSign * PIXELS_PER_KM;
        if (y < -30 || y > viewHeight + 30) continue;
        if (Math.abs(y - anchorY) < 35) y -= 44;
        const element = document.createElement("div");
        element.className = "drive-item";
        element.style.top = `${y}px`;
        element.innerHTML = `<span>${escapeHtml(facility.name)}</span><small>${formatLocalKp(facility, match.direction)} KP・${escapeHtml(facility.type || "施設")}</small>`;
        itemsEl.appendChild(element);
        labels.push({
            desiredY: y,
            preferredSide: index % 2 ? "left" : "right",
            height: 38,
            setPosition(placedY, side) {
                element.classList.toggle("is-left", side === "left");
                element.style.top = `${placedY}px`;
            }
        });
    }

    for (const [index, structure] of (road.structures || []).entries()) {
        const structureType = String(structure.type).toLowerCase();
        if (structureType === "bridge" && !driveLayers.bridges) continue;
        if (structureType === "tunnel" && !driveLayers.tunnels) continue;
        const endpoints = structureRouteRange(structure, match.direction, road);
        if (!endpoints) continue;
        const y1 = anchorY - (endpoints.start - viewKp) * forwardSign * PIXELS_PER_KM;
        const y2 = anchorY - (endpoints.end - viewKp) * forwardSign * PIXELS_PER_KM;
        const top = Math.min(y1, y2);
        const bottom = Math.max(y1, y2);
        if (bottom < 0 || top > viewHeight) continue;
        const element = document.createElement("div");
        element.className = `drive-structure ${structureType}`;
        element.style.top = `${Math.max(-4, top)}px`;
        element.style.height = `${Math.max(5, Math.min(viewHeight + 8, bottom) - Math.max(-4, top))}px`;
        element.title = structure.name;
        const label = document.createElement("span");
        label.textContent = structure.name;
        element.appendChild(label);
        itemsEl.appendChild(element);
        const desiredY = Math.max(12, Math.min(viewHeight - 12, (top + bottom) / 2));
        labels.push({
            desiredY,
            preferredSide: index % 2 ? "left" : "right",
            height: 29,
            setPosition(placedY, side) {
                label.classList.toggle("is-left", side === "left");
                label.style.top = `${placedY - Math.max(-4, top)}px`;
            }
        });
    }

    renderDriveAnnotations({ match, road, viewHeight, anchorY, viewKp, forwardSign, labels });

    placeDriveLabels(labels, viewHeight);
}

function renderDriveAnnotations({ match, road, viewHeight, anchorY, viewKp, forwardSign, labels }) {
    for (const [index, record] of driveAnnotations.entries()) {
        const category = annotationCategory(record.type);
        if (!driveLayers[category]) continue;
        if (record.direction && record.direction !== "both" && record.direction !== match.direction) continue;
        const start = annotationRouteKp(record.startKp, record.kpSystemId, road);
        const end = record.geometryType === "section"
            ? annotationRouteKp(record.endKp, record.kpSystemId, road)
            : start;
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        const startY = anchorY - (start - viewKp) * forwardSign * PIXELS_PER_KM;
        const endY = anchorY - (end - viewKp) * forwardSign * PIXELS_PER_KM;
        const top = Math.min(startY, endY);
        const bottom = Math.max(startY, endY);
        if (bottom < -30 || top > viewHeight + 30) continue;
        const color = record.colors?.primary || "#59636d";
        if (record.geometryType === "section") {
            const range = document.createElement("div");
            range.className = "drive-annotation-range";
            range.style.setProperty("--annotation-color", color);
            range.style.top = `${Math.max(-4, top)}px`;
            range.style.height = `${Math.max(5, Math.min(viewHeight + 8, bottom) - Math.max(-4, top))}px`;
            itemsEl.appendChild(range);
        }
        const desiredY = Math.max(16, Math.min(viewHeight - 16, record.geometryType === "section" ? (top + bottom) / 2 : startY));
        const element = document.createElement("div");
        element.className = "drive-item drive-annotation";
        element.style.setProperty("--annotation-color", color);
        element.style.top = `${desiredY}px`;
        element.innerHTML = `<span>${escapeHtml(record.name || annotationTypeLabel(record.type))}</span><small>${escapeHtml(annotationTypeLabel(record.type))}${record.geometryType === "section" ? "・区間" : ""}</small>`;
        itemsEl.appendChild(element);
        labels.push({
            desiredY,
            preferredSide: index % 2 ? "left" : "right",
            height: 41,
            setPosition(placedY, side) {
                element.classList.toggle("is-left", side === "left");
                element.style.top = `${placedY}px`;
            }
        });
    }
}

async function loadDriveAnnotations(routeId) {
    const loadId = ++annotationLoadId;
    const [localRecords, sharedRecords] = await Promise.all([
        readLocalAnnotations(routeId).catch(error => {
            console.warn(`端末内の追加データを読み込めませんでした: ${error.message}`);
            return [];
        }),
        fetchApi(`/api/annotations?route=${encodeURIComponent(routeId)}`)
            .then(body => body.records || [])
            .catch(error => {
                console.warn(`共有の追加データを読み込めませんでした: ${error.message}`);
                return [];
            })
    ]);
    // 路線切替中は currentRouteId の更新より先に読込が完了するため、
    // 最新の読込要求かどうかだけで競合を判定する。
    if (loadId !== annotationLoadId) return;
    const merged = new Map(sharedRecords.map(record => [record.id, record]));
    for (const record of localRecords) merged.set(record.id, record);
    driveAnnotations = [...merged.values()].filter(record => !record.expiresAt || Date.parse(record.expiresAt) > Date.now());
}

function readLocalAnnotations(routeId) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("kp-viewer-user-layer", 1);
        request.onupgradeneeded = () => {
            const store = request.result.createObjectStore("items", { keyPath: "id" });
            store.createIndex("routeId", "routeId", { unique: false });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result;
            const read = db.transaction("items").objectStore("items").index("routeId").getAll(routeId);
            read.onsuccess = () => {
                db.close();
                resolve(read.result || []);
            };
            read.onerror = () => {
                db.close();
                reject(read.error);
            };
        };
    });
}

function annotationRouteKp(value, kpSystemId, road) {
    value = Number(value);
    if (!Number.isFinite(value) || !kpSystemId || kpSystemId === "route") return value;
    const systemSections = (road.sections || []).filter(section => section.kp_system === kpSystemId || section.id === kpSystemId);
    const section = systemSections.find(item => {
        const start = Math.min(Number(item.local_start_kp), Number(item.local_end_kp));
        const end = Math.max(Number(item.local_start_kp), Number(item.local_end_kp));
        return Number.isFinite(start) && Number.isFinite(end) && value >= start && value <= end;
    });
    if (!section) return NaN;
    return Number(section.route_start_km) + (value - Number(section.local_start_kp)) / (Number(section.kp_direction) || 1);
}

function annotationCategory(type) {
    if (type === "incident") return "incident";
    if (type === "construction") return "construction";
    return "other";
}

function annotationTypeLabel(type) {
    return ({
        incident: "事象・事故", construction: "工事・規制", tc: "TC", its: "ITS", cctv: "CCTV",
        electrical: "電気室", "bus-stop": "バスストップ", tunnel: "トンネル", bridge: "橋梁",
        ic: "IC・SIC", jct: "JCT", sa: "SA", pa: "PA", other: "その他"
    })[type] || type || "追加情報";
}

function readDriveLayerSettings() {
    try {
        return { ...DEFAULT_DRIVE_LAYERS, ...JSON.parse(localStorage.getItem(DRIVE_LAYER_STORAGE_KEY) || "{}") };
    } catch {
        return { ...DEFAULT_DRIVE_LAYERS };
    }
}

function setLayerMenuOpen(open) {
    layerMenu.hidden = !open;
    layerToggle.setAttribute("aria-expanded", String(open));
}

function beginRoadBrowse(event) {
    if (event.button !== 0 || !displayedMatch || event.target.closest("button")) return;
    dragState = { pointerId: event.pointerId, lastY: event.clientY };
    roadViewEl.setPointerCapture?.(event.pointerId);
    roadViewEl.classList.add("is-dragging");
}

function continueRoadBrowse(event) {
    if (!dragState || dragState.pointerId !== event.pointerId || !displayedMatch) return;
    const deltaY = event.clientY - dragState.lastY;
    dragState.lastY = event.clientY;
    if (Math.abs(deltaY) < .5) return;
    moveBrowseCenter(deltaY / PIXELS_PER_KM);
}

function endRoadBrowse(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    roadViewEl.releasePointerCapture?.(event.pointerId);
    dragState = null;
    roadViewEl.classList.remove("is-dragging");
}

function browseWithWheel(event) {
    if (!displayedMatch) return;
    event.preventDefault();
    moveBrowseCenter(event.deltaY * BROWSE_WHEEL_FACTOR / PIXELS_PER_KM);
}

function moveBrowseCenter(distanceAlongTravelKm) {
    const match = displayedMatch || lastMatch;
    if (!match) return;
    const directionSign = match.direction === "down" ? 1 : -1;
    const currentCenter = browseCenterRouteKp ?? Number(match.kp);
    browseCenterRouteKp = clampBrowseCenter(currentCenter + directionSign * distanceAlongTravelKm);
    scheduleBrowseRender();
}

function clampBrowseCenter(value) {
    if (!currentRoute?.road) return value;
    const bounds = routeKpBounds(currentRoute.road);
    if (!bounds) return value;
    return Math.max(bounds.min, Math.min(bounds.max, value));
}

function scheduleBrowseRender() {
    if (browseRenderFrame != null) return;
    browseRenderFrame = requestAnimationFrame(() => {
        browseRenderFrame = null;
        // 手動閲覧では路線図だけを再描画する。現在地KPの表示は、GPSまたは
        // 速度補間で算出した最新値を維持し、古いAPI応答値へ戻さない。
        if (displayedMatch) renderRoadItems(displayedMatch);
    });
}

function returnToCurrentPosition() {
    browseCenterRouteKp = null;
    scheduleBrowseRender();
}

function renderBrowseState(match, viewHeight, anchorY, viewKp) {
    const browsing = browseCenterRouteKp != null;
    followButton.hidden = !browsing;
    viewCenterEl.hidden = !browsing;
    currentEdgeEl.hidden = true;
    currentEdgeEl.className = "";
    referenceMarkerEl.hidden = true;

    const directionSign = match.direction === "down" ? 1 : -1;
    const distanceAlongTravelKm = (viewKp - Number(match.kp)) * directionSign;
    const markerY = anchorY + distanceAlongTravelKm * PIXELS_PER_KM;
    if (driveState === "standby" || driveState === "offroad") {
        currentMarkerEl.hidden = true;
        currentEdgeEl.hidden = true;
        viewCenterEl.hidden = true;
        referenceMarkerEl.hidden = false;
        referenceMarkerEl.style.top = `${anchorY}px`;
        const label = browsing ? "閲覧位置" : (match.nearest ? "最寄り位置" : "選択位置");
        referenceMarkerEl.textContent = `${label} ${formatRouteKp(viewKp, currentRoute.road)} KP`;
        followButton.textContent = match.nearest ? "最寄り位置へ戻る" : "選択位置へ戻る";
        return;
    }
    currentMarkerEl.style.top = `${markerY}px`;
    currentMarkerEl.hidden = markerY < -20 || markerY > viewHeight + 20;
    if (!browsing) return;

    viewCenterEl.hidden = true;
    referenceMarkerEl.hidden = false;
    referenceMarkerEl.style.top = `${anchorY}px`;
    referenceMarkerEl.textContent = `閲覧位置 ${formatRouteKp(viewKp, currentRoute.road)} KP`;
    const distance = Math.abs(distanceAlongTravelKm);
    followButton.textContent = `現在地へ戻る・${distance < 1 ? `${Math.round(distance * 1000)}m` : `${distance.toFixed(1)}km`}`;
    if (!currentMarkerEl.hidden) return;

    currentEdgeEl.hidden = false;
    const currentIsAbove = markerY < 0;
    currentEdgeEl.classList.add(currentIsAbove ? "is-top" : "is-bottom");
    currentEdgeEl.textContent = `${currentIsAbove ? "▲" : "▼"} 現在地 ${distance < 1 ? `${Math.round(distance * 1000)}m` : `${distance.toFixed(1)}km`}`;
}

function routeKpBounds(road) {
    const sectionValues = (road.sections || []).flatMap(section => [section.route_start_km, section.route_end_km]).filter(Number.isFinite);
    if (sectionValues.length >= 2) return { min: Math.min(...sectionValues), max: Math.max(...sectionValues) };

    const values = [];
    for (const facility of road.facilities || []) {
        for (const direction of ["up", "down"]) {
            const kp = itemRouteKp(facility, direction, road);
            if (Number.isFinite(kp)) values.push(kp);
        }
    }
    for (const structure of road.structures || []) {
        for (const direction of ["up", "down"]) {
            const range = structureRouteRange(structure, direction, road);
            if (range) values.push(range.start, range.end);
        }
    }
    return values.length >= 2 ? { min: Math.min(...values), max: Math.max(...values) } : null;
}

function formatRouteKp(routeKp, road) {
    const section = (road.sections || []).find(item => Number.isFinite(item.route_start_km)
        && Number.isFinite(item.route_end_km)
        && routeKp >= item.route_start_km
        && routeKp <= item.route_end_km);
    if (!section || !Number.isFinite(section.local_start_kp)) return routeKp.toFixed(2);
    return (section.local_start_kp + (routeKp - section.route_start_km) * (section.kp_direction || 1)).toFixed(2);
}

// 施設と構造物の文字を同じレーンで扱い、近接時は空いている側へ逃がしたうえで
// 上下方向にも間隔を確保する。KP上の本体位置は動かさず、文字だけを移動する。
function placeDriveLabels(labels, viewHeight) {
    const lanes = { left: [], right: [] };
    const sorted = [...labels].sort((a, b) => a.desiredY - b.desiredY);

    for (const label of sorted) {
        const otherSide = label.preferredSide === "left" ? "right" : "left";
        const preferredCost = laneCollisionCost(lanes[label.preferredSide], label);
        const otherCost = laneCollisionCost(lanes[otherSide], label);
        const side = otherCost + 8 < preferredCost ? otherSide : label.preferredSide;
        lanes[side].push(label);
        label.side = side;
    }

    for (const side of ["left", "right"]) {
        const lane = lanes[side].sort((a, b) => a.desiredY - b.desiredY);
        const margin = 15;
        const gap = 5;
        let cursor = margin;

        for (const label of lane) {
            const half = label.height / 2;
            label.placedY = Math.max(label.desiredY, cursor + half);
            cursor = label.placedY + half + gap;
        }

        // 下端を越えた分を後ろから押し戻し、狭い画面でも重なりを残さない。
        cursor = viewHeight - margin;
        for (let index = lane.length - 1; index >= 0; index -= 1) {
            const label = lane[index];
            const half = label.height / 2;
            label.placedY = Math.min(label.placedY, cursor - half);
            cursor = label.placedY - half - gap;
        }

        for (const label of lane) label.setPosition(label.placedY, side);
    }
}

function laneCollisionCost(lane, candidate) {
    return lane.reduce((cost, existing) => {
        const required = (existing.height + candidate.height) / 2 + 5;
        const distance = Math.abs(existing.desiredY - candidate.desiredY);
        return cost + Math.max(0, required - distance);
    }, 0);
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
    // タイムアウトや一時的な測位失敗でも監視を継続し、出口で復帰できるようにする。
    if (error.code !== 1 && driveState === "tracking") {
        beginTunnelEstimate();
        renderPredictedPosition();
        return;
    }
    if (displayedMatch || referenceMatch) {
        clearPositionWatch();
        statusEl.className = "is-error";
        statusEl.textContent = `${messages[error.code] || "位置情報を取得できませんでした。"} 参考位置は引き続き閲覧できます。`;
        return;
    }
    endWithError(messages[error.code] || "位置情報を取得できませんでした。");
}

function stopDriveMode({ message, returnToViewer = false } = {}) {
    clearPositionWatch();
    if (returnToViewer) {
        const target = new URL("viewer.html", location.href);
        if (currentRouteId) target.searchParams.set("route", currentRouteId);
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
    cancelAnimationFrame(browseRenderFrame);
    browseRenderFrame = null;
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
