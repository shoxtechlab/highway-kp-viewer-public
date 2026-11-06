import { readAnnotationImage } from "./annotationStore.js";
import { MAX_IMAGES, MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION, normalizeImageRefs, validateImageBlob } from "./annotationImageData.js";

function ensureStyles() {
    if (document.querySelector('link[data-annotation-images]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = "/css/annotation-images.css"; link.dataset.annotationImages = "1";
    document.head.appendChild(link);
}

async function decodeImage(blob) {
    const url = URL.createObjectURL(blob);
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image;
    } catch { throw new Error("写真を読み取れません。HEIC等の場合はJPEG・PNGへ変換してください。"); }
    finally { URL.revokeObjectURL(url); }
}

export async function verifyStoredImage(blob, metadata) {
    await validateImageBlob(blob, metadata);
    const image = await decodeImage(blob);
    if (image.naturalWidth !== metadata.width || image.naturalHeight !== metadata.height) throw new Error("写真の解像度がメタデータと一致しません。");
}

async function prepareImage(file) {
    if (file.size > 20 * 1024 * 1024) throw new Error("選択する写真は1枚20MiB以下にしてください。");
    if (!/^(image\/(jpeg|png|webp|heic|heif))$/i.test(file.type)) throw new Error("JPEG・PNG・WebP、または端末で読み取れるHEICを選択してください。");
    const image = await decodeImage(file);
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width * height > 80_000_000) throw new Error("写真の解像度が大きすぎます。");
    const ratio = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    // Canvasへの再描画で向きを反映し、EXIF（GPS等）や元ファイル名を保存しない。
    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, .85));
    if (!blob || blob.size > MAX_IMAGE_BYTES) throw new Error("縮小後の写真が5MiBを超えました。小さい写真を選択してください。");
    return { blob, metadata: { id: crypto.randomUUID(), mediaType: blob.type, byteLength: blob.size,
        width: canvas.width, height: canvas.height, caption: "", createdAt: new Date().toISOString() } };
}

