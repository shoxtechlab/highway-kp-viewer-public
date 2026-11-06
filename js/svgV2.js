import { LAYOUT, STATE } from "./config.js";
import { createSVG, kpToY } from "./utils.js";
import { layoutLabels } from "./layout.js";
import { axisTickStep, axisTicks } from "./axisTicks.js";

const G = {
    width: 800,
    axisX: 400,
    upX: 350,
    downX: 424,
    roadWidth: 26,
    leftCardX: 46,
    rightCardX: 508,
    cardWidth: 246,
    facilityHeight: 36,
    structureHeight: 29
};

const COLORS = {
    ink: "#1d2a22",
    muted: "#68786e",
    rail: "#69766e",
    railEdge: "#435149",
    axis: "#a9b8ae",
    ic: "#087f3e",
    rest: "#e8f5ec",
    restInk: "#17633a",
    sic: "#7b2b83",
    bridge: "#ed9227",
    bridgeSoft: "#fff2df",
    tunnel: "#2779bd",
    tunnelSoft: "#eaf4fc",
    selected: "#e1251b"
};

export function createExpresswaySvgV2(road, onClick) {
    const terminal = road.terminal_unopened;
    STATE.terminalUnopenedOffset = terminal && STATE.viewStart <= 0
        ? Number(terminal.display_height || 76)
        : 0;
    const height = (STATE.viewEnd - STATE.viewStart) * STATE.scale
        + STATE.terminalUnopenedOffset + LAYOUT.marginTop + LAYOUT.marginBottom;
    const svg = createSVG("svg", {
        class: "route-diagram-v2",
        width: STATE.isMobile ? "100%" : G.width,
        viewBox: `0 0 ${G.width} ${height}`,
        preserveAspectRatio: "xMinYMin meet",
        role: "group",
        "aria-label": `${road.name || "高速道路"} 路線図`
    });
    const layers = Object.fromEntries(["background","axis","rail","segment","labels","focus"].map(name => {
        const layer = createSVG("g", { class: `v2-${name}-layer` });
        svg.appendChild(layer);
        return [name, layer];
    }));

    drawCanvas(layers.background, height);
    drawAxis(layers.axis, height, road);
    drawRails(layers.rail, height);
    drawTerminalGap(layers.segment, road);
    drawSectionChanges(layers.segment, road);
    drawStructures(layers.segment, road.structures || [], road.selectedStructure);
    drawLabels(layers.labels, road);
    drawFocus(layers.focus);

    if (typeof onClick === "function") svg.addEventListener("click", event => onClick(event, svg, road));
    return svg;
}

function drawCanvas(layer, height) {
    layer.appendChild(createSVG("rect", { x: 0, y: 0, width: G.width, height, rx: 18, class: "v2-canvas" }));
    const title = text(G.axisX, 24, "DISTANCE", { class: "v2-axis-title", "text-anchor": "middle" });
    layer.appendChild(title);
}

function drawAxis(layer, height, road) {
    const top = kpToY(STATE.viewStart);
    const bottom = kpToY(STATE.viewEnd);
    layer.appendChild(createSVG("line", { x1: G.axisX, x2: G.axisX, y1: top, y2: bottom, class: "v2-kp-spine" }));
    const sections = Array.isArray(road.activeSections) ? road.activeSections : [];
    // 複数のKP体系を持つ路線は、通算距離ではなく現地標識と同じ路線KPを主表示にする。
    if (sections.length > 1) {
        for (const section of sections) drawSectionAxis(layer, section);
        return;
    }
    const step = axisTickStep();
    for (const kp of axisTicks(STATE.viewStart, STATE.viewEnd, step)) {
        const y = kpToY(kp);
        const major = kp % 5 === 0;
        layer.appendChild(createSVG("circle", { cx: G.axisX, cy: y, r: major ? 4.5 : 2.2, class: major ? "v2-kp-dot major" : "v2-kp-dot" }));
        {
            const label = text(G.axisX, y - 8, `${formatKp(kp)} KP`, { class: "v2-kp-label", "text-anchor": "middle" });
            layer.appendChild(label);
        }
    }
}

