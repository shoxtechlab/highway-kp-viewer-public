import "./appVersionNotice.js";
import { initTheme } from "./theme.js";

initTheme();

async function fetchJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Failed to load ${path}: HTTP ${response.status}`);
    return response.json();
}

async function main() {

    const routesSrc = document.body.dataset.routesSrc || "./data/routes.json";
    const officesSrc = document.body.dataset.officesSrc;
    const viewerBase = document.body.dataset.viewerBase || "viewer.html";

    const [routes, offices] = await Promise.all([
        fetchJson(routesSrc),
        officesSrc ? fetchJson(officesSrc) : []
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
        link.className = "route-entry";
        const match = String(routeId || "").toUpperCase().match(/^[EC]\d+[A-Z]*/);
        if (match) {
            const badge = document.createElement("span");
            badge.className = "route-code";
            badge.textContent = match[0];
            link.appendChild(badge);
        }
        const label = document.createElement("span");
        label.className = "route-entry-name";
        label.textContent = match
            ? String(item.name).replace(new RegExp(`^${match[0]}\\s*`, "i"), "")
            : item.name;
        link.appendChild(label);
        const arrow = document.createElement("span");
        arrow.className = "route-entry-arrow";
        arrow.setAttribute("aria-hidden", "true");
        arrow.textContent = "›";
        link.appendChild(arrow);

        container.appendChild(link);
    });
}

main().catch(error => {
    console.error(error);
    const container = document.getElementById("route-list");
    if (!container) return;
    const message = document.createElement("p");
    message.className = "route-unavailable";
    message.textContent = "路線一覧を読み込めませんでした。通信状態を確認して再読み込みしてください。";
    container.replaceChildren(message);
});
