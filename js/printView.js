const PAGE_VIEWBOX_HEIGHT = 1040;
const SVG_WIDTH = 800;
const PAGE_WIDTH_MM = 190;

// iPadの「デスクトップ用Webサイト」ではMacを名乗るため、タッチ数も併用する。
// 画面幅では判定しない。通常Safari・Androidのstandaloneは現行方式を維持する。
export function isIosStandalone(environment) {
    const nav = globalThis.navigator;
    const values = environment || {
        userAgent: nav?.userAgent || "", platform: nav?.platform || "",
        maxTouchPoints: nav?.maxTouchPoints || 0, standalone: nav?.standalone === true,
        displayModeStandalone: globalThis.matchMedia?.("(display-mode: standalone)").matches === true
    };
    const ios = /iPad|iPhone|iPod/i.test(values.userAgent || "")
        || (/Mac/i.test(values.platform || "") && Number(values.maxTouchPoints) > 1);
    return ios && (values.standalone === true || values.displayModeStandalone === true);
}

export function openInlinePrintPreview(options) {
    if (document.querySelector(".inline-print-preview")) return;
    if (!document.querySelector('link[data-print-preview]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet"; link.href = new URL("../css/print-preview.css", import.meta.url).href;
        link.dataset.printPreview = "1"; document.head.appendChild(link);
    }
    const previousFocus = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.className = "inline-print-preview";
    dialog.setAttribute("aria-label", "印刷プレビュー");
    dialog.innerHTML = '<header><button type="button" data-print-back>路線図へ戻る</button><strong>印刷プレビュー</strong><button type="button" data-print-submit disabled>印刷・PDF</button></header><p role="status">読み込み中…</p><iframe title="印刷する路線図" sandbox="allow-same-origin allow-modals"></iframe>';
    const frame = dialog.querySelector("iframe");
    const submit = dialog.querySelector("[data-print-submit]");
    const status = dialog.querySelector('[role="status"]');
    const previousOverflow = document.body.style.overflow;
    dialog.querySelector("[data-print-back]").addEventListener("click", () => dialog.close());
    frame.addEventListener("load", () => {
        submit.disabled = false;
        status.textContent = "印刷の終了・キャンセル後も「路線図へ戻る」で戻れます。";
    }, { once: true });
    submit.addEventListener("click", () => {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); }
        catch { status.textContent = "印刷を開けませんでした。「路線図へ戻る」から戻れます。"; }
    });
    dialog.addEventListener("close", () => {
        document.body.style.overflow = previousOverflow;
        dialog.remove();
        // 隠れた印刷範囲フォームへは戻さず、常設のメニューボタンを優先する。
        (document.getElementById("mobile-menu-toggle") || previousFocus)?.focus({ preventScroll: true });
    }, { once: true });
    // 元ページを遷移・置換せず保持する。iOS側の履歴やwindow.closeには依存しない。
    frame.srcdoc = createPrintDocument({ ...options, autoPrint: false });
    document.body.appendChild(dialog);
    dialog.showModal(); document.body.style.overflow = "hidden";
}

export function preparePrintSvg(svg) {
    const clone = svg.cloneNode(true);
    clone.removeAttribute("width");
    clone.removeAttribute("height");
    // 印刷範囲内で現在表示されている施設・構造物・追加データはすべて残す。
    // 通常画面の操作UIはSVG外。SVG内ではランプ遷移・写真閲覧の操作ボタンを除外する。
    clone.querySelectorAll(".ramp-preview-link, .annotation-photo-button, .live-location-layer")
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

export function createPrintDocument({ svg, title, rangeLabel, autoPrint = true }) {
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
<html lang="ja" class="ui-v2"><head><meta charset="utf-8">${autoPrint ? "" : '<meta name="viewport" content="width=device-width, initial-scale=1">'}<title>${escapeHtml(title)} 印刷</title>
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
${autoPrint ? '<script>addEventListener("load",()=>setTimeout(()=>print(),250));<\/script>' : ""}
</body></html>`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}
