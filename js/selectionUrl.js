import { parseKpInput } from "./kpInput.js";

export function readSelectionFromSearch(search) {
    const params = new URLSearchParams(search);
    const kp = parseKpInput(params.get("kp"));
    const direction = params.get("direction");
    if (!Number.isFinite(kp) || !["up", "down"].includes(direction)) return null;
    return {
        kp,
        direction,
        kpSystemId: params.get("kpSystem") || null
    };
}

export function createSelectionUrl(currentHref, selection) {
    const url = new URL(currentHref);
    url.searchParams.set("direction", selection.direction);
    url.searchParams.set("kp", selection.kp);
    if (selection.kpSystemId) url.searchParams.set("kpSystem", selection.kpSystemId);
    else url.searchParams.delete("kpSystem");
    return url;
}
