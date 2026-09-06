import { LAYOUT, COLORS,STATE } from "./config.js";
import { createSVG, getUpRoadX, getDownRoadX } from "./utils.js";

/**
 * 本線（上下線）を描画する（シンプル版）
 */
export function drawRoad(layer, road) {

    const roadHeight = (STATE.viewEnd - STATE.viewStart) * STATE.scale;

    // 上り線
    layer.appendChild(createSVG("rect", {
        class: "road",
        "data-direction": "up",
        x: getUpRoadX(),
        y: LAYOUT.marginTop,
        width: LAYOUT.roadWidth,
        height: roadHeight,
        fill: COLORS.road
    }));

    // 下り線
    layer.appendChild(createSVG("rect", {
        class: "road",
        "data-direction": "down",
        x: getDownRoadX(),
        y: LAYOUT.marginTop,
        width: LAYOUT.roadWidth,
        height: roadHeight,
        fill: COLORS.road
    }));
}
