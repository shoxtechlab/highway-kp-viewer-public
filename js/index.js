import "./appVersionNotice.js";
import { initTheme } from "./theme.js";

initTheme();

async function main() {

    const routesSrc = document.body.dataset.routesSrc || "./data/routes.json";
    const officesSrc = document.body.dataset.officesSrc;
    const viewerBase = document.body.dataset.viewerBase || "viewer.html";

    const [routes, offices] = await Promise.all([
        fetch(routesSrc).then(r => r.json()),
        officesSrc ? fetch(officesSrc).then(r => r.json()) : []
    ]);

    const container = document.getElementById("route-list");
    renderLinks(container, sortNationalRoutes(routes), viewerBase);

    const officeContainer = document.getElementById("office-list");
    if (officeContainer) renderLinks(officeContainer, offices, viewerBase);
}

function sortNationalRoutes(routes) {
    return routes
        .map((route, sourceIndex) => ({ route, sourceIndex }))
        .sort((left, right) => {
            const a = parseRouteNumber(left.route.id);
            const b = parseRouteNumber(right.route.id);
            if (a.group !== b.group) return a.group - b.group;
            if (a.number !== b.number) return a.number - b.number;
            if (a.suffix !== b.suffix) return a.suffix.localeCompare(b.suffix);
            return left.sourceIndex - right.sourceIndex;
        })
        .map(entry => entry.route);
}

function parseRouteNumber(routeId = "") {
    const match = String(routeId).toLowerCase().match(/^([ec])(\d+)([a-z]*)/);
    if (!match) return { group: 2, number: Number.MAX_SAFE_INTEGER, suffix: "" };
    return {
        // Expressway E routes come first; circular C routes are grouped at the end.
        group: match[1] === "e" ? 0 : 1,
        number: Number(match[2]),
        suffix: match[3]
    };
}

function renderLinks(container, items, viewerBase) {
    if (!container) return;

    items.forEach(item => {
        if (item.available === false) {
            const unavailable = document.createElement("div");
            unavailable.className = "route-unavailable";
            unavailable.textContent = `${item.name}（${item.status || "準備中"}）`;
            container.appendChild(unavailable);
            return;
        }

        const link = document.createElement("a");

        const scopeParam = item.scope
            ? `&scope=${encodeURIComponent(item.scope)}`
            : "";
        const portalParam = item.portal
            ? `&portal=${encodeURIComponent(item.portal)}`
            : "";
        const routeId = item.route || item.id;
        link.href = item.href || `${viewerBase}?route=${routeId}${scopeParam}${portalParam}`;
        link.textContent = item.name;

        link.style.display = "block";
        link.style.margin = "8px 0";

        container.appendChild(link);
    });
}

main();
