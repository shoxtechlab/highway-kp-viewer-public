import { STATE, LAYOUT } from "./config.js";
import "./appVersionNotice.js";
import { createExpresswaySvg } from "./svg.js";
import { fitSvgLabels } from "./labelFit.js";
import { mouseYToKp, getSvgPoint, kpToY } from "./utils.js";
import { initTheme } from "./theme.js";
import { resolveRouteScope } from "./routeScope.js";

async function fetchApi(path) {
    const response = await fetch(path);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(body?.error || `API request failed: ${response.status}`);
    }
    return body;
}

async function main() {
    const params = new URLSearchParams(location.search);
    const routeId = params.get("route") || "e28";
    const scopeId = params.get("scope");
    const portalId = params.get("portal");
    const requestedSectionIds = params.get("section")?.split(",").filter(Boolean) || [];
    const debugGpsEnabled = params.get("debugGps") === "1";

    const routeData = await fetchApi(`/api/route/${routeId}`);
    const road = routeData.road;
    const selectedSections = selectSections(road, requestedSectionIds);
    const kpSystems = buildKpSystems(road, selectedSections);

    const scope = await loadRouteScope(scopeId, routeId, road);
    const sectionRange = getSectionRouteRange(selectedSections, road.length, routeData.coordinateCoverage);
    STATE.viewStart = scope?.start ?? sectionRange.start;
    STATE.viewEnd = scope?.end ?? sectionRange.end;
    const sectionedRoad = createSectionedRoad(road, selectedSections);
    const viewRoad = scope ? createScopedRoad(sectionedRoad, scope) : sectionedRoad;

    const container = document.getElementById("app");
    const kpUI = document.getElementById("kp-ui");
    const kpInput = document.getElementById("kp-input");
    const directionInput = document.getElementById("direction-input");
    const kpSystemInput = document.getElementById("kp-system-input");
    const kpSystemField = document.getElementById("kp-system-field");
    let previousKpSystemValue = "route";
    const kpSubmit = document.getElementById("kp-submit");
    const gpsSubmit = document.getElementById("gps-submit");
    const kpError = document.getElementById("kp-error");
    const gpsStatus = document.getElementById("gps-status");
    const gpsDebug = document.getElementById("gps-debug");
    const debugLat = document.getElementById("debug-lat");
    const debugLon = document.getElementById("debug-lon");
    const debugAccuracy = document.getElementById("debug-accuracy");
    const debugGpsSubmit = document.getElementById("debug-gps-submit");
    const appTitle = document.getElementById("app-title");
    const routeTitle = document.getElementById("route-title");
    const structureVisibility = { BRIDGE: true, TUNNEL: true };
    initTheme({ onChange: () => render() });

    // 内部のup/downはAPI互換のため固定し、表示名だけ路線設定で変更する。
    const directionLabels = {
        up: road.direction_labels?.up || "上り",
        down: road.direction_labels?.down || "下り"
    };
    const directionLabel = direction => directionLabels[direction] || direction;
    for (const option of directionInput.options) {
        option.textContent = directionLabel(option.value);
    }

    const miniMapEl = document.getElementById("mini-map");
    let miniMap = null;
    let miniMarker = null;
    let mobileMiniMapOpen = false;
    let lastMiniMapPosition = null;

    gpsDebug.hidden = !debugGpsEnabled;


    const sectionTitle = requestedSectionIds.length
        ? selectedSections.map(section => section.name).join("＋")
        : null;
    const pageTitle = scope
        ? `${road.name || routeId.toUpperCase()} | ${scope.name}`
        : sectionTitle || road.name || routeId.toUpperCase();
    document.title = `${pageTitle} | KP Viewer`;
    const portalHomes = {
        national: "index.html",
        honshi: "honshi/"
    };
    const home = scope?.home || portalHomes[portalId] || road.home;
    if (appTitle && home) appTitle.href = home;
    if (routeTitle) routeTitle.textContent = pageTitle;
    const coverage = {
        up: buildCoverage("up"),
        down: buildCoverage("down")
    };
    configureStructureVisibilityControls();
    configureKpSystems();

    const hasRouteData = road.length > 0
        && coverage.up.length > 0
        && coverage.down.length > 0;
    if (!hasRouteData) {
        kpInput.disabled = true;
        directionInput.disabled = true;
        kpSubmit.disabled = true;
        gpsSubmit.disabled = true;
        kpError.textContent = "この路線のデータは準備中です。";
        kpError.classList.add("is-notice");
    }

    function updateScale() {
        const isMobile = window.innerWidth < LAYOUT.breakpoint;
        STATE.isMobile = isMobile;
        STATE.fitFactor = isMobile
            ? window.innerWidth / LAYOUT.breakpoint
            : 1;
        STATE.scale =
            STATE.baseScale *
            STATE.fitFactor *
            STATE.zoom;
    }

    async function updateKPUI(kp, lane) {
        if (kp == null || isNaN(kp)) return;

        const query = new URLSearchParams({ route: routeId, direction: lane, kp });
        const sv = await fetchApi(`/api/position?${query}`);
        if (!sv) {
            kpUI.hidden = true;
            return;
        }
        kpUI.hidden = false;
        lastMiniMapPosition = { lat: sv.lat, lon: sv.lon };

        if (!STATE.isMobile || mobileMiniMapOpen) {
            initMiniMap(sv.lat, sv.lon);

            if (miniMap && miniMarker) {
                miniMap.panTo([sv.lat, sv.lon]);
                miniMarker.setLatLng([sv.lat, sv.lon]);
            }
        }

        kpUI.innerHTML = `
            <button class="mini-map-toggle" type="button"
                aria-label="ミニマップを表示"
                aria-controls="mini-map" aria-expanded="false"
                title="ミニマップを表示">
                <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Z"></path>
                    <path d="M9 3v16M15 5v16"></path>
                </svg>
            </button>
            <a class="street-view-button" href="${sv.url}"
                target="_blank" rel="noopener noreferrer"
                aria-label="${directionLabel(lane)} ${formatPositionKp(sv)}をストリートビューで開く"
                title="${directionLabel(lane)} ${formatPositionKp(sv)}">
                <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M14 5h5v5M19 5l-8 8"></path>
                    <path d="M19 13v6H5V5h6"></path>
                </svg>
                <span class="button-label">ストリートビュー</span>
            </a>
        `;

        const miniMapToggle = kpUI.querySelector(".mini-map-toggle");
        if (miniMapToggle) {
            updateMobileMiniMapState(miniMapToggle);
            miniMapToggle.addEventListener("click", () => {
                mobileMiniMapOpen = !mobileMiniMapOpen;
                updateMobileMiniMapState(miniMapToggle);

                if (mobileMiniMapOpen && lastMiniMapPosition) {
                    initMiniMap(lastMiniMapPosition.lat, lastMiniMapPosition.lon);
                    miniMap?.panTo([lastMiniMapPosition.lat, lastMiniMapPosition.lon]);
                    miniMarker?.setLatLng([lastMiniMapPosition.lat, lastMiniMapPosition.lon]);
                    requestAnimationFrame(() => miniMap?.invalidateSize({ pan: false }));
                }
            });
        }
    }

    function updateMobileMiniMapState(toggle) {
        miniMapEl?.classList.toggle("is-mobile-open", STATE.isMobile && mobileMiniMapOpen);
        toggle.setAttribute("aria-expanded", String(mobileMiniMapOpen));
        toggle.setAttribute("aria-label", mobileMiniMapOpen ? "ミニマップを非表示" : "ミニマップを表示");
        toggle.title = mobileMiniMapOpen ? "ミニマップを非表示" : "ミニマップを表示";
        toggle.classList.toggle("is-active", mobileMiniMapOpen);
    }

    function render() {
        container.innerHTML = "";
        const svg = createExpresswaySvg({
            ...viewRoad,
            structures: visibleStructures(),
            selectedStructure: STATE.selectedStructure,
            activeScaleSystem: selectedKpSystem(),
            activeKpSystems: kpSystems
        }, handleClick);
        container.appendChild(svg);
        fitSvgLabels(svg);
    }

    function buildCoverage(direction) {
        const configured = road.coverage?.[direction];
        const indexRange = routeData.coordinateCoverage?.[direction] || null;

        if (Array.isArray(configured) && configured.length) {
            return configured
                .map(range => ({
                    start: Math.max(Number(range.start), indexRange?.start ?? -Infinity),
                    end: Math.min(Number(range.end), indexRange?.end ?? Infinity)
                }))
                .map(range => ({
                    start: Math.max(range.start, STATE.viewStart),
                    end: Math.min(range.end, STATE.viewEnd)
                }))
                .filter(range =>
                    Number.isFinite(range.start)
                    && Number.isFinite(range.end)
                    && range.end >= range.start
                );
        }

        if (indexRange) {
            const range = {
                start: Math.max(indexRange.start, STATE.viewStart),
                end: Math.min(indexRange.end, STATE.viewEnd)
            };
            return range.end >= range.start ? [range] : [];
        }

        return [];
    }

    function isKpCovered(kp, direction) {
        return coverage[direction]?.some(
            range => kp >= range.start && kp <= range.end
        );
    }

    function isKpInView(kp) {
        return kp >= STATE.viewStart && kp <= STATE.viewEnd;
    }

    function formatKp(kp) {
        return Number(kp.toFixed(3)).toString();
    }

    function coverageMessage(kp, direction) {
        const ranges = coverage[direction] || [];
        const rangeText = ranges.length
            ? ranges.map(range => `${formatKp(range.start)}〜${formatKp(range.end)}KP`).join("、")
            : "収録範囲なし";
        return `${formatKp(kp)}KPは座標データの収録範囲外です（対応範囲: ${rangeText}）。`;
    }

    function scopeMessage(kp, direction) {
        const directionText = directionLabel(direction);
        const sectionText = scope?.startName && scope?.endName
            ? `${scope.startName}〜${scope.endName}`
            : `${formatKp(STATE.viewStart)}〜${formatKp(STATE.viewEnd)}KP`;
        return `現在地（${directionText} ${formatKp(kp)}KP）は${scope.name}の表示区間外です（表示区間: ${sectionText}）。`;
    }

    function clearSelection() {
        STATE.selectedKp = null;
        STATE.selectedDirection = null;
        STATE.selectedStructure = null;
        kpUI.hidden = true;
        render();
    }

    function updateKpInputBounds() {
        const system = selectedKpSystem();
        if (system) {
            const localValues = system.sections
                .flatMap(section => [section.local_start_kp, section.local_end_kp])
                .filter(Number.isFinite);
            if (localValues.length) kpInput.min = String(Math.min(...localValues));
            else kpInput.removeAttribute("min");
            if (localValues.length) kpInput.max = String(Math.max(...localValues));
            else kpInput.removeAttribute("max");
            return;
        }
        const ranges = coverage[directionInput.value] || [];
        kpInput.min = String(ranges[0]?.start ?? STATE.viewStart);
        kpInput.max = String(ranges.at(-1)?.end ?? STATE.viewEnd);
    }

    async function handleKpSelect(kp, direction, name, options = {}) {
        kp = Math.max(STATE.viewStart, Math.min(STATE.viewEnd, kp));
        const unopened = unopenedConnectionAt(kp);
        if (unopened) {
            clearSelection();
            kpError.classList.add("is-notice");
            kpError.textContent = `${unopened.start_name}～${unopened.end_name}間は未開通です。`;
            return false;
        }
        if (!isKpCovered(kp, direction)) {
            kpError.classList.remove("is-notice");
            kpError.textContent = coverageMessage(kp, direction);
            clearSelection();
            return false;
        }

        selectKpSystemForRouteKp(kp);
        STATE.selectedKp = kp;
        STATE.selectedDirection = direction;
        const requestedStructure = options.structure
            || (options.selectStructureAtKp ? structureAtKp(kp, direction) : null);
        const togglesOff = options.toggleStructure
            && sameStructureSelection(STATE.selectedStructure, requestedStructure);
        STATE.selectedStructure = togglesOff ? null : requestedStructure;
        kpInput.value = routeToInputKp(kp).toFixed(2);
        directionInput.value = direction;
        kpError.classList.remove("is-notice");
        kpError.textContent = "";
        try {
            await updateKPUI(kp, direction);
        } catch (error) {
            console.error(error);
            kpError.textContent = "座標を取得できませんでした。しばらくしてから再試行してください。";
            clearSelection();
            return false;
        }
        if (options.notice) {
            kpError.classList.add("is-notice");
            kpError.textContent = options.notice;
        }
        render();
        return true;
    }

    async function submitKp() {
        const inputKp = Number(kpInput.value);
        const kp = inputToRouteKp(inputKp);
        if (!Number.isFinite(kp) || kp < STATE.viewStart || kp > STATE.viewEnd) {
            kpError.textContent = "選択した路線の収録KP範囲内で入力してください。";
            kpInput.focus();
            return;
        }
        if (await handleKpSelect(kp, directionInput.value, "指定位置", { selectStructureAtKp: true })) {
            scrollSelectionIntoView(kp);
        } else {
            kpInput.focus();
        }
    }

    function locateCurrentPosition() {
        kpError.textContent = "";

        if (!navigator.geolocation) {
            showGpsError("このブラウザは位置情報に対応していません。");
            return;
        }

        gpsSubmit.disabled = true;
        gpsSubmit.querySelector(".button-label").textContent = "測位中…";
        gpsStatus.className = "";
        gpsStatus.textContent = "現在地を取得しています。";

        navigator.geolocation.getCurrentPosition(
            handleGpsPosition,
            handleGpsError,
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 5000
            }
        );
    }

    async function handleGpsPosition(position) {
        resetGpsButton();

        await processGpsPoint({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracy: position.coords.accuracy
        }, "GPS");
    }

    async function submitDebugPosition() {
        if (!debugLat.value.trim() || !debugLon.value.trim() || !debugAccuracy.value.trim()) {
            showGpsError("デバッグ位置の緯度・経度・精度を入力してください。");
            return;
        }

        const point = {
            lat: Number(debugLat.value),
            lon: Number(debugLon.value),
            accuracy: Number(debugAccuracy.value)
        };

        if (
            !Number.isFinite(point.lat)
            || !Number.isFinite(point.lon)
            || !Number.isFinite(point.accuracy)
            || point.lat < -90
            || point.lat > 90
            || point.lon < -180
            || point.lon > 180
            || point.accuracy < 0
        ) {
            showGpsError("デバッグ位置の緯度・経度・精度を確認してください。");
            return;
        }

        await processGpsPoint(point, "デバッグ位置");
    }

    async function processGpsPoint(point, sourceLabel) {
        const query = new URLSearchParams({
            route: routeId,
            lat: point.lat,
            lon: point.lon,
            preferredDirection: directionInput.value
        });
        if (selectedSections.length && selectedSections.length !== road.sections?.length) {
            query.set("sections", selectedSections.map(section => section.id).join(","));
        }
        let match;
        try {
            match = await fetchApi(`/api/nearest?${query}`);
        } catch (error) {
            console.error(error);
            showGpsError("現在地を路線へ照合できませんでした。しばらくしてから再試行してください。");
            return;
        }

        if (!match) {
            showGpsError("現在地を路線へ照合できませんでした。");
            return;
        }

        const allowedDistanceM = Math.max(300, point.accuracy * 2);
        if (match.distanceM > allowedDistanceM) {
            showGpsError(
                `現在地は路線から約${formatDistance(match.distanceM)}離れています。`
            );
            return;
        }

        if (scope && !isKpInView(match.kp)) {
            clearSelection();
            showGpsError(scopeMessage(match.kp, match.direction));
            return;
        }

        if (!isKpCovered(match.kp, match.direction)) {
            clearSelection();
            showGpsError(coverageMessage(match.kp, match.direction));
            return;
        }

        const selected = await handleKpSelect(
            match.kp,
            match.direction,
            sourceLabel === "GPS" ? "現在地（GPS）" : sourceLabel
        );
        if (!selected) return;

        // nearest APIのkpは描画用の内部通算値。入力欄と同じ路線KPへ変換して表示する。
        const displayKp = routeToInputKp(match.kp);
        const directionNote = match.ambiguous ? "（方向は選択値を使用）" : "";
        gpsStatus.className = "is-success";
        gpsStatus.textContent = [
            `${directionLabel(match.direction)} ${displayKp.toFixed(2)} KP${directionNote}`,
            `道路から約${formatDistance(match.distanceM)}`,
            `${sourceLabel}精度±${formatDistance(point.accuracy)}`
        ].join(" / ");

        scrollSelectionIntoView(match.kp);
    }

    function handleGpsError(error) {
        const messages = {
            1: "位置情報の利用が許可されていません。ブラウザの設定を確認してください。",
            2: "現在地を取得できませんでした。電波状況を確認してください。",
            3: "現在地の取得がタイムアウトしました。"
        };
        showGpsError(messages[error.code] || "現在地を取得できませんでした。");
    }

    function showGpsError(message) {
        resetGpsButton();
        gpsStatus.className = "is-error";
        gpsStatus.textContent = message;
    }

    function resetGpsButton() {
        gpsSubmit.disabled = !hasRouteData;
        gpsSubmit.querySelector(".button-label").textContent = "現在地";
    }

    function formatDistance(distanceM) {
        if (!Number.isFinite(distanceM)) return "不明";
        if (distanceM < 1000) return `${Math.round(distanceM)}m`;
        return `${(distanceM / 1000).toFixed(1)}km`;
    }

    function scrollSelectionIntoView(kp) {
        const svg = container.querySelector("svg");
        if (!svg) return;

        const svgRect = svg.getBoundingClientRect();
        const logicalY = kpToY(kp);
        const renderedY = svgRect.top
            + logicalY * svgRect.height / svg.viewBox.baseVal.height;
        const targetY = window.scrollY + renderedY - window.innerHeight / 2;
        window.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
    }

    kpSubmit.addEventListener("click", submitKp);
    gpsSubmit.addEventListener("click", locateCurrentPosition);
    debugGpsSubmit.addEventListener("click", submitDebugPosition);
    directionInput.addEventListener("change", updateKpInputBounds);
    kpSystemInput.addEventListener("change", () => {
        const inputValue = Number(kpInput.value);
        if (kpInput.value.trim() && Number.isFinite(inputValue)) {
            const previousSystem = kpSystemById(previousKpSystemValue);
            const previousSection = sectionForInputKp(previousSystem, inputValue);
            const routeKp = inputToRouteKpForSystem(inputValue, previousSystem);
            const nextSection = nearestContinuouslyConnectedSection(
                previousSection,
                selectedKpSystem(),
                routeKp
            );
            const nextValue = routeToInputKpForSection(routeKp, nextSection);
            if (Number.isFinite(nextValue)) kpInput.value = formatKp(nextValue);
        }
        previousKpSystemValue = kpSystemInput.value;
        updateKpInputBounds();
        render();
    });
    kpInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") submitKp();
    });

    function handleClick(e, svg) {
        const target = e.target;

        const facility = target.closest(".facility");
        if (facility) {
            const selection = fitTerminalFacilityToCoverage({
                kp: Number(facility.dataset.kp),
                direction: facility.dataset.direction,
                name: facility.dataset.name,
                type: facility.dataset.type
            });
            handleKpSelect(
                selection.kp,
                facility.dataset.direction,
                facility.dataset.name,
                { notice: selection.notice }
            );
            return;
        }

        const structureLabel = target.closest(".structure-label");
        if (structureLabel) {
            handleKpSelect(
                Number(structureLabel.dataset.kp),
                structureLabel.dataset.direction,
                structureLabel.dataset.name,
                {
                    structure: structureSelectionFromElement(structureLabel),
                    toggleStructure: true
                }
            );
            return;
        }

        const structureBody = target.closest(".structure-body");
        if (structureBody) {
            const point = getSvgPoint(e, svg);
            handleKpSelect(
                mouseYToKp(point.y),
                structureBody.dataset.direction,
                structureBody.dataset.name,
                {
                    structure: structureSelectionFromElement(structureBody),
                    toggleStructure: true
                }
            );
            return;
        }

        const roadEl = target.closest(".road");
        if (roadEl) {
            const point = getSvgPoint(e, svg);
            handleKpSelect(
                mouseYToKp(point.y),
                roadEl.dataset.direction,
                "本線"
            );
        }
    }

    function structureSelectionFromElement(element) {
        return {
            name: element.dataset.name,
            type: element.dataset.type,
            direction: element.dataset.direction,
            start: Number(element.dataset.start),
            end: Number(element.dataset.end)
        };
    }

    function structureAtKp(kp, direction) {
        return visibleStructures()
            .filter(structure => structure.type === "BRIDGE" || structure.type === "TUNNEL")
            .map(structure => ({ structure, range: structure[direction] }))
            .filter(item => Number.isFinite(item.range?.start)
                && Number.isFinite(item.range?.end)
                && kp >= item.range.start
                && kp <= item.range.end)
            .sort((a, b) => (a.range.end - a.range.start) - (b.range.end - b.range.start))
            .map(item => ({
                name: item.structure.name,
                type: item.structure.type,
                direction,
                start: item.range.start,
                end: item.range.end
            }))[0] || null;
    }

    function visibleStructures() {
        return (viewRoad.structures || []).filter(structure =>
            structureVisibility[structure.type] !== false
        );
    }

    function configureStructureVisibilityControls() {
        const controls = [
            { id: "show-bridges", type: "BRIDGE", label: "橋梁" },
            { id: "show-tunnels", type: "TUNNEL", label: "トンネル" }
        ];

        for (const control of controls) {
            const input = document.getElementById(control.id);
            if (!input) continue;

            const available = (viewRoad.structures || []).some(
                structure => structure.type === control.type
            );
            input.checked = true;
            input.disabled = !available;
            input.closest("label")?.classList.toggle("is-unavailable", !available);
            const text = input.closest("label")?.querySelector("span");
            if (text) text.textContent = available ? control.label : `${control.label}（データなし）`;

            input.addEventListener("change", () => {
                structureVisibility[control.type] = input.checked;
                if (STATE.selectedStructure?.type === control.type && !input.checked) {
                    STATE.selectedStructure = null;
                }
                render();
            });
        }
    }

    function sameStructureSelection(a, b) {
        return Boolean(a && b)
            && a.name === b.name
            && a.type === b.type
            && a.direction === b.direction
            && a.start === b.start
            && a.end === b.end;
    }

    function configureKpSystems() {
        kpSystemInput.replaceChildren();
        if (!kpSystems.length) {
            kpSystemInput.add(new Option("路線KP", "route"));
        } else {
            kpSystems.forEach(system => kpSystemInput.add(new Option(system.name, system.id)));
        }
        if (road.default_kp_system && kpSystemById(road.default_kp_system)) {
            kpSystemInput.value = road.default_kp_system;
        }
        previousKpSystemValue = kpSystemInput.value;
        kpSystemField.hidden = kpSystems.length <= 1;
        updateKpInputBounds();
    }

    function fitTerminalFacilityToCoverage({ kp, direction, name, type }) {
        if (!Number.isFinite(kp) || !["IC", "JCT"].includes(type) || isKpCovered(kp, direction)) {
            return { kp, notice: "" };
        }

        const ranges = coverage[direction] || [];
        if (!ranges.length) return { kp, notice: "" };

        const terminalKps = (sectionedRoad.facilities || [])
            .filter(item => ["IC", "JCT"].includes(item.type))
            .map(item => item[direction]?.kp)
            .filter(Number.isFinite);
        if (!terminalKps.length) return { kp, notice: "" };

        const firstFacilityKp = Math.min(...terminalKps);
        const lastFacilityKp = Math.max(...terminalKps);
        const firstCoveredKp = ranges[0].start;
        const lastCoveredKp = ranges.at(-1).end;
        const isSameKp = (left, right) => Math.abs(left - right) < 1e-6;

        let fittedKp = null;
        if (isSameKp(kp, firstFacilityKp) && kp < firstCoveredKp) fittedKp = firstCoveredKp;
        if (isSameKp(kp, lastFacilityKp) && kp > lastCoveredKp) fittedKp = lastCoveredKp;
        if (!Number.isFinite(fittedKp)) return { kp, notice: "" };

        return {
            kp: fittedKp,
            notice: `${name}は座標収録範囲外のため、最寄りの${formatKp(fittedKp)}KPを表示しています。`
        };
    }

    function selectedKpSystem() {
        return kpSystemById(kpSystemInput.value);
    }

    function kpSystemById(systemId) {
        return kpSystems.find(system => system.id === systemId) || null;
    }

    function selectKpSystemForRouteKp(routeKp) {
        if (kpSystems.length <= 1 || !Number.isFinite(routeKp)) return;

        const system = kpSystems.find(item => item.sections.some((section, index) => {
            const sections = item.sections;
            const isLast = index === sections.length - 1;
            return Number.isFinite(section.route_start_km)
                && Number.isFinite(section.route_end_km)
                && routeKp >= section.route_start_km
                && (routeKp < section.route_end_km || (isLast && routeKp <= section.route_end_km));
        }));

        if (!system || kpSystemInput.value === system.id) return;
        kpSystemInput.value = system.id;
        previousKpSystemValue = system.id;
        updateKpInputBounds();
    }

    function sectionForRouteKp(system, routeKp) {
        return system?.sections.find((item, index) => {
            if (![item.route_start_km, item.route_end_km].every(Number.isFinite)) return false;
            const isLast = index === system.sections.length - 1;
            return routeKp >= item.route_start_km
                && (routeKp < item.route_end_km || (isLast && routeKp <= item.route_end_km));
        }) || null;
    }

    function sectionForInputKp(system, value) {
        return system?.sections.find(item => {
            if (![item.local_start_kp, item.local_end_kp].every(Number.isFinite)) return false;
            const start = Math.min(item.local_start_kp, item.local_end_kp);
            const end = Math.max(item.local_start_kp, item.local_end_kp);
            return value >= start && value <= end;
        }) || null;
    }

    function nearestContinuouslyConnectedSection(sourceSection, targetSystem, routeKp) {
        if (!sourceSection || !targetSystem || !Number.isFinite(routeKp)) return null;
        const connectedIds = new Set([sourceSection.id]);
        const connections = road.section_connections || [];
        let changed = true;
        while (changed) {
            changed = false;
            for (const connection of connections) {
                if (connection.mode !== "continuous") continue;
                if (connectedIds.has(connection.from) && !connectedIds.has(connection.to)) {
                    connectedIds.add(connection.to);
                    changed = true;
                }
                if (connectedIds.has(connection.to) && !connectedIds.has(connection.from)) {
                    connectedIds.add(connection.from);
                    changed = true;
                }
            }
        }
        return targetSystem.sections
            .filter(section => connectedIds.has(section.id))
            .sort((left, right) => distanceFromRouteRange(left, routeKp) - distanceFromRouteRange(right, routeKp))[0]
            || null;
    }

    function distanceFromRouteRange(section, routeKp) {
        if (routeKp < section.route_start_km) return section.route_start_km - routeKp;
        if (routeKp > section.route_end_km) return routeKp - section.route_end_km;
        return 0;
    }

    function inputToRouteKp(value) {
        return inputToRouteKpForSystem(value, selectedKpSystem());
    }

    function inputToRouteKpForSystem(value, system) {
        if (!system) return value;
        // 同一路線内にKPの飛びがある場合、範囲外値を先頭区間から外挿しない。
        const section = sectionForInputKp(system, value);
        if (!section) {
            const unopened = unopenedConnectionForInputKp(system, value);
            if (!unopened) return NaN;
            const from = road.sections.find(item => item.id === unopened.from);
            const to = road.sections.find(item => item.id === unopened.to);
            const ratio = (value - from.local_end_kp) / (to.local_start_kp - from.local_end_kp);
            return from.route_end_km + ratio * (to.route_start_km - from.route_end_km);
        }
        if (![section.route_start_km, section.local_start_kp, section.kp_direction].every(Number.isFinite)) return NaN;
        return section.route_start_km + (value - section.local_start_kp) / section.kp_direction;
    }

    function unopenedConnectionForInputKp(system, value) {
        if (!system || !Number.isFinite(value)) return null;
        const systemSectionIds = new Set(system.sections.map(section => section.id));
        return (road.section_connections || []).find(connection => {
            if (connection.mode !== "unopened") return false;
            if (!systemSectionIds.has(connection.from) || !systemSectionIds.has(connection.to)) return false;
            const from = road.sections.find(item => item.id === connection.from);
            const to = road.sections.find(item => item.id === connection.to);
            return Number.isFinite(from?.local_end_kp)
                && Number.isFinite(to?.local_start_kp)
                && value > Math.min(from.local_end_kp, to.local_start_kp)
                && value < Math.max(from.local_end_kp, to.local_start_kp);
        }) || null;
    }

    function unopenedConnectionAt(routeKp) {
        return (viewRoad.section_connections || []).find(connection => {
            if (connection.mode !== "unopened") return false;
            const from = viewRoad.activeSections?.find(item => item.id === connection.from)
                || road.sections?.find(item => item.id === connection.from);
            const to = viewRoad.activeSections?.find(item => item.id === connection.to)
                || road.sections?.find(item => item.id === connection.to);
            return Number.isFinite(from?.route_end_km)
                && Number.isFinite(to?.route_start_km)
                && routeKp > from.route_end_km
                && routeKp < to.route_start_km;
        }) || null;
    }

    function routeToInputKp(value) {
        return routeToInputKpForSystem(value, selectedKpSystem());
    }

    function routeToInputKpForSystem(value, system) {
        if (!system) return value;
        const section = sectionForRouteKp(system, value);
        return routeToInputKpForSection(value, section);
    }

    function routeToInputKpForSection(value, section) {
        if (!section) return NaN;
        if (![section.route_start_km, section.local_start_kp, section.kp_direction].every(Number.isFinite)) return NaN;
        return section.local_start_kp + (value - section.route_start_km) * section.kp_direction;
    }

    function formatPositionKp(position) {
        if (!position.section) return `${position.kp.toFixed(2)} KP`;
        const section = road.sections.find(item => item.id === position.section);
        return `${section?.name || position.section} ${position.localKp.toFixed(2)} KP`;
    }

    function initMiniMap(lat, lon) {
        if (!miniMapEl) return;
        if (miniMap) return;

        miniMap = L.map("mini-map", {
            zoomControl: false,
            attributionControl: true
        }).setView([lat, lon], 15);

        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(miniMap);

        miniMarker = L.marker([lat, lon]).addTo(miniMap);
        if (!STATE.isMobile) initMiniMapResize();
    }

    function initMiniMapResize() {
        if (!miniMapEl || miniMapEl.querySelector(".mini-map-resize-handle")) return;

        const minWidth = 220;
        const minHeight = 180;
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "mini-map-resize-handle";
        handle.setAttribute("aria-label", "ミニマップのサイズを変更");
        handle.title = "ドラッグしてミニマップを拡大・縮小";
        miniMapEl.appendChild(handle);

        L.DomEvent.disableClickPropagation(handle);
        L.DomEvent.disableScrollPropagation(handle);

        handle.addEventListener("pointerdown", event => {
            if (event.button !== 0) return;
            event.preventDefault();

            const rect = miniMapEl.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            const startWidth = rect.width;
            const startHeight = rect.height;
            let resizeFrame = null;

            handle.setPointerCapture(event.pointerId);
            document.body.classList.add("mini-map-resizing");

            const resize = moveEvent => {
                const maxWidth = Math.max(minWidth, window.innerWidth - 20);
                const maxHeight = Math.max(minHeight, window.innerHeight - rect.top - 10);
                const width = Math.max(minWidth, Math.min(maxWidth, startWidth + startX - moveEvent.clientX));
                const height = Math.max(minHeight, Math.min(maxHeight, startHeight + moveEvent.clientY - startY));

                miniMapEl.style.width = `${Math.round(width)}px`;
                miniMapEl.style.height = `${Math.round(height)}px`;

                if (resizeFrame) cancelAnimationFrame(resizeFrame);
                resizeFrame = requestAnimationFrame(() => miniMap?.invalidateSize({ pan: false }));
            };

            const finish = () => {
                document.body.classList.remove("mini-map-resizing");
                handle.removeEventListener("pointermove", resize);
                handle.removeEventListener("pointerup", finish);
                handle.removeEventListener("pointercancel", finish);
                miniMap?.invalidateSize({ pan: false });
            };

            handle.addEventListener("pointermove", resize);
            handle.addEventListener("pointerup", finish);
            handle.addEventListener("pointercancel", finish);
        });
    }

    updateScale();
    updateKpInputBounds();
    render();

    window.addEventListener("resize", () => {
        const prev = STATE.isMobile;
        updateScale();

        if (prev !== STATE.isMobile || STATE.isMobile) {
            render();
        }

        if (!STATE.isMobile && lastMiniMapPosition) {
            miniMapEl?.classList.remove("is-mobile-open");
            initMiniMap(lastMiniMapPosition.lat, lastMiniMapPosition.lon);
            requestAnimationFrame(() => miniMap?.invalidateSize({ pan: false }));
        } else if (STATE.isMobile) {
            miniMapEl?.classList.toggle("is-mobile-open", mobileMiniMapOpen);
        }
    });

    const zoomControls = document.createElement("div");
    zoomControls.id = "zoom-controls";

    const slider = document.createElement("input");

    slider.type = "range";
    slider.className = "zoom-slider";
    slider.min = "0.5";
    slider.max = "3.0";
    slider.step = "0.1";
    slider.value = "1";
    slider.setAttribute("aria-label", "路線図の表示倍率");

    const zoomButtons = document.createElement("div");
    zoomButtons.className = "zoom-buttons";

    const zoomOut = document.createElement("button");
    zoomOut.type = "button";
    zoomOut.textContent = "−";
    zoomOut.setAttribute("aria-label", "縮小");

    const zoomIn = document.createElement("button");
    zoomIn.type = "button";
    zoomIn.textContent = "＋";
    zoomIn.setAttribute("aria-label", "拡大");

    function setZoom(value) {
        STATE.zoom = Math.max(0.5, Math.min(3, Math.round(value * 10) / 10));
        slider.value = String(STATE.zoom);
        zoomOut.disabled = STATE.zoom <= 0.5;
        zoomIn.disabled = STATE.zoom >= 3;
        updateScale();
        render();
    }

    slider.addEventListener("input", (e) => {
        setZoom(Number(e.target.value));
    });

    zoomOut.addEventListener("click", () => setZoom(STATE.zoom - 0.1));
    zoomIn.addEventListener("click", () => setZoom(STATE.zoom + 0.1));
    zoomButtons.addEventListener("dblclick", event => event.preventDefault());

    zoomButtons.append(zoomOut, zoomIn);
    zoomControls.append(slider, zoomButtons);
    document.body.appendChild(zoomControls);
    setZoom(STATE.zoom);
}

