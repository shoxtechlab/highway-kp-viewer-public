import { createSVG } from "./utils.js";

const BETA_PREVIEWS = [
    { facilityName: "津名一宮IC", id: "tsuna-ichinomiya" }
];

// 試作の入口だけを opt-in で追加する。施設本体のクリックは従来のKP選択を維持する。
export async function addRampPreviewLinks(svg, routeId) {
    if (routeId !== "e28") return;

    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    if (!(scale > 0)) return;
    const gap = 4 / scale;
    const isV2 = svg.classList.contains("route-diagram-v2");
    const dark = document.body.classList.contains("dark-theme");

    for (const preview of BETA_PREVIEWS) {
        const href = new URL("/prototypes/ic-ramps/", location.origin);
        href.searchParams.set("ic", preview.id);
        href.searchParams.set("returnTo", location.pathname + location.search);

        for (const facility of [...svg.querySelectorAll(".facility")].filter(node => node.dataset.name === preview.facilityName)) {
            const rect = facility.querySelector(":scope > rect");
            const name = facility.querySelector(".facility-label-text");
            if (!rect || !name) continue;
            // スマホでは固定CSSピクセルのボタンが施設カードより大きくなる。
            // SVG上のカード実高を上限にして、PCの見た目は従来サイズを維持する。
            const size = Math.min(32 / scale, Number(rect.getAttribute("height")));
            const direction = facility.dataset.direction;
            const originalX = Number(rect.getAttribute("x"));
            const originalWidth = Number(rect.getAttribute("width"));
            const y = Number(rect.getAttribute("y")) + Number(rect.getAttribute("height")) / 2;
            let x;

            if (isV2) {
                const rail = svg.querySelector(`.v2-rail.${direction}`);
                if (!rail) continue;
                const railX = Number(rail.getAttribute("x"));
                const railWidth = Number(rail.getAttribute("width"));
                x = direction === "up" ? railX - gap - size : railX + railWidth + gap;
                const cardX = direction === "up" ? originalX : Math.max(originalX, x + size + gap);
                const cardEnd = direction === "up" ? Math.min(originalX + originalWidth, x - gap) : originalX + originalWidth;
                rect.setAttribute("x", cardX);
                rect.setAttribute("width", cardEnd - cardX);
                name.setAttribute("x", (cardX + cardEnd) / 2);
            } else {
                x = direction === "up" ? originalX - size - gap : originalX + originalWidth + gap;
            }

            const link = createSVG("a", {
                class: "ramp-preview-link",
                href: href.pathname + href.search,
                "aria-label": `${preview.facilityName}のランプ図を開く`,
                tabindex: 0,
                style: "cursor: pointer; touch-action: manipulation; outline-offset: 3px;"
            });
            const title = createSVG("title");
            title.textContent = `${preview.facilityName}のランプ図（試作）`;
            link.appendChild(title);
            link.appendChild(createSVG("rect", {
                x, y: y - size / 2, width: size, height: size, rx: 8 / scale,
                fill: dark ? "#213b32" : "#eaf5ef",
                stroke: dark ? "#8cd6aa" : "#6eab87",
                "stroke-width": 1,
                "vector-effect": "non-scaling-stroke"
            }));
            const text = createSVG("text", {
                x: x + size / 2, y,
                "text-anchor": "middle", "dominant-baseline": "middle",
                "font-family": "system-ui, sans-serif", "font-size": size * 0.48,
                "font-weight": 750, fill: dark ? "#d5f8e2" : "#145d37",
                "pointer-events": "none"
            });
            text.textContent = "↗";
            link.appendChild(text);
            link.addEventListener("click", event => event.stopPropagation());
            svg.appendChild(link);
        }
    }
}