function drawSectionAxis(layer, section) {
    if (![section.route_start_km, section.route_end_km, section.local_start_kp, section.kp_direction].every(Number.isFinite)) return;
    const routeStart = Math.max(STATE.viewStart, section.route_start_km);
    const routeEnd = Math.min(STATE.viewEnd, section.route_end_km);
    if (routeEnd < routeStart) return;
    const localAtStart = section.local_start_kp + (routeStart - section.route_start_km) * section.kp_direction;
    const localAtEnd = section.local_start_kp + (routeEnd - section.route_start_km) * section.kp_direction;
    const low = Math.min(localAtStart, localAtEnd);
    const high = Math.max(localAtStart, localAtEnd);
    const step = axisTickStep(1 / section.kp_direction);
    for (const localKp of axisTicks(low, high, step)) {
        const routeKp = section.route_start_km + (localKp - section.local_start_kp) / section.kp_direction;
        const y = kpToY(routeKp);
        const major = localKp % 5 === 0;
        layer.appendChild(createSVG("circle", { cx: G.axisX, cy: y, r: major ? 4.5 : 2.2, class: major ? "v2-kp-dot major" : "v2-kp-dot" }));
        {
            layer.appendChild(text(G.axisX, y - 8, `${formatKp(localKp)} KP`, { class: "v2-kp-label", "text-anchor": "middle" }));
        }
    }
}

function drawRails(layer, height) {
    const top = kpToY(STATE.viewStart);
    const bottom = kpToY(STATE.viewEnd);
    for (const direction of ["up", "down"]) {
        const x = roadX(direction);
        layer.appendChild(createSVG("rect", {
            class: `road v2-rail ${direction}`,
            "data-direction": direction,
            x, y: top, width: G.roadWidth, height: bottom - top, rx: 13
        }));
        const chipX = x + G.roadWidth / 2;
        const chip = createSVG("g", { class: `v2-direction-chip ${direction}` });
        chip.appendChild(createSVG("rect", { x: chipX - 31, y: 12, width: 62, height: 25, rx: 12.5 }));
        chip.appendChild(text(chipX, 29, direction === "up" ? "上り ↑" : "下り ↓", { "text-anchor": "middle" }));
        layer.appendChild(chip);
        const interval = Math.max(8, Math.round(180 / STATE.scale));
        for (let kp = Math.ceil(STATE.viewStart / interval) * interval; kp <= STATE.viewEnd; kp += interval) {
            const y = kpToY(kp) + 15;
            layer.appendChild(text(chipX, y, direction === "up" ? "↑" : "↓", { class: "v2-flow-arrow", "text-anchor": "middle" }));
        }
    }
}

function drawStructures(layer, structures, selected) {
    for (const item of structures) {
        for (const direction of ["up", "down"]) {
            const range = item[direction];
            if (!Number.isFinite(range?.start) || !Number.isFinite(range?.end)) continue;
            if (range.end < STATE.viewStart || range.start > STATE.viewEnd) continue;
            const start = Math.max(range.start, STATE.viewStart);
            const end = Math.min(range.end, STATE.viewEnd);
            const active = selected && selected.structureKey === item.structureKey && selected.name === item.name && selected.type === item.type
                && selected.direction === direction && selected.start === range.start && selected.end === range.end;
            layer.appendChild(createSVG("rect", {
                class: `structure-body v2-structure-band ${String(item.type).toLowerCase()}${active ? " is-selected" : ""}`,
                "data-name": item.name, "data-type": item.type, "data-direction": direction,
                "data-structure-key": item.structureKey,
                "data-start": range.start, "data-end": range.end,
                x: roadX(direction) - 2, y: kpToY(start), width: G.roadWidth + 4,
                height: Math.max(2, kpToY(end) - kpToY(start)), rx: 3
            }));
        }
    }
}

