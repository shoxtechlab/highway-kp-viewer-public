import { LAYOUT } from "./config.js";
import { STATE,COLORS } from "./config.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * SVG要素を生成する
 * @param {string} tag SVGタグ名
 * @param {Object} attrs 属性
 * @returns {SVGElement}
 */
export function createSVG(tag, attrs = {}) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  
    if (tag === "rect") {
      const h = Number(attrs.height);
      const w = Number(attrs.width);
  
      if (Number.isFinite(h) && h < 0) {
        console.error("NEGATIVE RECT HEIGHT", {
          attrs,
          stack: new Error().stack
        });
      }
  
      if (Number.isFinite(w) && w < 0) {
        console.error("NEGATIVE RECT WIDTH", {
          attrs,
          stack: new Error().stack
        });
      }
    }
  
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
  
    return el;
  }

/**
 * KP → SVGのY座標へ変換
 * @param {number} kp
 * @returns {number}
 */
export function kpToY(kp) {
    return LAYOUT.marginTop + STATE.terminalUnopenedOffset + (kp - STATE.viewStart) * STATE.scale;
}

/**
 * 路線中央X座標
 */
export function getCenterX() {

    return LAYOUT.centerX;

}

/**
 * 上り線(左)のX座標
 */
export function getUpRoadX() {

    return getCenterX() - LAYOUT.roadGap / 2 - LAYOUT.roadWidth;

}

/**
 * 下り線(右)のX座標
 */
export function getDownRoadX() {

    return getCenterX() + LAYOUT.roadGap / 2;

}

export function mouseYToKp(y) {
    return STATE.viewStart + (y - LAYOUT.marginTop - STATE.terminalUnopenedOffset) / STATE.scale;
}

export function detectLane(x) {

    const upX = getUpRoadX();
    const downX = getDownRoadX();

    const upCenter = upX + LAYOUT.roadWidth / 2;
    const downCenter = downX + LAYOUT.roadWidth / 2;

    const distToUp = Math.abs(x - upCenter);
    const distToDown = Math.abs(x - downCenter);

    return distToUp < distToDown ? "上り線" : "下り線";
}

export function getSvgPoint(e, svg) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;

    const ctm = svg.getScreenCTM();
    return pt.matrixTransform(ctm.inverse());
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

// export function kpToLatLon(index, targetKP) {

//     if (!index || index.length === 0) return null;

//     if (targetKP <= index[0].kp) {
//         return index[0];
//     }

//     if (targetKP >= index[index.length - 1].kp) {
//         return index[index.length - 1];
//     }

//     for (let i = 0; i < index.length - 1; i++) {

//         const a = index[i];
//         const b = index[i + 1];

//         if (targetKP >= a.kp && targetKP <= b.kp) {

//             const t = (targetKP - a.kp) / (b.kp - a.kp);

//             return {
//                 lon: lerp(a.lon, b.lon, t),
//                 lat: lerp(a.lat, b.lat, t),
//                 kp: targetKP
//             };
//         }
//     }

//     return null;
// }

export function toRad(d) {
  return d * Math.PI / 180;
}

export function toDeg(r) {
  return r * 180 / Math.PI;
}

// 2点から方位（heading）
export function calcHeading(p1, p2) {
  const lat1 = toRad(p1.lat);
  const lat2 = toRad(p2.lat);
  const dLon = toRad(p2.lon - p1.lon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  let brng = toDeg(Math.atan2(y, x));

  return (brng + 360) % 360;
}
