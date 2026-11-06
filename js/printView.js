const PAGE_VIEWBOX_HEIGHT = 1040;
const SVG_WIDTH = 800;
const PAGE_WIDTH_MM = 190;

export function preparePrintSvg(svg) {
    const clone = svg.cloneNode(true);
    clone.removeAttribute("width");
    clone.removeAttribute("height");
    // 印刷範囲内で現在表示されている施設・構造物・追加データはすべて残す。
    // 通常画面の操作UIはSVG外にあるため、SVG内では試験用ランプ遷移ボタンだけを除外する。
    clone.querySelectorAll(".ramp-preview-link")
        .forEach(node => node.remove());
    clone.querySelectorAll("[tabindex]").forEach(node => node.removeAttribute("tabindex"));
    return clone;
}

export function buildPrintSlices(totalHeight, pageHeight = PAGE_VIEWBOX_HEIGHT) {
    const safeHeight = Math.max(1, Number(totalHeight) || 1);
    const safePageHeight = Math.max(1, Number(pageHeight) || PAGE_VIEWBOX_HEIGHT);
    const slices = [];
    for (let y = 0; y < safeHeight; y += safePageHeight) {
        slices.push({ y, height: Math.min(safePageHeight, safeHeight - y) });
    }
    return slices;
}

export function createPrintDocument({ svg, title, rangeLabel }) {
    const viewBox = svg.viewBox.baseVal;
    const slices = buildPrintSlices(viewBox.height);
    const serializer = new XMLSerializer();
    const sheets = slices.map((slice, index) => {
        const pageSvg = svg.cloneNode(true);
        pageSvg.setAttribute("viewBox", `0 ${slice.y} ${SVG_WIDTH} ${slice.height}`);
        pageSvg.setAttribute("width", `${PAGE_WIDTH_MM}mm`);
        pageSvg.setAttribute("height", `${slice.height / SVG_WIDTH * PAGE_WIDTH_MM}mm`);
        pageSvg.setAttribute("preserveAspectRatio", "xMinYMin meet");
        return `<section class="print-sheet" aria-label="${escapeHtml(`${index + 1}ページ`)}">${serializer.serializeToString(pageSvg)}</section>`;
    }).join("");
    return `<!doctype html>
<html lang="ja" class="ui-v2"><head><meta charset="utf-8"><title>${escapeHtml(title)} 印刷</title>
<link rel="stylesheet" href="${new URL("../css/style.css", import.meta.url).href}">
<link rel="stylesheet" href="${new URL("../css/ui-v2.css", import.meta.url).href}">
<style>
@page{size:A4 portrait;margin:10mm}
html,body{margin:0!important;padding:0!important;background:#fff!important;color:#1d2a22!important;color-scheme:light}
.print-heading{width:${PAGE_WIDTH_MM}mm;margin:0 auto 4mm;font-family:system-ui,sans-serif}
.print-heading h1{margin:0;font-size:15pt}.print-heading p{margin:1.5mm 0 0;color:#526159;font-size:9pt}
.print-sheet{width:${PAGE_WIDTH_MM}mm;margin:0 auto;break-after:page;page-break-after:always;overflow:hidden}
.print-sheet:last-child{break-after:auto;page-break-after:auto}
.print-sheet svg{display:block;width:${PAGE_WIDTH_MM}mm;max-width:none;background:#fff}
.route-diagram-v2 .v2-canvas{fill:#fff!important}
@media screen{body{padding:12mm 0!important}.print-sheet{margin-bottom:8mm;box-shadow:0 3px 18px #0002}.print-heading{position:sticky;top:0;z-index:3;background:#fff;padding:3mm 0}}
</style></head><body>
<header class="print-heading"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(rangeLabel)} ／ 表示中の縮尺を維持</p></header>
${sheets}
<script>addEventListener("load",()=>setTimeout(()=>print(),250));<\/script>
</body></html>`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}