function drawLabels(layer, road) {
    const candidates = [];
    for (const facility of road.facilities || []) {
        for (const direction of ["up", "down"]) {
            const data = facility[direction];
            if (!Number.isFinite(data?.kp) || !hasAccess(facility, direction)) continue;
            if (data.kp < STATE.viewStart || data.kp > STATE.viewEnd) continue;
            candidates.push({ kind: "facility", item: facility, data, direction, centerY: kpToY(data.kp), required: true, priority: 1000 });
        }
    }
    for (const structure of road.structures || []) {
        for (const direction of ["up", "down"]) {
            const data = structure[direction];
            if (!Number.isFinite(data?.start) || !Number.isFinite(data?.end)) continue;
            if (data.end < STATE.viewStart || data.start > STATE.viewEnd) continue;
            candidates.push({
                kind: "structure", item: structure, data, direction,
                centerY: kpToY((data.start + data.end) / 2), required: false,
                priority: data.end - data.start,
                minY: kpToY(data.start) - 28, maxY: kpToY(data.end) + 28
            });
        }
    }
    for (const direction of ["up", "down"]) {
        const directional = candidates.filter(candidate => candidate.direction === direction);
        const placed = layoutLabels(
            directional,
            item => item.centerY,
            item => item.minY ?? -Infinity,
            item => item.maxY ?? Infinity,
            39,
            item => item.priority
        );
        for (const { item, y } of placed) {
            layer.appendChild(item.kind === "facility" ? facilityCard(item, y) : structureTag(item, y));
        }
    }
}

function facilityCard(candidate, y) {
    const { item, data, direction } = candidate;
    const x = cardX(direction), h = G.facilityHeight;
    const selected = STATE.selectedFacility?.name === item.name
        && STATE.selectedFacility?.type === item.type
        && STATE.selectedFacility?.direction === direction
        && Math.abs(STATE.selectedFacility?.kp - data.kp) < 1e-9;
    const group = createSVG("g", {
        class: `facility v2-facility-card type-${String(item.type || "ic").toLowerCase()} ${facilityTone(item)}${selected ? " is-selected" : ""}`,
        "data-name": item.name, "data-type": item.type, "data-direction": direction,
        "data-kp": data.kp, "data-ramps": item.ramps || "ABCD",
        tabindex: 0,
        role: "button",
        "aria-pressed": String(selected),
        "aria-label": `${item.name} ${direction} ${data.kp} KP`
    });
    connector(group, direction, x, y, candidate.centerY);
    group.appendChild(createSVG("rect", { x, y: y - h / 2, width: G.cardWidth, height: h, rx: 9, class: "v2-card-bg" }));
    const ramp = rampMode(item, direction);
    const hasRamp = ramp === "entry" || ramp === "exit";
    const hasEtc = item.type === "IC" && item.etcOnly === true;
    const nameShift = (hasRamp ? (direction === "up" ? -10 : 10) : 0)
        + (hasEtc ? (direction === "up" ? 11 : -11) : 0);
    group.appendChild(text(x + G.cardWidth / 2 + nameShift, y + 1, item.name, { class: "facility-label-text v2-card-name", "text-anchor": "middle" }));
    if (hasRamp) group.appendChild(rampIcon(x, y, direction, ramp));
    if (hasEtc) group.appendChild(etcBadge(x, y, direction));
    return group;
}

