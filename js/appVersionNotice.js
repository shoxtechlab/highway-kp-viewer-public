const VERSION_URL = new URL("../app-version.json", import.meta.url);
const INSTALL_VERSION_KEY = "kp-viewer-home-install-version";
const VERSION_TRACKING_BASELINE = "26.0.0-beta.1";

initializeVersionNotice().catch(error => {
    // バージョン確認に失敗しても本体機能は止めない。
    console.warn("App version check failed.", error);
});

async function initializeVersionNotice() {
    const response = await fetch(VERSION_URL, { cache: "no-store" });
    if (!response.ok) return;

    const config = await response.json();
    const currentVersion = normalizeVersion(config.current_version);
    const reinstallBefore = normalizeVersion(config.reinstall_before_version);
    if (!currentVersion || !reinstallBefore) return;

    // 未記録のホーム画面版も、この仕組みを導入した初期版として扱う。
    // これにより長期間起動していなかった利用者も将来の更新通知対象になる。
    const recordedVersion = readStoredVersion();
    const storedVersion = recordedVersion || VERSION_TRACKING_BASELINE;
    if (!recordedVersion) storeVersion(storedVersion);

    if (!isStandaloneApp() || compareVersions(storedVersion, reinstallBefore) >= 0) return;
    showReinstallNotice(currentVersion, storedVersion);
}

function isStandaloneApp() {
    return window.matchMedia?.("(display-mode: standalone)").matches
        || window.navigator.standalone === true;
}

function normalizeVersion(value) {
    const version = String(value || "").trim();
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ? version : null;
}

function compareVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    for (let index = 0; index < 3; index++) {
        if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
    }
    if (!a.pre.length && !b.pre.length) return 0;
    if (!a.pre.length) return 1;
    if (!b.pre.length) return -1;
    const length = Math.max(a.pre.length, b.pre.length);
    for (let index = 0; index < length; index++) {
        if (a.pre[index] == null) return -1;
        if (b.pre[index] == null) return 1;
        const aNumber = /^\d+$/.test(a.pre[index]) ? Number(a.pre[index]) : null;
        const bNumber = /^\d+$/.test(b.pre[index]) ? Number(b.pre[index]) : null;
        if (aNumber != null && bNumber != null && aNumber !== bNumber) return aNumber - bNumber;
        if (aNumber != null && bNumber == null) return -1;
        if (aNumber == null && bNumber != null) return 1;
        const compared = a.pre[index].localeCompare(b.pre[index]);
        if (compared) return compared;
    }
    return 0;
}

function parseVersion(version) {
    const [core, prerelease = ""] = version.split("-", 2);
    return {
        core: core.split(".").map(Number),
        pre: prerelease ? prerelease.split(".") : []
    };
}

function readStoredVersion() {
    try {
        return normalizeVersion(localStorage.getItem(INSTALL_VERSION_KEY));
    } catch {
        return null;
    }
}

function storeVersion(version) {
    try {
        localStorage.setItem(INSTALL_VERSION_KEY, version);
    } catch {
        // プライベートブラウズ等で保存できない場合は何もしない。
    }
}

function showReinstallNotice(currentVersion, storedVersion) {
    const dialog = document.createElement("dialog");
    dialog.className = "app-version-dialog";
    dialog.setAttribute("aria-labelledby", "app-version-dialog-title");
    dialog.innerHTML = `
        <div class="app-version-dialog-content">
            <h2 id="app-version-dialog-title">ホーム画面版の更新が必要です</h2>
            <p>新しい表示構成を正しく使うため、ホーム画面のKP Viewerを一度削除し、ブラウザからもう一度ホーム画面へ追加してください。</p>
            <p class="app-version-dialog-meta">利用中 ${storedVersion} ／ 最新 ${currentVersion}</p>
            <div class="app-version-dialog-actions">
                <button type="button" data-action="later">あとで</button>
                <button type="button" class="is-primary" data-action="completed">再追加しました</button>
            </div>
        </div>
    `;

    dialog.querySelector('[data-action="later"]').addEventListener("click", () => dialog.close());
    dialog.querySelector('[data-action="completed"]').addEventListener("click", () => {
        storeVersion(currentVersion);
        dialog.close();
    });
    dialog.addEventListener("close", () => dialog.remove());
    document.body.appendChild(dialog);

    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
}
