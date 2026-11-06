import { findStructureForElement } from "./structureIdentity.js";

// 諸元は描画用の範囲切り詰め・KP変換前のroadから取得する。
export function initStructureDetails(container, road, directionLabel) {
    const popup = document.createElement("aside");
    popup.className = "structure-details";
    popup.hidden = true;
    popup.setAttribute("role", "status");
    document.body.appendChild(popup);
    let selectedKey = null;
    let pinned = false;
    const hide = () => { popup.hidden = true; selectedKey = null; pinned = false; };
    const labelFrom = target => target.closest?.(".structure-label");

    function show(label, pin) {
        const direction = label.dataset.direction;
        const structure = findStructureForElement(road, label);
        const lane = structure?.[direction];
        if (!lane) return;
        const key = `${structure.structureKey}:${direction}`;
        if (pin && pinned && selectedKey === key) { hide(); return; }
        selectedKey = key;
        pinned = pin;
        popup.replaceChildren();
        const title = document.createElement("strong");
        title.textContent = structure.name;
        const subtitle = document.createElement("p");
        subtitle.textContent = `${structure.type === "TUNNEL" ? "トンネル" : "橋梁"} · ${directionLabel(direction)}`;
        const list = document.createElement("dl");
        const row = (name, value) => {
            const dt = document.createElement("dt");
            const dd = document.createElement("dd");
            dt.textContent = name;
            dd.textContent = value;
            list.append(dt, dd);
        };
        const kp = value => Number.isFinite(value)
            ? `${Number(value.toFixed(3))} KP`
            : "未登録";
        row("始点", kp(lane.start));
        row("終点", kp(lane.end));
        // OSM線形長・KP差を延長として代用しない。OSM由来と明記されたlength_mも非表示。
        // KPの取得元と延長の取得元は別。公式延長までosm_clickを理由に隠さない。
        const lengthSource = lane.source?.length ?? structure.source?.length;
        const source = JSON.stringify(lengthSource ?? [structure.source, lane.source]).toLowerCase();
        if (Number.isFinite(lane.length_m) && !source.includes("osm")) {
            row("延長", `${Math.round(lane.length_m).toLocaleString("ja-JP")} m`);
        }
        popup.append(title, subtitle, list);
        popup.hidden = false;
        const bounds = label.getBoundingClientRect();
        const rect = popup.getBoundingClientRect();
        popup.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, bounds.left + bounds.width / 2 - rect.width / 2))}px`;
        const below = bounds.bottom + 8;
        popup.style.top = `${Math.max(8, below + rect.height <= window.innerHeight - 8 ? below : bounds.top - rect.height - 8)}px`;
    }

    container.addEventListener("pointerover", event => {
        if (event.pointerType !== "mouse" || pinned) return;
        const label = labelFrom(event.target);
        if (label && !label.contains(event.relatedTarget)) show(label, false);
    });
    container.addEventListener("pointerout", event => {
        if (pinned || event.pointerType !== "mouse") return;
        const label = labelFrom(event.target);
        if (label && !label.contains(event.relatedTarget)) hide();
    });
    // captureでKP選択によるSVG再描画より先に対象の諸元と画面位置を取得する。
    container.addEventListener("click", event => {
        const label = labelFrom(event.target);
        if (label) show(label, true);
    }, true);
    document.addEventListener("click", event => {
        if (!labelFrom(event.target) && !popup.contains(event.target)) hide();
    });
    document.addEventListener("keydown", event => { if (event.key === "Escape") hide(); });
    window.addEventListener("wheel", hide, { passive: true });
    window.addEventListener("touchmove", hide, { passive: true });
    window.addEventListener("resize", hide);
}
