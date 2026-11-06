// 戻り先の正データは既存の管理範囲設定。別の手動一覧を作らない。
export function injectViewerHomeConfig(html, runtimeScopes) {
    const marker = /(<script id="viewer-home-config" type="application\/json">)([\s\S]*?)(<\/script>)/;
    const match = html.match(marker);
    if (!match) throw new Error("viewer-home-config is missing from viewer.html");
    const config = JSON.parse(match[2]);
    config.scopes = Object.fromEntries(Object.entries(runtimeScopes).map(([id, scope]) => [id, {
        home: scope.home, routes: Object.keys(scope.routes || {})
    }]));
    const json = JSON.stringify(config).replaceAll("<", "\\u003c");
    return html.replace(marker, () => `${match[1]}${json}${match[3]}`);
}
