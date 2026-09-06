import { LAYOUT, STATE, COLORS } from "./config.js";
import { createSVG } from "./utils.js";

import { drawRoad } from "./road.js";
import { buildStructureCandidates } from "./structure.js";
import { buildFacilityCandidates } from "./facility.js";
import { layoutLabels } from "./layout.js";
import { drawScale } from "./scale.js";
import { kpToY, getUpRoadX, getDownRoadX } from "./utils.js";

/**
 * 高速道路SVG生成（純粋描画 + 入力フック）
 */
export function createExpresswaySvg(road, onClick) {

    const terminalUnopened = road.terminal_unopened;
    STATE.terminalUnopenedOffset = terminalUnopened && STATE.viewStart <= 0
        ? Number(terminalUnopened.display_height || 76)
        : 0;

    //------------------------------------
    // 高さ（論理座標）
    //------------------------------------

    const height =
        (STATE.viewEnd - STATE.viewStart) * STATE.scale +
        STATE.terminalUnopenedOffset +
        LAYOUT.marginTop +
        LAYOUT.marginBottom;

    //------------------------------------
    // SVG本体
    //------------------------------------

    const svg = createSVG("svg", {
        width: STATE.isMobile ? "100%" : LAYOUT.width,
        viewBox: `0 0 ${LAYOUT.width} ${height}`,
        preserveAspectRatio: "xMinYMin meet"
    });

    //------------------------------------
    // レイヤー生成
    //------------------------------------

    const layerNames = [
        "background",
        "road",
        "boundary",
        "structure",
        "facility",
        "scale",
        "marker",
        "overlay",
        "popup"
    ];

    const layers = {};

    layerNames.forEach(name => {

        const layer = createSVG("g", {
            id: `${name}-layer`
        });

        svg.appendChild(layer);

        layers[name] = layer;
    });

    //------------------------------------
    // 描画
    //------------------------------------

    drawScale(layers.scale, STATE.viewStart, STATE.viewEnd, road);
    drawRoad(layers.road, road);
    drawTerminalUnopened(layers.boundary, road);
    drawSectionBoundaries(layers.boundary, road);
    drawRoadNameLabels(layers.boundary, road);
    // drawStructures(layers.structure, road.structures);

    const structure = buildStructureCandidates(road.structures, {
        selectedStructure: road.selectedStructure
    });

    structure.bodies.forEach(body => {
        layers.structure.appendChild(body);
    });

    const facility = buildFacilityCandidates(road.facilities);

    const candidates = [
        ...structure.candidates,
        ...facility.candidates
    ];

    const upCandidates = candidates.filter(c => c.direction === "up");
    const downCandidates = candidates.filter(c => c.direction === "down");

    const upLayout = layoutLabels(
        upCandidates,
        c => c.centerY,
        c => c.minY,
        c => c.maxY,
        LAYOUT.labelHeight,
        c => c.priority
    );

    const downLayout = layoutLabels(
        downCandidates,
        c => c.centerY,
        c => c.minY,
        c => c.maxY,
        LAYOUT.labelHeight,
        c => c.priority
    );

    [...upLayout, ...downLayout].forEach(({ item, y }) => {
        item.draw(
            item.type === "structure"
                ? layers.structure
                : layers.facility,
            y
        );
    });

    drawSelectionMarker(layers.marker);

    //------------------------------------
    // 🎯 クリックイベント（外から注入）
    //------------------------------------

    if (typeof onClick === "function") {

        svg.addEventListener("click", (e) => {
            onClick(e, svg, road);
        });

    }

    return svg;
}

function drawTerminalUnopened(layer, road) {
    if (!STATE.terminalUnopenedOffset || !road.terminal_unopened) return;
    const item = road.terminal_unopened;
    const top = LAYOUT.marginTop;
    const bottom = top + STATE.terminalUnopenedOffset;
    const roadStartX = getUpRoadX();
    const roadEndX = getDownRoadX() + LAYOUT.roadWidth;

    // KP未設定の末端区間は、軸を描かず固定幅の空洞道路として表現する。
    for (const x of [getUpRoadX(), getDownRoadX()]) {
        layer.appendChild(createSVG("rect", {
            x, y: top, width: LAYOUT.roadWidth, height: STATE.terminalUnopenedOffset,
            fill: COLORS.canvas, stroke: COLORS.road, "stroke-width": 2,
            "pointer-events": "none"
        }));
    }
    const divisions = Array.isArray(item.segments) ? item.segments : [];
    divisions.forEach((segment, index) => {
        const y = top + (index + 0.5) * STATE.terminalUnopenedOffset / Math.max(1, divisions.length);
        const label = createSVG("text", {
            x: (roadStartX + roadEndX) / 2, y: y + 4,
            "text-anchor": "middle", "font-size": 11, "font-weight": 700,
            fill: document.body.classList.contains("dark-theme") ? "#f5f5f5" : "#555",
            "pointer-events": "none"
        });
        label.textContent = `${segment.name}（未開通）`;
        layer.appendChild(label);
        if (index > 0) {
            const lineY = top + index * STATE.terminalUnopenedOffset / divisions.length;
            layer.appendChild(createSVG("line", {
                x1: roadStartX, x2: roadEndX, y1: lineY, y2: lineY,
                stroke: COLORS.road, "stroke-width": 1, "pointer-events": "none"
            }));
        }
    });
    layer.appendChild(createSVG("line", {
        x1: roadStartX, x2: roadEndX, y1: bottom, y2: bottom,
        stroke: COLORS.road, "stroke-width": 1.5, "pointer-events": "none"
    }));
}

