import { getSvgPoint, kpToY, mouseYToKp } from "./utils.js";

const TYPE_OPTIONS = [
    ["pa", "PA", "#087f3e", "#ffffff"],
    ["sa", "SA", "#087f3e", "#ffffff"],
    ["ic", "IC・SIC", "#00973a", "#ffffff"],
    ["jct", "JCT", "#00973a", "#ffffff"],
    ["tunnel", "トンネル", "#3580b8", "#edf7ff"],
    ["bridge", "橋梁", "#d88925", "#fff7eb"],
    ["bus-stop", "バスストップ", "#5967b2", "#eef0ff"],
    ["electrical", "電気室", "#68756d", "#f1f4f2"],
    ["incident", "事象・事故情報", "#d92d20", "#fff1f0"],
    ["construction", "工事・規制", "#d97706", "#fff7e6"],
    ["other", "その他", "#59636d", "#f2f4f5"]
];

const escapeHtml = value => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const DB_NAME = "kp-viewer-user-layer";
const STORE_NAME = "items";
const SVG_NS = "http://www.w3.org/2000/svg";
let sessionAdminKey = "";

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const store = request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
            store.createIndex("routeId", "routeId", { unique: false });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function readRecords(routeId) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).index("routeId").getAll(routeId);
        request.onsuccess = () => {
            const now = Date.now();
            resolve(request.result.filter(item => !item.expiresAt || Date.parse(item.expiresAt) > now));
        };
        request.onerror = () => reject(request.error);
    });
}

async function writeRecord(record) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function deleteRecord(id) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
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

    document.head.insertAdjacentHTML("beforeend", '<link rel="stylesheet" href="/css/editor-preview.css"><link rel="stylesheet" href="/css/editor-item-actions.css">');
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
                    <label class="editor-field"><span>路線</span><input value="${escapeHtml(routeName)}（${escapeHtml(routeId.toUpperCase())}）" readonly></label>
                    ${kpSystems.length > 1 ? `<label class="editor-field"><span>路線名・KP体系</span><select name="kpSystemId">${kpSystems.map(system => `<option value="${escapeHtml(system.id)}">${escapeHtml(system.name || system.label || system.id)}</option>`).join("")}</select></label>` : `<input type="hidden" name="kpSystemId" value="${escapeHtml(kpSystems[0]?.id || "route")}">`}
                    <fieldset class="editor-field"><legend>形状</legend><div class="editor-segments"><label><input type="radio" name="geometryType" value="point" checked><span>地点</span></label><label><input type="radio" name="geometryType" value="section"><span>区間</span></label></div></fieldset>
                    <div class="editor-kp-row">
                        <label class="editor-field"><span>起点KP</span><div class="editor-kp"><input name="startKp" type="number" min="0" step="0.01" inputmode="decimal" required><b>KP</b></div></label>
                        <label class="editor-field editor-end-kp" hidden><span>終点KP</span><div class="editor-kp"><input name="endKp" type="number" min="0" step="0.01" inputmode="decimal"><b>KP</b></div></label>
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
                    <button class="editor-submit" type="submit">決定</button>
                    <section class="editor-saved"><h3>この路線の追加データ</h3><div class="editor-saved-list"></div></section>
                </form>
            </aside>
        </div>`);

    const layer = document.getElementById("editor-preview-layer");
    const form = document.getElementById("editor-preview-form");
    const openButton = document.getElementById("editor-preview-open");
    let privateRecords = [];
    let sharedRecords = [];
    let records = [];
    let editingRecord = null;
    let preserveEditingExpiry = false;
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
        records = [...merged.values()];
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
        list.innerHTML = records.map(record => `<article data-id="${escapeHtml(record.id)}" data-visibility="${record.visibility}"><i style="--item-color:${escapeHtml(record.colors.primary)}"></i><div><strong>${escapeHtml(record.name)}</strong><small>${record.visibility === "public" ? "共有" : "この端末のみ"} · ${escapeHtml(typeLabel(record.type))} · ${Number(record.startKp).toFixed(2)} KP${record.geometryType === "section" ? `〜${Number(record.endKp).toFixed(2)} KP` : ""}</small></div><div class="editor-item-actions"><button type="button" data-action="edit" aria-label="${escapeHtml(record.name)}を編集">編集</button><button type="button" data-action="delete" aria-label="${escapeHtml(record.name)}を削除">削除</button></div></article>`).join("");
        list.querySelectorAll("button").forEach(button => button.addEventListener("click", async () => {
            const article = button.closest("article");
            const record = records.find(item => item.id === article.dataset.id);
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
                await deleteRecord(article.dataset.id);
                privateRecords = privateRecords.filter(record => record.id !== article.dataset.id);
            }
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
    });
    form.addEventListener("submit", async event => {
        event.preventDefault();
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
        if (visibility === "public") {
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
            await writeRecord(record);
            privateRecords = [...privateRecords.filter(item => item.id !== record.id), record];
            if (editingRecord?.visibility === "public") {
                await sharedRequest(`/api/annotations/${encodeURIComponent(record.id)}?route=${encodeURIComponent(routeId)}`, { method: "DELETE", admin: true });
                sharedRecords = sharedRecords.filter(item => item.id !== record.id);
            }
        }
        editingRecord = null;
        preserveEditingExpiry = false;
        mergeLayers();
        renderSaved();
        renderTypeFilters();
        notify();
        layer.querySelector(".editor-live-preview").classList.add("is-confirmed");
        layer.querySelector(".editor-live-preview small").textContent = visibility === "public" ? "共有データへ保存しました" : "この端末へ保存しました";
        layer.querySelector(".editor-submit").textContent = "もう一件追加";
        } catch (error) {
            layer.querySelector(".editor-live-preview").classList.remove("is-confirmed");
            layer.querySelector(".editor-live-preview small").textContent = error.message;
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

export function renderEditorRecords(svg, records, { hiddenTypes = new Set(), toRouteKp = value => value, onSelect } = {}) {
    if (!svg || !records?.length) return;
    const root = document.createElementNS(SVG_NS, "g");
    root.setAttribute("class", "user-layer-overlay");
    const v2 = svg.classList.contains("route-diagram-v2");
    const upX = v2 ? 350 : 330;
    const downX = v2 ? 424 : 450;
    const railWidth = v2 ? 26 : 30;
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
        const yStart = kpToY(start);
        const yEnd = kpToY(end);
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
        const labelY = Math.min(yStart, yEnd) - 16;
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
        add(item, "text", { x: labelX + 10, y: labelY + 5, fill: record.colors.primary, class: "user-layer-label" }, record.name);
        const select = routeKp => onSelect?.(record, routeKp);
        item.addEventListener("click", event => {
            event.stopPropagation();
            const clickedKp = mouseYToKp(getSvgPoint(event, svg).y);
            select(record.geometryType === "section" ? Math.max(Math.min(start,end), Math.min(Math.max(start,end), clickedKp)) : start);
        });
        item.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            select(record.geometryType === "section" ? (start + end) / 2 : start);
        });
    }
    // 選択位置の赤いフォーカスマーカーは、常にユーザー追加レイヤーより上へ描く。
    const focusLayer = svg.querySelector(".v2-focus-layer, #marker-layer");
    svg.insertBefore(root, focusLayer || null);
}
