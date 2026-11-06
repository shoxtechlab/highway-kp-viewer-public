import { getSvgPoint, kpToY, mouseYToKp } from "./utils.js";
import { parseAnnotationCsv, exportAnnotationCsv } from "./annotationFiles.js";
import { readLocalAnnotations as readRecords, saveLocalAnnotations, deleteLocalAnnotation as deleteRecord, readAnnotationImage } from "./annotationStore.js";
import { normalizeImageRefs, imageFilename } from "./annotationImageData.js";
import { createAnnotationImageEditor, openAnnotationPhotos, verifyStoredImage } from "./annotationImages.js";
import { createAnnotationZip, readAnnotationZip } from "./annotationZip.js";

const TYPE_OPTIONS = [
    ["incident", "事象・事故", "#d92d20", "#fff1f0"],
    ["construction", "工事・規制", "#d97706", "#fff7e6"],
    ["tc", "TC", "#5b3fa3", "#f1edff"],
    ["its", "ITS", "#007c91", "#e7f8fb"],
    ["cctv", "CCTV", "#c0266d", "#fff0f6"],
    ["electrical", "電気室", "#68756d", "#f1f4f2"],
    ["bus-stop", "バスストップ", "#5967b2", "#eef0ff"],
    ["tunnel", "トンネル", "#3580b8", "#edf7ff"],
    ["bridge", "橋梁", "#d88925", "#fff7eb"],
    ["ic", "IC・SIC", "#00973a", "#ffffff"],
    ["jct", "JCT", "#00973a", "#ffffff"],
    ["sa", "SA", "#087f3e", "#ffffff"],
    ["pa", "PA", "#087f3e", "#ffffff"],
    ["other", "その他", "#59636d", "#f2f4f5"]
];

const escapeHtml = value => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const SVG_NS = "http://www.w3.org/2000/svg";
let sessionAdminKey = "";

export function normalizeLocalJsonImport(payload, routeId, { createId = () => crypto.randomUUID() } = {}) {
    routeId = String(routeId || "").trim().toLowerCase();
    const source = Array.isArray(payload) ? payload : payload?.records;
    if (!Array.isArray(source)) throw new Error("JSONは配列、または records 配列を持つオブジェクトにしてください。");
    if (!source.length) throw new Error("JSONに追加データがありません。");
    if (source.length > 500) throw new Error("一度に読み込める追加データは500件までです。");
    if (payload?.schemaVersion != null && ![1, 2].includes(payload.schemaVersion)) throw new Error("未対応の保存形式です。");

    let skipped = 0;
    const records = source.flatMap((input, index) => {
        if (!input || typeof input !== "object" || Array.isArray(input)) {
            throw new Error(`${index + 1}件目がオブジェクトではありません。`);
        }
        const inputRouteId = String(input.routeId || routeId).trim().toLowerCase();
        if (inputRouteId !== routeId) {
            skipped += 1;
            return [];
        }
        const geometryType = input.geometryType === "section" ? "section" : "point";
        if (input.schemaVersion != null && ![1, 2].includes(input.schemaVersion)) throw new Error("未対応の保存形式です。");
        const imageRefs = Object.hasOwn(input, "images") ? normalizeImageRefs(input.images) : undefined;
        if (imageRefs?.length && geometryType !== "point") throw new Error("写真は地点のみで対応しています。");
        const startKp = Number(input.startKp);
        const endKp = geometryType === "section" ? Number(input.endKp) : null;
        if (!Number.isFinite(startKp) || startKp < 0 || startKp > 2000) {
            throw new Error(`${index + 1}件目の起点KPが不正です。`);
        }
        if (geometryType === "section" && (!Number.isFinite(endKp) || endKp <= startKp || endKp > 2000)) {
            throw new Error(`${index + 1}件目の終点KPが不正です。`);
        }
        const name = String(input.name || "").trim();
        if (!name || name.length > 60) throw new Error(`${index + 1}件目の名称が不正です。`);
        const requestedType = String(input.type || "").toLowerCase();
        const type = TYPE_OPTIONS.some(([value]) => value === requestedType) ? requestedType : "other";
        const palette = TYPE_OPTIONS.find(([value]) => value === type) || TYPE_OPTIONS.at(-1);
        const primary = /^#[0-9a-f]{6}$/i.test(input.colors?.primary || "") ? input.colors.primary : palette[2];
        const secondary = /^#[0-9a-f]{6}$/i.test(input.colors?.secondary || "") ? input.colors.secondary : palette[3];
        const direction = ["up", "down", "both"].includes(input.direction) ? input.direction : "both";
        const createdAt = Number.isFinite(Date.parse(input.createdAt)) ? input.createdAt : new Date().toISOString();
        const expiresAt = Number.isFinite(Date.parse(input.expiresAt)) ? input.expiresAt : null;
        return [{
            id: String(input.id || createId()),
            schemaVersion: imageRefs?.length ? 2 : 1,
            ...(imageRefs !== undefined ? { images: imageRefs } : {}),
            routeId,
            kpSystemId: String(input.kpSystemId || "route"),
            geometryType,
            startKp,
            endKp,
            direction,
            type,
            name,
            description: String(input.description || "").trim().slice(0, 240),
            colors: { primary, secondary },
            visibility: "private",
            author: "",
            createdAt,
            expiresAt
        }];
    });
    if (!records.length) throw new Error(`この路線（${routeId.toUpperCase()}）の追加データがありません。`);
    return { records, skipped };
}

