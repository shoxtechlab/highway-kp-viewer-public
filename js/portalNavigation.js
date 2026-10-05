import { initTheme } from "./theme.js";

initTheme();

const appTitle = document.getElementById("app-title");

if (appTitle) {
    const params = new URLSearchParams(location.search);
    const expectedParent = appTitle.dataset.parentKey;
    const parentHref = appTitle.dataset.parentHref;

    if (expectedParent && parentHref && params.get("from") === expectedParent) {
        appTitle.href = parentHref;
    } else {
        // A directly opened portal is its own entry point. Do not let its title
        // unexpectedly escape to the nationwide or parent hierarchy.
        appTitle.removeAttribute("href");
        appTitle.setAttribute("aria-disabled", "true");
    }
}
