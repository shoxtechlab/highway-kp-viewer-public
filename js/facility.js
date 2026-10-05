import { LAYOUT, COLORS } from "./config.js";
import { kpToY, createSVG, getUpRoadX, getDownRoadX } from "./utils.js";
import { getLabelStyle } from "./styleRules.js";

const ETC_ONLY_ICON_URL = new URL("../icons/etc-only.png", import.meta.url).href;

export function buildFacilityCandidates(facilities) {

    const candidates = [];
    facilities.forEach(item => {

        if (item.up && hasDirectionAccess(item, "up")) {
            candidates.push({
                type: "facility",
                direction: "up",
                required: true,

                centerY: kpToY(item.up.kp),
                minY: -Infinity,
                maxY: Infinity,
                priority: 0,

                draw(layer, y) {
                    layer.appendChild(
                        createFacility(
                            item,
                            item.up.kp,
                            "up",
                            y
                        )
                    );
                }
            });
        }

        if (item.down && hasDirectionAccess(item, "down")) {
            candidates.push({
                type: "facility",
                direction: "down",
                required: true,

                centerY: kpToY(item.down.kp),
                minY: -Infinity,
                maxY: Infinity,
                priority: 0,

                draw(layer, y) {
                    layer.appendChild(
                        createFacility(
                            item,
                            item.down.kp,
                            "down",
                            y
                        )
                    );
                }
            });
        }
    });

    return {
        candidates
    };

}

function createFacility(facility, kp, direction, labelY = null) {

    const rampMode = getRampMode(facility, direction);

    const group = createSVG("g", {
        class: "facility",
        "data-name": facility.name,
        "data-type": facility.type,
        "data-direction": direction,
        "data-kp": kp,
        "data-ramps": facility.ramps || "ABCD"
    });

    const style = getLabelStyle({
        kind: "facility",
        ...facility
    });

    const baseY = kpToY(kp);

    const y = labelY ?? baseY;

    const roadEdge = direction === "up"
        ? getUpRoadX()
        : getDownRoadX() + LAYOUT.roadWidth;

    const boxX = direction === "up"
        ? roadEdge - LAYOUT.labelMargin - LAYOUT.labelWidth
        : roadEdge + LAYOUT.labelMargin;

    group.appendChild(createSVG("line", {
        x1: direction === "up"
            ? boxX + LAYOUT.labelWidth
            : boxX,
        y1: y,
        x2: roadEdge,
        y2: baseY,
        stroke: COLORS.leaderLine,
        "stroke-width": 1.5,
        opacity: 0.7
    }));

    group.appendChild(createSVG("rect", {
        x: boxX,
        y: y - LAYOUT.labelHeight / 2,
        width: LAYOUT.labelWidth,
        height: LAYOUT.labelHeight,
        rx: 5,
        fill: style.fill,
        stroke:  style.stroke,
        "stroke-width": 1.5
    }));

    const hasRampIcon = rampMode === "entry" || rampMode === "exit";
    // SICは施設種別そのものがETC専用を示すため、通常ICのETC専用指定だけにバッジを付ける。
    const hasEtcOnlyIcon = facility.type === "IC" && facility.etcOnly === true;
    const rampTextOffset = hasRampIcon ? (direction === "up" ? -8 : 8) : 0;
    const etcTextOffset = hasEtcOnlyIcon ? (direction === "up" ? 8 : -8) : 0;
    const textOffset = rampTextOffset + etcTextOffset;

    const text = createSVG("text", {
        class: "facility-label-text",
        x: boxX + LAYOUT.labelWidth / 2 + textOffset,
        y,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        "font-size": LAYOUT.labelFontSize,
        opacity: 1,
        fill: style.text
    });

    text.textContent = facility.name;
    group.appendChild(text);

    if (hasRampIcon) {
        group.appendChild(createRampIcon(
            boxX,
            y,
            direction,
            rampMode,
            style.text
        ));
    }

    if (hasEtcOnlyIcon) {
        group.appendChild(createEtcOnlyIcon(boxX, y, direction));
    }

    return group;
}

function createEtcOnlyIcon(boxX, y, direction) {
    const width = 21;
    const height = 14;
    const x = direction === "up"
        ? boxX + 4
        : boxX + LAYOUT.labelWidth - width - 4;

    return createSVG("image", {
        class: `facility-etc-icon ${direction}`,
        href: ETC_ONLY_ICON_URL,
        x,
        y: y - height / 2,
        width,
        height,
        preserveAspectRatio: "xMidYMid meet",
        "pointer-events": "none"
    });
}

function hasDirectionAccess(facility, direction) {
    return getRampMode(facility, direction) !== "none";
}

function getRampMode(facility, direction) {
    if ((facility.type !== "IC" && facility.type !== "SIC") || !facility.ramps) {
        return "both";
    }

    const entryRamp = direction === "up" ? "A" : "C";
    const exitRamp = direction === "up" ? "B" : "D";
    const hasEntry = facility.ramps.includes(entryRamp);
    const hasExit = facility.ramps.includes(exitRamp);

    if (hasEntry && hasExit) return "both";
    if (hasEntry) return "entry";
    if (hasExit) return "exit";
    return "none";
}

function createRampIcon(boxX, y, direction, mode, color) {
    const iconSize = 16;
    const iconX = direction === "up"
        ? boxX + LAYOUT.labelWidth - iconSize - 5
        : boxX + 5;
    const iconY = y - iconSize / 2;
    const icon = createSVG("g", {
        class: `facility-ramp-icon ${direction}-${mode}`,
        transform: `translate(${iconX} ${iconY})`,
        fill: "none",
        stroke: color,
        "stroke-width": 1.7,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "pointer-events": "none"
    });

    const paths = {
        "up-entry": ["M2 13 H8 Q13 13 13 8 V3", "M10 6 L13 3 L16 6"],
        "up-exit": ["M13 13 V8 Q13 3 8 3 H2", "M5 0 L2 3 L5 6"],
        "down-entry": ["M14 3 H8 Q3 3 3 8 V13", "M0 10 L3 13 L6 10"],
        "down-exit": ["M3 3 V8 Q3 13 8 13 H14", "M11 10 L14 13 L11 16"]
    };

    paths[`${direction}-${mode}`].forEach(d => {
        icon.appendChild(createSVG("path", { d }));
    });

    return icon;
}