function rampIcon(boxX, y, direction, mode) {
    const iconX = direction === "up" ? boxX + G.cardWidth - 23 : boxX + 7;
    const icon = createSVG("g", {
        class: `v2-ramp-icon ${direction}-${mode}`,
        transform: `translate(${iconX} ${y - 8})`, fill: "none",
        "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round",
        "pointer-events": "none"
    });
    const paths = {
        "up-entry": ["M2 13 H8 Q13 13 13 8 V3", "M10 6 L13 3 L16 6"],
        "up-exit": ["M13 13 V8 Q13 3 8 3 H2", "M5 0 L2 3 L5 6"],
        "down-entry": ["M14 3 H8 Q3 3 3 8 V13", "M0 10 L3 13 L6 10"],
        "down-exit": ["M3 3 V8 Q3 13 8 13 H14", "M11 10 L14 13 L11 16"]
    };
    paths[`${direction}-${mode}`].forEach(d => icon.appendChild(createSVG("path", { d })));
    return icon;
}

function etcBadge(boxX, y, direction) {
    const width = 30;
    const x = direction === "up" ? boxX + 7 : boxX + G.cardWidth - width - 7;
    const group = createSVG("g", { class: "v2-etc-badge", "pointer-events": "none" });
    group.appendChild(createSVG("rect", { x, y: y - 10, width, height: 20, rx: 5 }));
    group.appendChild(text(x + width / 2, y + 4, "ETC", { "text-anchor": "middle" }));
    return group;
}

function structureTag(candidate, y) {
    const { item, data, direction } = candidate;
    const x = cardX(direction) + 18, width = G.cardWidth - 36, h = G.structureHeight;
    const selected = STATE.selectedStructure
        && STATE.selectedStructure.structureKey === item.structureKey
        && STATE.selectedStructure.name === item.name
        && STATE.selectedStructure.type === item.type
        && STATE.selectedStructure.direction === direction
        && STATE.selectedStructure.start === data.start
        && STATE.selectedStructure.end === data.end;
    const group = createSVG("g", {
        class: `structure-label v2-structure-tag ${String(item.type).toLowerCase()}${selected ? " is-selected" : ""}`,
        "data-name": item.name, "data-type": item.type, "data-direction": direction,
        "data-kp": direction === "up" ? data.end : data.start,
        "data-structure-key": item.structureKey,
        "data-start": data.start, "data-end": data.end,
        tabindex: 0,
        role: "button",
        "aria-pressed": String(Boolean(selected)),
        "aria-label": `${item.name} ${direction} ${data.start}–${data.end} KP`
    });
    connector(group, direction, x, y, candidate.centerY, width);
    group.appendChild(createSVG("rect", { x, y: y - h / 2, width, height: h, rx: 12.5, class: "v2-tag-bg" }));
    group.appendChild(createSVG("circle", { cx: x + 14, cy: y, r: 5, class: "v2-structure-symbol" }));
    group.appendChild(text(x + 26, y + 4.5, item.name, { class: "structure-label-text v2-tag-name" }));
    return group;
}

function connector(group, direction, x, y, anchorY, width = G.cardWidth) {
    const railEdge = direction === "up" ? G.upX : G.downX + G.roadWidth;
    const cardEdge = direction === "up" ? x + width : x;
    group.appendChild(createSVG("path", {
        d: `M${railEdge} ${anchorY} C${(railEdge + cardEdge) / 2} ${anchorY},${(railEdge + cardEdge) / 2} ${y},${cardEdge} ${y}`,
        class: "v2-connector"
    }));
    group.appendChild(createSVG("circle", { cx: railEdge, cy: anchorY, r: 3.5, class: "v2-anchor-dot" }));
}

function drawFocus(layer) {
    if (!Number.isFinite(STATE.selectedKp) || !["up", "down"].includes(STATE.selectedDirection)) return;
    const cx = roadX(STATE.selectedDirection) + G.roadWidth / 2;
    const cy = kpToY(STATE.selectedKp);
    layer.appendChild(createSVG("circle", { cx, cy, r: 14, class: "v2-focus-ring" }));
    layer.appendChild(createSVG("circle", { cx, cy, r: 5, class: "v2-focus-dot" }));
    const labelX = STATE.selectedDirection === "up" ? cx - 25 : cx + 25;
    const anchor = STATE.selectedDirection === "up" ? "end" : "start";
    const displayKp = Number.isFinite(STATE.selectedDisplayKp)
        ? STATE.selectedDisplayKp
        : STATE.selectedKp;
    layer.appendChild(text(labelX, cy - 17, `${displayKp.toFixed(2)} KP`, { class: "v2-focus-label", "text-anchor": anchor }));
}