async function loadRouteScope(scopeId, routeId, road) {
    if (!scopeId) return null;

    const scopes = await fetch("./data/route-scopes.json").then(r => {
        if (!r.ok) throw new Error(`表示範囲設定を読み込めません: ${r.status}`);
        return r.json();
    });
    const group = scopes[scopeId];
    if (!group || !group.routes?.[routeId]) {
        throw new Error(`表示範囲が定義されていません: ${scopeId}/${routeId}`);
    }
    return resolveRouteScope(group, routeId, road);
}

function createScopedRoad(road, scope) {
    const scopeStructure = item => {
        const result = copyWithoutDirections(item);

        for (const direction of ["down", "up"]) {
            const lane = item[direction];
            if (
                !Number.isFinite(lane?.start)
                || !Number.isFinite(lane?.end)
                || lane.end < scope.start
                || lane.start > scope.end
            ) continue;

            result[direction] = {
                ...lane,
                start: Math.max(lane.start, scope.start),
                end: Math.min(lane.end, scope.end)
            };
        }

        return result.down || result.up ? result : null;
    };

    const scopeFacility = item => {
        const result = copyWithoutDirections(item);

        for (const direction of ["down", "up"]) {
            const lane = item[direction];
            if (!Number.isFinite(lane?.kp) || lane.kp < scope.start || lane.kp > scope.end) continue;
            result[direction] = { ...lane };
        }

        return result.down || result.up ? result : null;
    };

    return {
        ...road,
        structures: (road.structures || []).map(scopeStructure).filter(Boolean),
        facilities: (road.facilities || []).map(scopeFacility).filter(Boolean)
    };
}