async function requestAdminKey() {
    if (sessionAdminKey) return sessionAdminKey;
    const supplied = window.prompt("共有データを変更するための管理者キーを入力してください。");
    if (supplied === null) throw new Error("管理者キーの入力をキャンセルしました。");
    const normalized = supplied.trim();
    if (!normalized) throw new Error("管理者キーを入力してください。");
    sessionAdminKey = normalized;
    return normalized;
}

async function sharedRequest(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (options.admin) headers.Authorization = `Bearer ${await requestAdminKey()}`;
    let response;
    try {
        response = await fetch(path, { ...options, headers });
    } finally {
        // 管理者キーは一操作だけに使い、画面を開いたままでも次の変更時には再入力させる。
        if (options.admin) sessionAdminKey = "";
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
        if (response.status === 401) sessionAdminKey = "";
        throw new Error(body?.error || `共有データAPIエラー (${response.status})`);
    }
    return body;
}

export function initEditorPreview({ routeId, routeName, kpSystems, directionLabels, getCurrentKp, onRecordsChange }) {
    if (document.getElementById("editor-preview-open")) return;

    document.head.insertAdjacentHTML("beforeend", '<link rel="stylesheet" href="/css/editor-preview.css"><link rel="stylesheet" href="/css/editor-item-actions.css"><link rel="stylesheet" href="/css/editor-json-import.css">');
    const menu = document.getElementById("mobile-overflow-menu");
    if (!menu) return;

    menu.insertAdjacentHTML("beforeend", `
        <button id="editor-preview-open" type="button">
            <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.9-10.9-3.2-3.2L5 15.8 4 20Zm10.7-13.9 3.2 3.2"/></svg>
            <span>編集モード</span><span class="editor-beta">BETA</span>
        </button>`);

    document.body.insertAdjacentHTML("beforeend", `
        <div id="editor-preview-layer" hidden>
            <button class="editor-backdrop" type="button" aria-label="編集モードを閉じる"></button>
            <aside class="editor-sheet" role="dialog" aria-modal="true" aria-labelledby="editor-title">
                <header class="editor-head">
                    <div><p>USER LAYER</p><h2 id="editor-title">施設・区間を追加</h2></div>
                    <button class="editor-close" type="button" aria-label="閉じる">×</button>
                </header>
                <form id="editor-preview-form">
                    <div class="editor-edit-state" hidden><strong></strong><button class="editor-cancel-edit" type="button">編集をやめる</button></div>
                    <label class="editor-field"><span>路線</span><input value="${escapeHtml(routeName)}（${escapeHtml(routeId.toUpperCase())}）" readonly></label>
                    ${kpSystems.length > 1 ? `<label class="editor-field"><span>路線名・KP体系</span><select name="kpSystemId">${kpSystems.map(system => `<option value="${escapeHtml(system.id)}">${escapeHtml(system.name || system.label || system.id)}</option>`).join("")}</select></label>` : `<input type="hidden" name="kpSystemId" value="${escapeHtml(kpSystems[0]?.id || "route")}">`}
                    <fieldset class="editor-field"><legend>形状</legend><div class="editor-segments"><label><input type="radio" name="geometryType" value="point" checked><span>地点</span></label><label><input type="radio" name="geometryType" value="section"><span>区間</span></label></div></fieldset>
                    <div class="editor-kp-row">
                        <label class="editor-field"><span>起点KP</span><div class="editor-kp"><input name="startKp" type="number" min="0" step="any" inputmode="decimal" required><b>KP</b></div></label>
                        <label class="editor-field editor-end-kp" hidden><span>終点KP</span><div class="editor-kp"><input name="endKp" type="number" min="0" step="any" inputmode="decimal"><b>KP</b></div></label>
                    </div>
                    <button class="editor-use-kp" type="button">現在の入力KPを反映</button>
                    <fieldset class="editor-field"><legend>方向</legend><div class="editor-segments editor-directions"><label><input type="radio" name="direction" value="up"><span>${escapeHtml(directionLabels.up)}</span></label><label><input type="radio" name="direction" value="down"><span>${escapeHtml(directionLabels.down)}</span></label><label><input type="radio" name="direction" value="both" checked><span>上下両方</span></label></div></fieldset>
                    <label class="editor-field"><span>タイプ</span><select name="type">${TYPE_OPTIONS.map(([value,label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
                    <label class="editor-field"><span>名称</span><input name="name" maxlength="60" placeholder="例：舗装補修工事" required></label>
                    <label class="editor-field"><span>説明・メモ <small>任意</small></span><textarea name="description" rows="2" maxlength="240"></textarea></label>
                    <details class="editor-colors"><summary>色を調整</summary><div><label>基本色<input name="primary" type="color"></label><label>サブカラー<input name="secondary" type="color"></label></div></details>
                    <div class="editor-two-columns">
                        <label class="editor-field"><span>表示期限</span><select name="expiry"><option value="forever" selected>無期限</option><option value="1">1日</option><option value="3">3日</option><option value="7">7日</option><option value="30">30日</option></select></label>
                        <label class="editor-field"><span>表示範囲</span><select name="visibility"><option value="private" selected>この端末のみ</option><option value="public">共有・全員に表示</option></select></label>
                    </div>
                    <section class="editor-live-preview" aria-live="polite"><p>登録プレビュー</p><div class="editor-preview-chip"><i></i><span>名称を入力してください</span></div><small>この端末だけに保存します</small></section>
                    <button class="editor-submit" type="submit">追加する</button>
                    <p class="editor-save-status" role="status"></p>
                    <section class="editor-saved">
                        <div class="editor-saved-head"><h3>この路線の追加データ</h3></div>
                        <div class="editor-file-actions">
                            <button class="editor-json-import editor-delete-all" type="button">全削除</button>
                            <div class="editor-file-transfer">
                                <button class="editor-json-import" data-file-import type="button">ファイル読込</button>
                                <select class="editor-export-format" aria-label="書き出し形式"><option value="json">JSON</option><option value="csv">CSV</option></select>
                                <button class="editor-json-import editor-export" type="button">書き出し</button>
                            </div>
                        </div>
                        <input class="editor-json-file" type="file" accept=".json,.csv,application/json,text/csv" hidden>
                        <p class="editor-file-hint">読込：CSV・JSON（この端末に保存）／書出：この路線の追加データ</p>
                        <p class="editor-json-status" aria-live="polite"></p>
                        <div class="editor-saved-list"></div>
                    </section>
                </form>
            </aside>
        </div>`);

    const layer = document.getElementById("editor-preview-layer");
    const form = document.getElementById("editor-preview-form");
    const openButton = document.getElementById("editor-preview-open");
    const jsonFile = layer.querySelector(".editor-json-file");
    const jsonStatus = layer.querySelector(".editor-json-status");
    const imageEditor = createAnnotationImageEditor(form);
    if (imageEditor) {
        jsonFile.accept += ",.zip";
        layer.querySelector(".editor-export-format").insertAdjacentHTML("beforeend", '<option value="zip">ZIP（写真込み）</option>');
    }
    let privateRecords = [];
    let sharedRecords = [];
    let records = [];
    let editingRecord = null;
    let preserveEditingExpiry = false;
    let saving = false;
    const saveStatus = layer.querySelector(".editor-save-status");
    const editState = layer.querySelector(".editor-edit-state");
    const resetEntry = () => {
        imageEditor?.reset();
        editingRecord = null;
        preserveEditingExpiry = false;
        editState.hidden = true;
        layer.querySelector(".editor-submit").textContent = "追加する";
        for (const name of ["name", "description", "startKp", "endKp"]) form.elements[name].value = "";
        form.elements.endKp.setCustomValidity("");
        layer.querySelector(".editor-live-preview").classList.remove("is-confirmed");
        updatePreview();
    };
    layer.querySelector(".editor-cancel-edit").addEventListener("click", () => {
        if (saving) return;
        resetEntry();
        saveStatus.textContent = "編集をやめました。新しいデータを追加できます。";
    });
    const hiddenTypes = new Set(JSON.parse(localStorage.getItem(`kp-user-layer-hidden:${routeId}`) || "[]"));
    const close = () => {
        layer.hidden = true;
        sessionAdminKey = "";
        document.body.classList.remove("editor-is-open");
    };
    const open = () => {
        layer.hidden = false;
        document.body.classList.add("editor-is-open");
        document.getElementById("mobile-overflow-menu").hidden = true;
        document.getElementById("mobile-menu-toggle").setAttribute("aria-expanded", "false");
        updatePreview();
        layer.querySelector('input[name="startKp"]').focus();
    };
    const palette = () => TYPE_OPTIONS.find(([value]) => value === form.elements.type.value) || TYPE_OPTIONS.at(-1);
    const applyPalette = () => {
        const [, , primary, secondary] = palette();
        form.elements.primary.value = primary;
        form.elements.secondary.value = secondary;
        updatePreview();
    };
    const updatePreview = () => {
        const chip = layer.querySelector(".editor-preview-chip");
        const name = form.elements.name.value.trim() || "名称を入力してください";
        chip.style.setProperty("--preview-primary", form.elements.primary.value || palette()[2]);
        chip.style.setProperty("--preview-secondary", form.elements.secondary.value || palette()[3]);
        chip.querySelector("span").textContent = name;
    };

    const mergeLayers = () => {
        const merged = new Map(sharedRecords.map(record => [record.id, { ...record, visibility: "public" }]));
        for (const record of privateRecords) merged.set(record.id, { ...record, visibility: "private" });
        records = [...merged.values()].sort((a, b) => Number(a.startKp) - Number(b.startKp));
    };
    const notify = () => {
        mergeLayers();
        onRecordsChange?.([...records], new Set(hiddenTypes));
    };
    const typeLabel = type => TYPE_OPTIONS.find(([value]) => value === type)?.[1] || type;
    const renderSaved = () => {
        const list = layer.querySelector(".editor-saved-list");
        if (!records.length) {
            list.innerHTML = '<p class="editor-empty">まだ追加されていません。</p>';
            return;
        }
        list.innerHTML = records.map(record => `<article data-id="${escapeHtml(record.id)}" data-visibility="${record.visibility}"><i style="--item-color:${escapeHtml(record.colors.primary)}"></i><div><strong>${escapeHtml(record.name)}</strong><small>${record.visibility === "public" ? "共有" : "この端末のみ"} · ${escapeHtml(typeLabel(record.type))} · ${Number(record.startKp)} KP${record.geometryType === "section" ? `〜${Number(record.endKp)} KP` : ""}</small></div><div class="editor-item-actions"><button type="button" data-action="edit" aria-label="${escapeHtml(record.name)}を編集">編集</button><button type="button" data-action="delete" aria-label="${escapeHtml(record.name)}を削除">削除</button></div></article>`).join("");
        if (imageEditor) list.querySelectorAll("article").forEach(article => {
            const record = records.find(item => item.id === article.dataset.id);
            if (!record.images?.length || record.visibility !== "private") return;
            const button = document.createElement("button");
            button.type = "button"; button.dataset.action = "photos"; button.textContent = `写真 ${record.images.length}`;
            article.querySelector(".editor-item-actions").prepend(button);
        });
        list.querySelectorAll("button").forEach(button => button.addEventListener("click", async () => {
            if (saving) return;
            const article = button.closest("article");
            const record = records.find(item => item.id === article.dataset.id);
            if (button.dataset.action === "photos") { await openAnnotationPhotos(record); return; }
            if (button.dataset.action === "edit") {
                if (record.visibility === "public") {
                    try {
                        await requestAdminKey();
                    } catch (error) {
                        layer.querySelector(".editor-live-preview small").textContent = error.message;
                        return;
                    }
                }
                editingRecord = record;
                editState.hidden = false;
                editState.querySelector("strong").textContent = `編集中：${record.name}`;
                saveStatus.textContent = "";
                form.elements.kpSystemId.value = record.kpSystemId;
                form.elements.geometryType.value = record.geometryType;
                form.elements.startKp.value = record.startKp;
                form.elements.endKp.value = record.endKp ?? "";
                form.elements.direction.value = record.direction;
                form.elements.type.value = record.type;
                form.elements.name.value = record.name;
                form.elements.description.value = record.description || "";
                form.elements.primary.value = record.colors.primary;
                form.elements.secondary.value = record.colors.secondary;
                form.elements.visibility.value = record.visibility;
                imageEditor?.load(record);
                // 期限は利用者が選び直した場合だけ更新し、通常の編集では元の期限を維持する。
                preserveEditingExpiry = true;
                form.elements.expiry.value = "forever";
                syncGeometryFields();
                form.elements.visibility.dispatchEvent(new Event("change"));
                updatePreview();
                layer.querySelector(".editor-submit").textContent = "変更を保存";
                form.elements.name.scrollIntoView({ behavior: "smooth", block: "center" });
                return;
            }
            if (article.dataset.visibility === "public") {
                try {
                    await sharedRequest(`/api/annotations/${encodeURIComponent(article.dataset.id)}?route=${encodeURIComponent(routeId)}`, { method: "DELETE", admin: true });
                } catch (error) {
                    layer.querySelector(".editor-live-preview small").textContent = error.message;
                    return;
                }
                sharedRecords = sharedRecords.filter(record => record.id !== article.dataset.id);
            } else {
                try { await deleteRecord(article.dataset.id); }
                catch (error) { saveStatus.textContent = error.message; return; }
                privateRecords = privateRecords.filter(record => record.id !== article.dataset.id);
            }
            if (editingRecord?.id === record.id) resetEntry();
            mergeLayers();
            renderSaved();
            renderTypeFilters();
            notify();
        }));
    };
    const renderTypeFilters = () => {
        let controls = menu.querySelector(".user-layer-visibility-controls");
        const types = [...new Set(records.map(record => record.type))];
        if (!types.length) {
            controls?.remove();
            return;
        }
        if (!controls) {
            controls = document.createElement("div");
            controls.className = "user-layer-visibility-controls";
            menu.insertBefore(controls, openButton);
        }
        controls.innerHTML = `<p>追加データ</p>${types.map(type => `<label><input type="checkbox" value="${escapeHtml(type)}" ${hiddenTypes.has(type) ? "" : "checked"}><span>${escapeHtml(typeLabel(type))}</span></label>`).join("")}`;
        controls.querySelectorAll("input").forEach(input => input.addEventListener("change", () => {
            if (input.checked) hiddenTypes.delete(input.value); else hiddenTypes.add(input.value);
            localStorage.setItem(`kp-user-layer-hidden:${routeId}`, JSON.stringify([...hiddenTypes]));
            notify();
        }));
    };

    layer.querySelector("[data-file-import]").addEventListener("click", () => {
        jsonFile.value = "";
        jsonFile.click();
    });
    jsonFile.addEventListener("change", async () => {
        if (saving) return;
        const file = jsonFile.files?.[0];
        if (!file) return;
        saving = true;
        jsonStatus.classList.remove("is-error");
        jsonStatus.textContent = "ファイルを確認しています…";
        try {
            if (file.size > 100 * 1024 * 1024) throw new Error("ファイルは100MiB以下にしてください。");
            const zip = /\.zip$/i.test(file.name) && imageEditor ? await readAnnotationZip(file) : null;
            const text = zip ? new TextDecoder().decode(zip.get("annotations.json")) : await file.text();
            const payload = /\.csv$/i.test(file.name) ? parseAnnotationCsv(text) : JSON.parse(text.replace(/^\uFEFF/, ""));
            const imported = normalizeLocalJsonImport(payload, routeId);
            const blobs = [];
            if (zip) {
                const expected = new Set(["annotations.json"]);
                for (const record of imported.records) for (const metadata of record.images || []) {
                    const name = imageFilename(metadata), bytes = zip.get(name);
                    if (!bytes) throw new Error("ZIPに必要な写真がありません。");
                    const blob = new Blob([bytes], { type: metadata.mediaType });
                    await verifyStoredImage(blob, metadata);
                    blobs.push({ id: metadata.id, blob }); expected.add(name);
                }
                if ([...zip.keys()].some(name => !expected.has(name))) throw new Error("ZIPに対象外のファイルがあります。");
            }
            imported.records = await saveLocalAnnotations(imported.records, blobs);
            const importedIds = new Set(imported.records.map(record => record.id));
            privateRecords = [
                ...privateRecords.filter(record => !importedIds.has(record.id)),
                ...imported.records
            ];
            mergeLayers();
            renderSaved();
            renderTypeFilters();
            notify();
            jsonStatus.textContent = `${imported.records.length}件をこの端末へ読み込みました${imported.skipped ? `（別路線 ${imported.skipped}件を除外）` : ""}。`;
        } catch (error) {
            jsonStatus.classList.add("is-error");
            jsonStatus.textContent = error instanceof SyntaxError ? "JSONの形式が正しくありません。" : error.message;
        } finally { saving = false; }
    });

    layer.querySelector(".editor-export").addEventListener("click", async () => {
        if (saving) return;
        if (!records.length) { jsonStatus.textContent = "書き出す追加データがありません。"; return; }
        const format = layer.querySelector(".editor-export-format").value;
        const hasImages = records.some(record => record.images?.length);
        if (hasImages && format !== "zip" && !window.confirm("JSON・CSVには写真本体が含まれません。写真込みのバックアップにはZIPを選択してください。続けますか？")) return;
        saving = true;
        try {
        const content = format === "csv" ? exportAnnotationCsv(records)
            : JSON.stringify({ schemaVersion: hasImages ? 2 : 1, records }, null, 2);
        let blob = new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json" });
        if (format === "zip") {
            const entries = [{ name: "annotations.json", blob }];
            for (const record of records) for (const metadata of record.images || []) {
                const stored = await readAnnotationImage(metadata.id);
                if (!stored || stored.recordId !== record.id || stored.routeId !== routeId) throw new Error("写真本体が見つかりません。書き出しを中断しました。");
                entries.push({ name: imageFilename(metadata), blob: stored.blob });
            }
            blob = await createAnnotationZip(entries);
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${routeId}-annotations.${format}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) { jsonStatus.textContent = error.message; }
        finally { saving = false; }
    });
    layer.querySelector(".editor-delete-all").addEventListener("click", async () => {
        if (saving) return;
        const snapshot = [
            ...sharedRecords.map(record => ({ ...record, visibility: "public" })),
            ...privateRecords.map(record => ({ ...record, visibility: "private" }))
        ];
        if (!snapshot.length) return;
        const publicCount = snapshot.filter(record => record.visibility === "public").length;
        if (!window.confirm(`この路線の追加データ${snapshot.length}件をすべて削除しますか？\n共有${publicCount}件・この端末のみ${snapshot.length - publicCount}件。共有データの削除は全員に反映されます。`)) return;
        saving = true;
        try {
            if (publicCount) await requestAdminKey();
            for (const record of snapshot) {
                if (record.visibility === "public") {
                    await sharedRequest(`/api/annotations/${encodeURIComponent(record.id)}?route=${encodeURIComponent(routeId)}`, { method: "DELETE", admin: true });
                    sharedRecords = sharedRecords.filter(item => item.id !== record.id);
                } else {
                    await deleteRecord(record.id);
                    privateRecords = privateRecords.filter(item => item.id !== record.id);
                }
            }
            resetEntry();
            jsonStatus.classList.remove("is-error");
            jsonStatus.textContent = `${snapshot.length}件を削除しました。`;
        } catch (error) {
            jsonStatus.classList.add("is-error");
            jsonStatus.textContent = `削除を中断しました：${error.message}`;
        } finally {
            saving = false;
            mergeLayers(); renderSaved(); renderTypeFilters(); notify();
        }
    });

    openButton.addEventListener("click", open);
    layer.querySelector(".editor-backdrop").addEventListener("click", close);
    layer.querySelector(".editor-close").addEventListener("click", close);
    const syncGeometryFields = () => {
        const section = form.elements.geometryType.value === "section";
        const endField = layer.querySelector(".editor-end-kp");
        endField.hidden = !section;
        endField.style.display = section ? "" : "none";
        form.elements.endKp.required = section;
        form.elements.endKp.disabled = !section;
        if (!section) form.elements.endKp.value = "";
    };
    form.elements.geometryType.forEach(input => input.addEventListener("change", syncGeometryFields));
    form.elements.type.addEventListener("change", applyPalette);
    form.elements.name.addEventListener("input", updatePreview);
    form.elements.primary.addEventListener("input", updatePreview);
    form.elements.secondary.addEventListener("input", updatePreview);
    form.elements.expiry.addEventListener("change", () => { preserveEditingExpiry = false; });
    form.elements.visibility.addEventListener("change", () => {
        const shared = form.elements.visibility.value === "public";
        layer.querySelector(".editor-live-preview small").textContent = shared
            ? "共有データとして保存します（管理者キーが必要）"
            : "この端末だけに保存します";
    });
    layer.querySelector(".editor-use-kp").addEventListener("click", () => {
        const current = getCurrentKp();
        if (Number.isFinite(current.kp)) form.elements.startKp.value = current.kp;
        if (form.elements.kpSystemId && current.kpSystemId) form.elements.kpSystemId.value = current.kpSystemId;
        if (["up", "down", "both"].includes(current.direction)) {
            form.elements.direction.value = current.direction;
        }
    });
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (saving) return;
        saving = true;
        imageEditor?.setSaving(true);
        layer.querySelector(".editor-submit").disabled = true;
        const wasEditing = Boolean(editingRecord);
        saveStatus.textContent = "";
        try {
        updatePreview();
        const data = new FormData(form);
        const geometryType = data.get("geometryType");
        const startKp = Number(data.get("startKp"));
        const endKp = geometryType === "section" ? Number(data.get("endKp")) : null;
        if (!Number.isFinite(startKp) || (geometryType === "section" && (!Number.isFinite(endKp) || endKp <= startKp))) {
            form.elements.endKp.setCustomValidity(geometryType === "section" ? "終点KPは起点KPより大きい値にしてください。" : "");
            form.reportValidity();
            return;
        }
        form.elements.endKp.setCustomValidity("");
        const expiryValue = data.get("expiry");
        const expiryDays = expiryValue === "forever" ? null : Number(expiryValue);
        const visibility = data.get("visibility") === "public" ? "public" : "private";
        const record = {
            id: editingRecord?.id || crypto.randomUUID(), schemaVersion: 1, routeId,
            kpSystemId: data.get("kpSystemId") || kpSystems[0]?.id || "route",
            geometryType, startKp, endKp,
            direction: data.get("direction"), type: data.get("type"),
            name: String(data.get("name") || "").trim(),
            description: String(data.get("description") || "").trim(),
            colors: { primary: data.get("primary"), secondary: data.get("secondary") },
            visibility, author: "管理者",
            createdAt: editingRecord?.createdAt || new Date().toISOString(),
            expiresAt: preserveEditingExpiry && editingRecord
                ? editingRecord.expiresAt || null
                : (expiryDays ? new Date(Date.now() + expiryDays * 86400000).toISOString() : null)
        };
        const photos = await imageEditor?.prepare(record);
        if (photos && (photos.refs.length || editingRecord?.images)) {
            record.images = photos.refs;
            record.schemaVersion = photos.refs.length ? 2 : 1;
        }
        if (visibility === "public") {
            // 共有APIの既存形式は変更しない。画像を外してからの切り替えのみ許可する。
            delete record.images;
            if (editingRecord?.visibility === "public") {
                const updated = await sharedRequest(`/api/annotations/${encodeURIComponent(record.id)}`, {
                    method: "PUT", admin: true,
                    body: JSON.stringify({ routeId, version: editingRecord.version, record })
                });
                sharedRecords = [...sharedRecords.filter(item => item.id !== record.id), updated];
            } else {
                await sharedRequest("/api/annotations", {
                    method: "POST", admin: true,
                    body: JSON.stringify({ routeId, mode: "merge", records: [record] })
                });
                sharedRecords = [...sharedRecords.filter(item => item.id !== record.id), { ...record, version: 1 }];
                if (editingRecord?.visibility === "private") {
                    await deleteRecord(record.id);
                    privateRecords = privateRecords.filter(item => item.id !== record.id);
                }
            }
        } else {
            const [saved] = await saveLocalAnnotations([record], photos?.blobs || []);
            privateRecords = [...privateRecords.filter(item => item.id !== record.id), saved];
            if (editingRecord?.visibility === "public") {
                await sharedRequest(`/api/annotations/${encodeURIComponent(record.id)}?route=${encodeURIComponent(routeId)}`, { method: "DELETE", admin: true });
                sharedRecords = sharedRecords.filter(item => item.id !== record.id);
            }
        }
        resetEntry();
        mergeLayers();
        renderSaved();
        renderTypeFilters();
        notify();
        saveStatus.textContent = `${wasEditing ? "変更を保存しました" : "追加しました"}（${visibility === "public" ? "共有データ" : "この端末のみ"}）。`;
        } catch (error) {
            layer.querySelector(".editor-live-preview").classList.remove("is-confirmed");
            layer.querySelector(".editor-live-preview small").textContent = error.message;
        } finally {
            saving = false;
            imageEditor?.setSaving(false);
            layer.querySelector(".editor-submit").disabled = false;
        }
    });

    document.addEventListener("keydown", event => { if (event.key === "Escape" && !layer.hidden) close(); });
    applyPalette();
    syncGeometryFields();
    Promise.all([
        readRecords(routeId),
        sharedRequest(`/api/annotations?route=${encodeURIComponent(routeId)}`).then(body => body.records || []).catch(error => {
            console.warn(`共有データを読み込めませんでした: ${error.message}`);
            return [];
        })
    ]).then(([localItems, publicItems]) => {
        privateRecords = localItems;
        sharedRecords = publicItems;
        mergeLayers();
        renderSaved();
        renderTypeFilters();
        notify();
    }).catch(error => {
        layer.querySelector(".editor-saved-list").innerHTML = `<p class="editor-empty">保存領域を開けませんでした: ${escapeHtml(error.message)}</p>`;
    });
}