function drawSectionChanges(layer, road) {
    const sections = road.road_name_segments?.length ? road.road_name_segments : road.activeSections || [];
    sections.forEach((section, index) => {
        if (!Number.isFinite(section.route_start_km) || section.route_start_km < STATE.viewStart || section.route_start_km > STATE.viewEnd) return;
        if (index && sections[index - 1]?.name === section.name) return;
        const y = kpToY(Math.max(STATE.viewStart, section.route_start_km));
        const width = Math.min(210, Math.max(92, String(section.name || "").length * 12 + 24));
        layer.appendChild(createSVG("rect", { x: G.axisX - width / 2, y: y + 10, width, height: 22, rx: 11, class: "v2-section-chip" }));
        layer.appendChild(text(G.axisX, y + 25, section.name, { class: "v2-section-text", "text-anchor": "middle" }));
    });
    const connections = new Map((road.section_connections || []).map(item => [`${item.from}:${item.to}`, item]));
    for (let index = 1; index < sections.length; index++) {
        const from = sections[index - 1], to = sections[index], connection = connections.get(`${from.id}:${to.id}`);
        if (!connection || !["unopened", "discontinuous"].includes(connection.mode)) continue;
        if (!Number.isFinite(from.route_end_km) || !Number.isFinite(to.route_start_km)) continue;
        for (const direction of ["up", "down"]) {
            layer.appendChild(createSVG("rect", {
                x: roadX(direction) - 1, y: kpToY(from.route_end_km), width: G.roadWidth + 2,
                height: Math.max(4, kpToY(to.route_start_km) - kpToY(from.route_end_km)),
                class: `v2-route-gap ${connection.mode}`
            }));
        }
    }
}

function drawTerminalGap(layer, road) {
    if (!STATE.terminalUnopenedOffset || !road.terminal_unopened) return;
    const top = LAYOUT.marginTop, height = STATE.terminalUnopenedOffset;
    for (const direction of ["up", "down"]) layer.appendChild(createSVG("rect", {
        x: roadX(direction), y: top, width: G.roadWidth, height, rx: 8, class: "v2-route-gap unopened"
    }));
    layer.appendChild(text(G.axisX, top + height / 2 + 4, "未開通", { class: "v2-gap-text", "text-anchor": "middle" }));
}

function hasAccess(item, direction) { return rampMode(item, direction) !== "none"; }
function rampMode(item, direction) {
    if (!item.ramps || !["IC", "SIC"].includes(item.type)) return "both";
    const entry = direction === "up" ? "A" : "C", exit = direction === "up" ? "B" : "D";
    const hasEntry = item.ramps.includes(entry), hasExit = item.ramps.includes(exit);
    return hasEntry && hasExit ? "both" : hasEntry ? "entry" : hasExit ? "exit" : "none";
}
function facilityTone(item) {
    // ETC専用の通常ICはIC本体を緑のまま保ち、紫色はETCバッジだけに使う。
    if (item.type === "SIC") return "is-sic";
    if (["SA", "PA"].includes(item.type)) return "is-rest";
    return "is-interchange";
}
function roadX(direction) { return direction === "up" ? G.upX : G.downX; }
function cardX(direction) { return direction === "up" ? G.leftCardX : G.rightCardX; }
function formatKp(value) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function text(x, y, value, attrs = {}) {
    const element = createSVG("text", { x, y, ...attrs });
    element.textContent = value ?? "";
    return element;
}
