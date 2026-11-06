// ヘッダー解析時に実行する小さな同期初期化。路線API・地図ライブラリに依存しない。
// hrefが未設定の間はリンクとして動作せず、仮の全国版リンクを表示しない。
(() => {
    const title = document.getElementById("app-title");
    const configNode = document.getElementById("viewer-home-config");
    if (!title || !configNode) return;
    try {
        const config = JSON.parse(configNode.textContent);
        const params = new URLSearchParams(location.search);
        const route = params.get("route") || "e28";
        const scopeId = params.get("scope");
        const portalId = params.get("portal");
        const scope = config.scopes?.[scopeId];
        const home = scope?.routes?.includes(route) && scope.home
            || config.portals?.[portalId];
        if (typeof home !== "string" || !home) return;
        const url = new URL(home, document.baseURI);
        if (url.origin !== location.origin || url.username || url.password) return;
        title.href = url.href;
        title.removeAttribute("aria-disabled");
    } catch {
        // 設定不備でも全国版へ誤遷移させない。路線読込後の既存設定による補完を待つ。
    }
})();
