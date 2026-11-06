import { normalizeImageRefs } from "./annotationImageData.js";

export const ANNOTATION_DB_NAME = "kp-viewer-user-layer";
export const ANNOTATION_DB_VERSION = 2;

// 全入口で同じDBバージョンを使う。既存itemsを作り直したり削除したりしない。
export function openAnnotationDatabase() {
    return new Promise((resolve, reject) => {
        let cancelled = false;
        const request = indexedDB.open(ANNOTATION_DB_NAME, ANNOTATION_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains("items")) {
                const items = db.createObjectStore("items", { keyPath: "id" });
                items.createIndex("routeId", "routeId", { unique: false });
            }
            if (!db.objectStoreNames.contains("images")) {
                const images = db.createObjectStore("images", { keyPath: "id" });
                images.createIndex("recordId", "recordId", { unique: false });
            }
        };
        request.onblocked = () => {
            cancelled = true;
            reject(new Error("保存領域の更新を待っています。他のKP Viewerタブを閉じてから再試行してください。"));
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => db.close();
            if (cancelled) db.close(); else resolve(db);
        };
    });
}

async function transaction(stores, mode, action) {
    const db = await openAnnotationDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        let result;
        let failure;
        const abort = error => { failure = error; tx.abort(); };
        tx.oncomplete = () => { db.close(); resolve(result); };
        tx.onabort = tx.onerror = () => { db.close(); reject(failure || tx.error || new Error("保存を中断しました。")); };
        try { action(tx, value => { result = value; }, abort); }
        catch (error) { abort(error); }
    });
}

export async function readLocalAnnotations(routeId, { includeExpired = false } = {}) {
    return transaction(["items"], "readonly", (tx, done) => {
        const request = tx.objectStore("items").index("routeId").getAll(routeId);
        request.onsuccess = () => done(request.result.filter(record => includeExpired || !record.expiresAt || Date.parse(record.expiresAt) > Date.now()));
    });
}

export async function readAnnotationImage(id) {
    return transaction(["images"], "readonly", (tx, done) => {
        const request = tx.objectStore("images").get(id);
        request.onsuccess = () => done(request.result || null);
    });
}

// 親とBlobを同時に確定する。CSV等の画像指定のない更新は、既存画像を維持する。
export async function saveLocalAnnotations(records, newImages = []) {
    const recordIds = new Set(), imageIds = new Set();
    for (const record of records) {
        if (recordIds.has(record.id)) throw new Error("データIDが重複しています。");
        recordIds.add(record.id);
        if (!Object.hasOwn(record, "images")) continue;
        record.images = normalizeImageRefs(record.images);
        for (const image of record.images) {
            if (imageIds.has(image.id)) throw new Error("他の地点と写真IDが重複しています。");
            imageIds.add(image.id);
        }
    }
    const additions = new Map(newImages.map(image => [image.id, image]));
    return transaction(["items", "images"], "readwrite", (tx, done, abort) => {
        const items = tx.objectStore("items");
        const images = tx.objectStore("images");
        const saved = [];
        done(saved);
        for (const record of records) {
            const request = items.get(record.id);
            request.onsuccess = () => {
                try {
                    const previous = request.result;
                    const refs = Object.hasOwn(record, "images") ? record.images : (previous?.images || []);
                    if (!Array.isArray(refs) || refs.length > 3) throw new Error("写真は1地点3枚までです。");
                    if (refs.length && (record.geometryType !== "point" || record.visibility !== "private")) {
                        throw new Error("写真は地点・この端末のみで対応しています。先に写真を取り外してください。");
                    }
                    if (previous && previous.routeId !== record.routeId) throw new Error("別路線と同じデータIDは使用できません。");
                    const next = { ...record, schemaVersion: refs.length ? 2 : 1 };
                    if (refs.length || Object.hasOwn(record, "images")) next.images = refs;
                    for (const ref of previous?.images || []) {
                        if (!refs.some(image => image.id === ref.id)) images.delete(ref.id);
                    }
                    for (const ref of refs) {
                        const imageRequest = images.get(ref.id);
                        imageRequest.onsuccess = () => {
                            const stored = imageRequest.result;
                            const added = additions.get(ref.id);
                            if (stored && (stored.recordId !== record.id || stored.routeId !== record.routeId)) {
                                abort(new Error("他の地点の写真IDが指定されています。")); return;
                            }
                            if (added) {
                                if (!(added.blob instanceof Blob) || added.blob.size !== ref.byteLength || added.blob.type !== ref.mediaType) {
                                    abort(new Error("写真データと諸元が一致しません。")); return;
                                }
                                images.put({ id: ref.id, recordId: record.id, routeId: record.routeId, blob: added.blob });
                            } else if (!stored) {
                                abort(new Error("写真本体が見つかりません。画像込みのZIPから読み込んでください。"));
                            } else if (stored.blob.size !== ref.byteLength || stored.blob.type !== ref.mediaType) {
                                abort(new Error("写真データと諸元が一致しません。"));
                            }
                        };
                    }
                    items.put(next);
                    saved.push(next);
                } catch (error) { abort(error); }
            };
        }
    });
}

export async function deleteLocalAnnotation(id) {
    return transaction(["items", "images"], "readwrite", tx => {
        const items = tx.objectStore("items");
        const request = items.get(id);
        request.onsuccess = () => {
            for (const image of request.result?.images || []) tx.objectStore("images").delete(image.id);
            items.delete(id);
        };
    });
}