function copyWithoutDirections(item) {
    return Object.fromEntries(
        Object.entries(item).filter(([key]) => key !== "down" && key !== "up")
    );
}

function selectSections(road, requestedIds) {
    if (!Array.isArray(road.sections) || !road.sections.length) return [];
    const ids = requestedIds.length ? requestedIds : (road.default_sections || road.sections.map(section => section.id));
    const selected = road.sections.filter(section => ids.includes(section.id));
    if (requestedIds.length && selected.length !== new Set(requestedIds).size) {
        throw new Error("指定された道路区間が見つかりません。");
    }
    return selected;
}

function buildKpSystems(road, sections) {
    if (!sections.length) return [];

    const metadata = new Map(
        (road.kp_systems || []).map(system => [system.id, system])
    );
    const systems = [];
    const byId = new Map();

    for (const section of sections) {
        const systemId = section.kp_system || section.id;
        let system = byId.get(systemId);
        if (!system) {
            const configured = metadata.get(systemId) || {};
            system = {
                ...configured,
                id: systemId,
                name: configured.name || section.scale_label || section.name,
                scale_label: configured.scale_label || configured.name || section.scale_label || section.name,
                sections: []
            };
            byId.set(systemId, system);
            systems.push(system);
        }
        system.sections.push(section);
    }

    return systems;
}