export function renderEditorRecords(svg, records, {
    hiddenTypes = new Set(),
    toRouteKp = value => value,
    viewRange = null,
    onSelect
} = {}) {
    if (!svg || !records?.length) return;
    const root = document.createElementNS(SVG_NS, "g");
    root.setAttribute("class", "user-layer-overlay");
    const v2 = svg.classList.contains("route-diagram-v2");
    const upX = v2 ? 350 : 330;
    const downX = v2 ? 424 : 450;
    const railWidth = v2 ? 26 : 30;
    const svgHeight = svg.viewBox.baseVal.height;
    const occupied = { up: [], down: [] };
    svg.querySelectorAll(".facility[data-direction], .structure-label[data-direction]").forEach(label => {
        const direction = label.dataset.direction;
        if (!occupied[direction]) return;
        const range = readSvgLabelVerticalRange(label);
        if (range) occupied[direction].push(range);
    });
    const labelCandidates = [];
    for (const record of records) {
        if (hiddenTypes.has(record.type)) continue;
        const start = toRouteKp(Number(record.startKp), record.kpSystemId);
        const end = record.geometryType === "section" ? toRouteKp(Number(record.endKp), record.kpSystemId) : start;
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        const rangeStart = Math.min(start, end);
        const rangeEnd = Math.max(start, end);
        const viewStart = Number(viewRange?.start);
        const viewEnd = Number(viewRange?.end);
        const hasViewRange = Number.isFinite(viewStart) && Number.isFinite(viewEnd);
        if (hasViewRange && (rangeEnd < viewStart || rangeStart > viewEnd)) continue;
        const visibleStart = hasViewRange ? Math.max(rangeStart, viewStart) : rangeStart;
        const visibleEnd = hasViewRange ? Math.min(rangeEnd, viewEnd) : rangeEnd;
        const yStart = kpToY(visibleStart);
        const yEnd = kpToY(visibleEnd);
        if (!Number.isFinite(yStart) || !Number.isFinite(yEnd)) continue;
        labelCandidates.push({
            record,
            side: record.direction === "up" ? "up" : "down",
            desiredY: Math.min(yStart, yEnd) - 16
        });
    }
    const labelPositions = new Map();
    for (const side of ["up", "down"]) {
        const candidates = labelCandidates.filter(candidate => candidate.side === side);
        const positions = layoutOrderedUserLabels(candidates, occupied[side], svgHeight);
        positions.forEach(({ candidate, y }) => labelPositions.set(candidate.record, y));
    }
    const add = (parent, tag, attrs, text) => {
        const node = document.createElementNS(SVG_NS, tag);
        Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, value));
        if (text != null) node.textContent = text;
        parent.appendChild(node);
        return node;
    };
    for (const record of records) {
        if (hiddenTypes.has(record.type)) continue;
        const start = toRouteKp(Number(record.startKp), record.kpSystemId);
        const end = record.geometryType === "section" ? toRouteKp(Number(record.endKp), record.kpSystemId) : start;
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        const rangeStart = Math.min(start, end);
        const rangeEnd = Math.max(start, end);
        const viewStart = Number(viewRange?.start);
        const viewEnd = Number(viewRange?.end);
        const hasViewRange = Number.isFinite(viewStart) && Number.isFinite(viewEnd);

        // 路線全体に紐づく追加データでも、事務所などの表示範囲外なら描画しない。
        // 区間が表示範囲と一部だけ重なる場合は、見えている部分だけに切り詰める。
        if (hasViewRange && (rangeEnd < viewStart || rangeStart > viewEnd)) continue;
        const visibleStart = hasViewRange ? Math.max(rangeStart, viewStart) : rangeStart;
        const visibleEnd = hasViewRange ? Math.min(rangeEnd, viewEnd) : rangeEnd;
        const yStart = kpToY(visibleStart);
        const yEnd = kpToY(visibleEnd);
        if (!Number.isFinite(yStart) || !Number.isFinite(yEnd)) continue;
        const item = add(root, "g", {
            class: "user-layer-item",
            role: "button",
            tabindex: "0",
            "aria-label": `${record.name} ${record.startKp}KP`
        });
        const xs = record.direction === "up" ? [upX] : record.direction === "down" ? [downX] : [upX, downX];
        if (record.geometryType === "section") {
            for (const x of xs) add(item, "rect", { x, y: Math.min(yStart,yEnd), width: railWidth, height: Math.max(4,Math.abs(yEnd-yStart)), rx: 5, fill: record.colors.primary, "fill-opacity": .34, stroke: record.colors.primary, "stroke-width": 2, "stroke-dasharray": "6 4" });
        } else {
            for (const x of xs) add(item, "circle", { cx: x + railWidth / 2, cy: yStart, r: 8, fill: record.colors.secondary, stroke: record.colors.primary, "stroke-width": 3, "stroke-dasharray": "3 2" });
        }
        const labelX = record.direction === "up" ? 72 : 478;
        // KP順を保った一括配置により、近接する追加ラベル同士のコネクタ交差を防ぐ。
        const labelY = labelPositions.get(record) ?? Math.min(yStart, yEnd) - 16;
        const labelEdge = record.direction === "up" ? labelX + 250 : labelX;
        for (const x of xs) {
            const roadEdge = record.direction === "up" ? x : x + railWidth;
            add(item, "line", {
                x1: roadEdge,
                y1: yStart,
                x2: labelEdge,
                y2: labelY,
                stroke: record.colors.primary,
                "stroke-width": 1.5,
                "stroke-dasharray": "5 3",
                "vector-effect": "non-scaling-stroke",
                class: "user-layer-connector"
            });
        }
        add(item, "rect", { x: labelX, y: labelY - 14, width: 250, height: 28, rx: 8, fill: record.colors.secondary, stroke: record.colors.primary, "stroke-width": 1.5, "stroke-dasharray": "5 3", class: "user-layer-label-bg" });
        const hasPhotos = record.visibility === "private" && record.images?.length;
        const characters = Array.from(record.name);
        const labelName = hasPhotos && characters.length > 15 ? `${characters.slice(0, 14).join("")}…` : record.name;
        const labelText = add(item, "text", { x: labelX + 10, y: labelY + 5, fill: record.colors.primary, class: "user-layer-label" }, labelName);
        if (labelName !== record.name) add(labelText, "title", {}, record.name);
        if (hasPhotos) {
            // ラベルのKP選択とは独立したボタン。印刷時には除去する。
            const photos = add(item, "g", { class: "annotation-photo-button", role: "button", tabindex: "0", "aria-label": `${record.name}の写真 ${record.images.length}枚`, style: "cursor:pointer" });
            add(photos, "rect", { x: labelX + 214, y: labelY - 13, width: 34, height: 26, rx: 6, fill: record.colors.secondary, stroke: record.colors.primary });
            add(photos, "path", { d: `M${labelX + 220} ${labelY - 6}h4l2 -3h6l2 3h4v14h-18z`, fill: "none", stroke: record.colors.primary, "stroke-width": 1.5 });
            add(photos, "circle", { cx: labelX + 229, cy: labelY + 1, r: 3.5, fill: "none", stroke: record.colors.primary, "stroke-width": 1.5 });
            photos.addEventListener("click", event => { event.stopPropagation(); void openAnnotationPhotos(record); });
            photos.addEventListener("keydown", event => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.stopPropagation(); event.preventDefault(); void openAnnotationPhotos(record);
            });
        }
        const select = routeKp => onSelect?.(record, routeKp);
        item.addEventListener("click", event => {
            event.stopPropagation();
            const clickedKp = mouseYToKp(getSvgPoint(event, svg).y);
            select(record.geometryType === "section" ? Math.max(visibleStart, Math.min(visibleEnd, clickedKp)) : start);
        });
        item.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            select(record.geometryType === "section" ? (visibleStart + visibleEnd) / 2 : start);
        });
    }
    // 選択位置の赤いフォーカスマーカーは、常にユーザー追加レイヤーより上へ描く。
    const focusLayer = svg.querySelector(".v2-focus-layer, #marker-layer");
    svg.insertBefore(root, focusLayer || null);
}

