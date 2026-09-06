import { LAYOUT } from "./config.js";
import { createSVG, kpToY } from "./utils.js";

/**
 * KP目盛り描画
 */
export function drawScale(layer, startKP, endKP, road = {}) {

    const sections = Array.isArray(road.activeSections) && road.activeSections.length
        ? road.activeSections
        : null;
    if (sections) {
        const systemsOnly = road.scale_layout === "systems_only";
        if (!systemsOnly) drawCorridorScale(layer, startKP, endKP, road);
        // KP体系の軸が通算軸と同じ表示になる路線は、冗長な2本目を省略できる。
        if (road.scale_layout === "single") return;
        const systems = road.activeKpSystems || sections.map(section => ({
            id: section.id,
            name: section.scale_label || section.name,
            sections: [section]
        }));
        const selectedSystemId = road.activeScaleSystem?.id || systems[0].id;
        systems.forEach(system => {
            drawKpSystemScale(layer, system, startKP, endKP, systemsOnly ? 0 : 1, system.id === selectedSystemId);
        });
        return;
    }

    drawSingleScale(layer, startKP, endKP, 0, "");
}

function drawCorridorScale(layer, viewStart, viewEnd, road) {
    const segments = Array.isArray(road.axis_segments) && road.axis_segments.length
        ? road.axis_segments
        : [{ route_start_km: viewStart, route_end_km: viewEnd, kp_start: viewStart, kp_end: viewEnd }];

    segments.forEach((segment, index) => {
        const routeStart = Math.max(viewStart, segment.route_start_km);
        const routeEnd = Math.min(viewEnd, segment.route_end_km);
        if (routeEnd < routeStart) return;
        const direction = (segment.kp_end - segment.kp_start) / (segment.route_end_km - segment.route_start_km);
        const kpStart = segment.kp_start + (routeStart - segment.route_start_km) * direction;
        const kpEnd = segment.kp_start + (routeEnd - segment.route_start_km) * direction;
        drawSingleScale(
            layer,
            Math.min(kpStart, kpEnd),
            Math.max(kpStart, kpEnd),
            0,
            index === 0 ? `${road.id?.toUpperCase() || "路線"}通算` : "",
            kp => segment.route_start_km + (kp - segment.kp_start) / direction
        );
        const previous = segments[index - 1];
        const hasKpJump = previous
            && Number.isFinite(previous.kp_end)
            && Number.isFinite(segment.kp_start)
            && Math.abs(previous.kp_end - segment.kp_start) > 1e-6;
        if (index > 0 && routeStart > viewStart && (segment.break_before || hasKpJump)) {
            drawAxisBreak(layer, routeStart, 0);
        }
    });
}

function drawKpSystemScale(layer, system, viewStart, viewEnd, index, emphasized) {
    if (Array.isArray(system.axis_segments) && system.axis_segments.length) {
        let titleDrawn = false;
        for (const segment of system.axis_segments) {
            const routeStart = Math.max(viewStart, segment.route_start_km);
            const routeEnd = Math.min(viewEnd, segment.route_end_km);
            if (routeEnd < routeStart) continue;
            const direction = (segment.kp_end - segment.kp_start) / (segment.route_end_km - segment.route_start_km);
            const kpStart = segment.kp_start + (routeStart - segment.route_start_km) * direction;
            const kpEnd = segment.kp_start + (routeEnd - segment.route_start_km) * direction;
            drawSingleScale(
                layer,
                Math.min(kpStart, kpEnd),
                Math.max(kpStart, kpEnd),
                index * 72,
                titleDrawn ? "" : (system.scale_label || system.name),
                kp => segment.route_start_km + (kp - segment.kp_start) / direction,
                { emphasized, headingY: routeStart <= viewStart ? 18 : kpToY(routeStart) + 18 }
            );
            titleDrawn = true;
        }
        return;
    }
    let titleDrawn = false;
    for (const section of system.sections) {
        const visible = section.route_end_km >= viewStart && section.route_start_km <= viewEnd;
        if (!visible) continue;
        drawSectionScale(
            layer,
            section,
            viewStart,
            viewEnd,
            index,
            emphasized,
            titleDrawn ? "" : (system.scale_label || system.name)
        );
        titleDrawn = true;
    }
}

function drawAxisBreak(layer, routeKp, xOffset) {
    const y = kpToY(routeKp);
    layer.appendChild(createSVG("line", {
        x1: xOffset,
        y1: y,
        x2: xOffset + 54,
        y2: y,
        stroke: "#999",
        "stroke-width": 1.25
    }));
}

function drawSectionScale(layer, section, viewStart, viewEnd, index, emphasized = false, title = section.scale_label || section.name) {
    if (![section.route_start_km, section.local_start_kp, section.kp_direction].every(Number.isFinite)) return;
    const routeStart = Math.max(viewStart, section.route_start_km);
    const routeEnd = Math.min(viewEnd, Number.isFinite(section.route_end_km) ? section.route_end_km : viewEnd);
    if (routeEnd < routeStart) return;
    const localStart = section.local_start_kp + (routeStart - section.route_start_km) * section.kp_direction;
    const localEnd = section.local_start_kp + (routeEnd - section.route_start_km) * section.kp_direction;
    const headingY = routeStart <= viewStart
        ? 18
        : kpToY(routeStart) + 18;
    drawSingleScale(
        layer,
        Math.min(localStart, localEnd),
        Math.max(localStart, localEnd),
        index * 72,
        title,
        localKp => section.route_start_km + (localKp - section.local_start_kp) / section.kp_direction,
        { emphasized, headingY }
    );
}

function drawSingleScale(
    layer,
    startKP,
    endKP,
    xOffset = 0,
    title = "",
    toRouteKp = value => value,
    { emphasized = false, headingY = 18 } = {}
) {

    const step = 5; // 5km刻み（後で可変化）

    const firstKP = Math.ceil(startKP / step) * step;

    for (let kp = firstKP; kp <= endKP; kp += step) {

        const y = kpToY(toRouteKp(kp));

        //--------------------------------
        // グループ
        //--------------------------------

        const g = createSVG("g", {
            class: "scale-item"
        });

        //--------------------------------
        // ライン
        //--------------------------------

        g.appendChild(createSVG("line", {
            x1: xOffset,
            y1: y,
            x2: xOffset + 10,
            y2: y,
            stroke: "#999",
            "stroke-width": emphasized ? 2 : 1
        }));

        //--------------------------------
        // テキスト
        //--------------------------------

        const text = createSVG("text", {
            x: xOffset + 15,
            y: y + 4,
            "font-size": LAYOUT.scaleFontSize,
            fill: emphasized ? "#333" : "#666",
            "font-weight": emphasized ? 700 : 400
        });

        text.textContent = `${kp} km`;

        g.appendChild(text);

        layer.appendChild(g);
    }

    if (title) {
        const heading = createSVG("text", {
            x: xOffset,
            y: headingY,
            "font-size": LAYOUT.scaleFontSize,
            fill: emphasized ? "#222" : "#555",
            "font-weight": emphasized ? 700 : 400
        });
        heading.textContent = title;
        layer.appendChild(heading);
    }
}