function getSectionRouteRange(sections, fallbackEnd, coordinateCoverage) {
    if (!sections.length) {
        // 名神のように公式KPが0以外から始まる単一路線では、座標収録範囲を
        // そのまま描画範囲に使い、存在しない0KP側の余白を作らない。
        const ranges = Object.values(coordinateCoverage || {}).filter(Boolean);
        const starts = ranges.map(range => range.start).filter(Number.isFinite);
        const ends = ranges.map(range => range.end).filter(Number.isFinite);
        return {
            start: starts.length ? Math.min(...starts) : 0,
            end: ends.length ? Math.max(...ends) : fallbackEnd
        };
    }
    const starts = sections.map(section => section.route_start_km).filter(Number.isFinite);
    const ends = sections.map(section => section.route_end_km).filter(Number.isFinite);
    return {
        start: starts.length ? Math.min(...starts) : 0,
        end: ends.length === sections.length ? Math.max(...ends) : fallbackEnd
    };
}

function createSectionedRoad(road, sections) {
    if (!sections.length) return road;
    const selectedIds = new Set(sections.map(section => section.id));
    const sectionById = new Map(sections.map(section => [section.id, section]));
    const convertLane = (lane, section, kind) => {
        if (!lane || !section) return lane;
        const convert = localKp => section.route_start_km + (localKp - section.local_start_kp) / section.kp_direction;
        if (kind === "facility") {
            if (!Number.isFinite(lane.kp)) return lane;
            const convertedKp = convert(lane.kp);
            // 台帳KPが座標収録端よりわずかに外側でも、隣の不連続区間へ誤配置しない。
            const kp = Math.max(section.route_start_km, Math.min(section.route_end_km, convertedKp));
            return { ...lane, local_kp: lane.kp, kp };
        }
        return Number.isFinite(lane.start) && Number.isFinite(lane.end)
            ? { ...lane, local_start: lane.start, local_end: lane.end, start: convert(lane.start), end: convert(lane.end) }
            : lane;
    };
    const convertItems = (items, kind) => (items || []).flatMap(item => {
        if (item.section && !selectedIds.has(item.section)) return [];
        const section = sectionById.get(item.section);
        if (!section && item.section) return [];
        return [{
            ...item,
            down: convertLane(item.down, section, kind),
            up: convertLane(item.up, section, kind)
        }];
    });
    return {
        ...road,
        activeSections: sections,
        structures: convertItems(road.structures, "structure"),
        facilities: convertItems(road.facilities, "facility")
    };
}

main().catch((error) => {
    console.error(error);
    const app = document.getElementById("app");
    app.innerHTML = '<p class="load-error">路線データを読み込めませんでした。路線一覧から選び直してください。</p>';
});