/**
 * 通常表示ではgetBBox()を使い、印刷用の未接続SVGでは子rectの属性へフォールバックする。
 * 未接続SVGのgetBBox()は例外または高さ0になるブラウザがある。
 */
export function readSvgLabelVerticalRange(label) {
    try {
        const box = label.getBBox();
        if (Number.isFinite(box?.y) && Number.isFinite(box?.height) && box.height > 0) {
            return [box.y - 3, box.y + box.height + 3];
        }
    } catch {
        // 下の属性値フォールバックを使う。
    }
    const rect = label.querySelector?.("rect");
    const y = Number(rect?.getAttribute?.("y"));
    const height = Number(rect?.getAttribute?.("height"));
    if (!Number.isFinite(y) || !Number.isFinite(height) || height <= 0) return null;
    return [y - 3, y + height + 3];
}

/**
 * 追加ラベルを接続元の順番どおりに配置する。
 * ラベルを単純に空き位置へ置くと接続元とラベルの上下順が逆転し、
 * コネクタ同士が交差するため、候補全体をKP順で同時に割り当てる。
 */
export function layoutOrderedUserLabels(candidates, occupiedRanges, svgHeight) {
    if (!candidates.length) return [];
    const halfHeight = 14;
    const padding = 3;
    const minGap = (halfHeight + padding) * 2;
    const minY = halfHeight + 2;
    const maxY = Math.max(minY, svgHeight - halfHeight - 2);
    const sorted = [...candidates].sort((a, b) => a.desiredY - b.desiredY);
    const slots = [];
    for (let y = minY; y <= maxY; y += 4) {
        const top = y - halfHeight;
        const bottom = y + halfHeight;
        if (!occupiedRanges.some(([start, end]) => bottom > start && top < end)) slots.push(y);
    }
    if (!slots.length) {
        return sorted.map(candidate => ({ candidate, y: Math.max(minY, Math.min(maxY, candidate.desiredY)) }));
    }

    // 動的計画法で「順序を維持しつつ元位置からの総移動量が最小」の組合せを選ぶ。
    const count = sorted.length;
    const back = Array.from({ length: count }, () => new Int32Array(slots.length).fill(-1));
    let previous = new Float64Array(slots.length);
    for (let j = 0; j < slots.length; j += 1) previous[j] = Math.abs(slots[j] - sorted[0].desiredY);

    for (let i = 1; i < count; i += 1) {
        const current = new Float64Array(slots.length).fill(Infinity);
        let bestCost = Infinity;
        let bestIndex = -1;
        let eligible = 0;
        for (let j = 0; j < slots.length; j += 1) {
            while (eligible < slots.length && slots[eligible] <= slots[j] - minGap) {
                if (previous[eligible] < bestCost) {
                    bestCost = previous[eligible];
                    bestIndex = eligible;
                }
                eligible += 1;
            }
            if (bestIndex < 0) continue;
            current[j] = bestCost + Math.abs(slots[j] - sorted[i].desiredY);
            back[i][j] = bestIndex;
        }
        previous = current;
    }

    let lastIndex = 0;
    for (let j = 1; j < previous.length; j += 1) {
        if (previous[j] < previous[lastIndex]) lastIndex = j;
    }
    if (!Number.isFinite(previous[lastIndex])) {
        // 表示高に収まらないほど件数が多い場合も、順序だけは崩さない。
        let y = minY;
        return sorted.map(candidate => {
            const placed = Math.max(y, Math.min(maxY, candidate.desiredY));
            y = placed + minGap;
            return { candidate, y: Math.min(maxY, placed) };
        });
    }

    const result = new Array(count);
    for (let i = count - 1; i >= 0; i -= 1) {
        result[i] = { candidate: sorted[i], y: slots[lastIndex] };
        lastIndex = back[i][lastIndex];
    }
    return result;
}