function drawRoadNameLabels(layer, road) {
    // 線形データを分割せず、KP体系も共通のまま路線名だけ変わる区間に対応する。
    // 例: E2 山陽道 → 広島岩国道路 → 山陽道。
    const sections = Array.isArray(road.road_name_segments) && road.road_name_segments.length
        ? road.road_name_segments
        : (Array.isArray(road.activeSections) ? road.activeSections : []);
    if (!sections.length) return;

    const visible = sections.filter(section =>
        Number.isFinite(section.route_start_km)
        && Number.isFinite(section.route_end_km)
        && section.route_end_km >= STATE.viewStart
        && section.route_start_km <= STATE.viewEnd
    );
    const centerX = (getUpRoadX() + getDownRoadX() + LAYOUT.roadWidth) / 2;

    visible.forEach((section, index) => {
        const previous = visible[index - 1];
        if (previous && previous.name === section.name) return;
        const routeKp = Math.max(STATE.viewStart, section.route_start_km);
        const y = kpToY(routeKp) + 12;
        const width = Math.min(180, Math.max(92, String(section.name || "").length * 13 + 18));

        layer.appendChild(createSVG("rect", {
            x: centerX - width / 2,
            y: y - 10,
            width,
            height: 18,
            rx: 9,
            fill: "#ffffff",
            stroke: "#7d8982",
            "stroke-width": 1,
            "pointer-events": "none"
        }));
        const text = createSVG("text", {
            x: centerX,
            y: y + 3,
            "text-anchor": "middle",
            "font-size": 11,
            "font-weight": 700,
            fill: "#39443e",
            "pointer-events": "none"
        });
        text.textContent = section.name;
        layer.appendChild(text);
    });
}

function drawSectionBoundaries(layer, road) {
    const sections = Array.isArray(road.road_name_segments) && road.road_name_segments.length
        ? road.road_name_segments
        : (Array.isArray(road.activeSections) ? road.activeSections : []);
    if (sections.length < 2) return;

    const connections = new Map(
        (road.section_connections || []).map(connection => [
            `${connection.from}:${connection.to}`,
            connection
        ])
    );
    const roadStartX = getUpRoadX();
    const roadEndX = getDownRoadX() + LAYOUT.roadWidth;

    for (let index = 1; index < sections.length; index++) {
        const from = sections[index - 1];
        const to = sections[index];
        const kp = to.route_start_km;
        if (!Number.isFinite(kp) || kp <= STATE.viewStart || kp >= STATE.viewEnd) continue;

        const connection = connections.get(`${from.id}:${to.id}`);
        const discontinuous = connection?.mode === "discontinuous";
        const unopened = connection?.mode === "unopened";
        const gapStart = from.route_end_km;
        const hasDisplayGap = (discontinuous || unopened)
            && Number.isFinite(gapStart)
            && to.route_start_km > gapStart;

        if (hasDisplayGap) {
            // 非接続区間は道路背景を実際に空け、連続しているように見せない。
            layer.appendChild(createSVG("rect", {
                class: "section-gap",
                x: roadStartX,
                y: kpToY(gapStart),
                width: roadEndX - roadStartX,
                height: kpToY(to.route_start_km) - kpToY(gapStart),
                fill: COLORS.canvas,
                "pointer-events": "none"
            }));

            if (unopened) {
                // 未開通区間はKP方向の長さを保ち、上下線を空洞の道路枠として示す。
                for (const x of [getUpRoadX(), getDownRoadX()]) {
                    layer.appendChild(createSVG("rect", {
                        class: "section-gap unopened-road",
                        x,
                        y: kpToY(gapStart),
                        width: LAYOUT.roadWidth,
                        height: kpToY(to.route_start_km) - kpToY(gapStart),
                        fill: COLORS.canvas,
                        stroke: COLORS.road,
                        "stroke-width": 2,
                        "pointer-events": "none"
                    }));
                }
            }
        }

        // 区間分割や未開通区間の終端だけでは横線を描かない。
        // 横線は、利用者に路線名の切り替わりを示す必要がある境界だけに限定する。
        const fromRoadName = String(from.name || "").trim();
        const toRoadName = String(to.name || "").trim();
        if (!fromRoadName || !toRoadName || fromRoadName === toRoadName) continue;

        const offsets = [0];

        for (const offset of offsets) {
            const y = kpToY(kp) + offset;
            const common = {
                class: `section-boundary${discontinuous ? " is-discontinuous" : ""}${unopened ? " is-unopened" : ""}`,
                y1: y,
                y2: y,
                "pointer-events": "none"
            };

            layer.appendChild(createSVG("line", {
                ...common,
                x1: 0,
                x2: 150,
                stroke: "#555",
                "stroke-width": 1.25
            }));
            layer.appendChild(createSVG("line", {
                ...common,
                x1: roadStartX,
                x2: roadEndX,
                stroke: (discontinuous || unopened) ? COLORS.canvas : "#f5f5f5",
                "stroke-width": 1.5
            }));
        }
    }
}

function drawSelectionMarker(layer) {
    if (!Number.isFinite(STATE.selectedKp)) return;

    const direction = STATE.selectedDirection === "down" ? "down" : "up";
    const roadX = direction === "up" ? getUpRoadX() : getDownRoadX();
    const centerX = roadX + LAYOUT.roadWidth / 2;
    const centerY = kpToY(STATE.selectedKp);

    layer.appendChild(createSVG("circle", {
        class: "selection-marker",
        cx: centerX,
        cy: centerY,
        r: 8,
        fill: "#d92d20",
        stroke: "#ffffff",
        "stroke-width": 3,
        "pointer-events": "none"
    }));
}
