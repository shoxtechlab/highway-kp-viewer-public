// 字数だけでなく実際の文字幅から算出する（英字・和文が混ざる路線名にも対応）。
export function driveTitleFontSize(textWidth, availableWidth, max = 18, min = 10) {
    if (!(textWidth > 0) || !(availableWidth > 0)) return max;
    return Math.max(min, Math.min(max, Math.floor(max * availableWidth / textWidth * 10) / 10));
}

export function initDriveHeaderTitle(element) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const portrait = matchMedia("(orientation: portrait) and (max-width: 799px)");
    let frame;
    function fit() {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            if (!portrait.matches || !context) { element.style.fontSize = ""; return; }
            const style = getComputedStyle(element);
            context.font = `${style.fontWeight} 18px ${style.fontFamily}`;
            const width = context.measureText(element.textContent).width;
            element.style.fontSize = `${driveTitleFontSize(width, element.clientWidth)}px`;
        });
    }
    new ResizeObserver(fit).observe(element);
    portrait.addEventListener("change", fit);
    document.fonts?.ready.then(fit);
    fit();
    return fit;
}