export function createAnnotationImageEditor(form) {
    ensureStyles();
    const panel = document.createElement("section");
    panel.className = "annotation-photo-editor";
    panel.innerHTML = '<strong>写真 <small>任意</small></strong><p>地点・この端末のみ／3枚まで。共有アップロードは行いません。</p><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple aria-label="写真を選択"><div class="annotation-photo-thumbs"></div><p class="annotation-photo-status" role="status"></p>';
    form.querySelector(".editor-colors").before(panel);
    const input = panel.querySelector("input");
    const thumbnails = panel.querySelector(".annotation-photo-thumbs");
    const status = panel.querySelector(".annotation-photo-status");
    let images = [], urls = [], revision = 0, busy = false, saving = false, pending = Promise.resolve();
    const eligible = () => form.elements.geometryType.value === "point" && form.elements.visibility.value === "private";
    const clearUrls = () => { urls.forEach(url => URL.revokeObjectURL(url)); urls = []; };
    const sync = () => {
        input.disabled = busy || saving || !eligible() || images.length >= MAX_IMAGES;
        panel.querySelectorAll("button,textarea").forEach(element => { element.disabled = busy || saving; });
        if (!eligible()) status.textContent = images.length ? "区間・共有に変更する場合は、先に写真を取り外してください。" : "写真は地点・この端末のみで利用できます。";
    };
    async function render() {
        const token = ++revision;
        try {
        clearUrls(); thumbnails.replaceChildren();
        for (const image of images) {
            const entry = image.blob ? image : await readAnnotationImage(image.metadata.id);
            if (token !== revision) return;
            const card = document.createElement("div"); card.className = "annotation-photo-card";
            if (entry?.blob) {
                const url = URL.createObjectURL(entry.blob); urls.push(url);
                const thumbnail = document.createElement("img"); thumbnail.src = url; thumbnail.alt = image.metadata.caption || "添付写真";
                card.appendChild(thumbnail);
            } else { const message = document.createElement("p"); message.textContent = "写真本体が見つかりません"; card.appendChild(message); }
            const caption = document.createElement("textarea"); caption.maxLength = 120; caption.rows = 2;
            caption.placeholder = "写真の説明（任意）"; caption.setAttribute("aria-label", "写真の説明"); caption.value = image.metadata.caption;
            caption.addEventListener("input", () => { image.metadata.caption = caption.value; });
            const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "取り外す";
            remove.addEventListener("click", () => { images = images.filter(candidate => candidate !== image); status.textContent = "保存時に取り外しを反映します。"; void render(); });
            card.append(caption, remove); thumbnails.appendChild(card);
        }
        } catch (error) { if (token === revision) status.textContent = error.message; }
        sync();
    }
    input.addEventListener("change", () => {
        const files = [...input.files]; input.value = "";
        if (!files.length) return;
        const token = revision;
        busy = true; sync(); status.textContent = "写真を縮小しています…";
        pending = (async () => {
            if (images.length + files.length > MAX_IMAGES) throw new Error("写真は3枚まで選択してください。");
            const prepared = [];
            for (const file of files) prepared.push(await prepareImage(file));
            if (token !== revision) return;
            images.push(...prepared);
            status.textContent = "写真を選択しました。追加・変更の保存で確定します。";
        })().catch(error => { status.textContent = error.message; }).finally(async () => { busy = false; await render(); });
    });
    form.elements.geometryType.forEach(element => element.addEventListener("change", sync));
    form.elements.visibility.addEventListener("change", sync);
    return {
        load(record) { images = (record?.images || []).map(metadata => ({ metadata: { ...metadata } })); status.textContent = ""; void render(); },
        reset() { revision++; images = []; clearUrls(); thumbnails.replaceChildren(); status.textContent = ""; sync(); },
        async prepare(record) {
            await pending;
            if (images.length && (record.geometryType !== "point" || record.visibility !== "private")) throw new Error("写真付き項目は地点・この端末のみにしてください。変更する場合は写真を取り外してください。");
            return { refs: normalizeImageRefs(images.map(image => image.metadata)), blobs: images.filter(image => image.blob).map(image => ({ id: image.metadata.id, blob: image.blob })) };
        },
        setSaving(value) { saving = value; sync(); }
    };
}

export async function openAnnotationPhotos(record) {
    if (record.visibility !== "private" || !record.images?.length) return;
    ensureStyles();
    const dialog = document.createElement("dialog"); dialog.className = "annotation-photo-dialog";
    const heading = document.createElement("h2"); heading.textContent = record.name;
    const close = document.createElement("button"); close.type = "button"; close.textContent = "閉じる"; close.className = "annotation-photo-close";
    const status = document.createElement("p"); status.textContent = "写真を読み込んでいます…";
    const image = document.createElement("img"); image.alt = "添付写真"; image.hidden = true;
    const nav = document.createElement("div"); nav.className = "annotation-photo-nav";
    let index = 0, url = null, token = 0;
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener("close", () => { token++; if (url) URL.revokeObjectURL(url); dialog.remove(); });
    async function show(nextIndex) {
        index = nextIndex; const request = ++token;
        image.hidden = true; status.textContent = "写真を読み込んでいます…";
        try {
            const metadata = record.images[index];
            const stored = await readAnnotationImage(metadata.id);
            if (request !== token) return;
            if (!stored || stored.recordId !== record.id || stored.routeId !== record.routeId) throw new Error("写真本体が見つかりません。");
            if (url) URL.revokeObjectURL(url);
            url = URL.createObjectURL(stored.blob); image.src = url; image.alt = metadata.caption || record.name; image.hidden = false;
            status.textContent = `${index + 1} / ${record.images.length}${metadata.caption ? ` · ${metadata.caption}` : ""}`;
        } catch (error) { if (request === token) status.textContent = error.message; }
    }
    for (const [label, delta] of [["前へ", -1], ["次へ", 1]]) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.disabled = record.images.length < 2;
        button.addEventListener("click", () => { void show((index + delta + record.images.length) % record.images.length); }); nav.appendChild(button);
    }
    dialog.append(heading, close, image, status, nav); document.body.appendChild(dialog); dialog.showModal(); void show(0);
}
