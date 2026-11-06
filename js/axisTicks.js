import { STATE, LAYOUT } from "./config.js";

// SVGのスマホ縮小も含め、数字付き目盛りに24画面px以上の間隔を確保する。
export function axisTickStep(kpToRouteRatio = 1) {
    const ratio = STATE.isMobile ? Math.min(1, Math.max(1, window.innerWidth - 16) / LAYOUT.width) : 1;
    const pixelsPerKp = STATE.scale * ratio * Math.abs(kpToRouteRatio);
    return [.1, .5, 1, 5, 10].find(step => step * pixelsPerKp >= 24) ?? 10;
}

export function* axisTicks(start, end, step) {
    const first = Math.ceil((start - 1e-9) / step);
    const last = Math.floor((end + 1e-9) / step);
    for (let index = first; index <= last; index++) yield Number((index * step).toFixed(6));
}
