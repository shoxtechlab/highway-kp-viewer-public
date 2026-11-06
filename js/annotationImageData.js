export const MAX_IMAGES = 3;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 1600;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeImageRefs(input) {
    if (!Array.isArray(input) || input.length > MAX_IMAGES) throw new Error("写真は1地点3枚までです。");
    const ids = new Set();
    return input.map(image => {
        if (!image || !UUID.test(image.id || "") || ids.has(image.id)) throw new Error("写真IDが不正または重複しています。");
        ids.add(image.id);
        if (!MIME_TYPES.has(image.mediaType)) throw new Error("写真の保存形式が不正です。");
        if (!Number.isInteger(image.byteLength) || image.byteLength < 1 || image.byteLength > MAX_IMAGE_BYTES) throw new Error("写真サイズが上限を超えています。");
        for (const key of ["width", "height"]) {
            if (!Number.isInteger(image[key]) || image[key] < 1 || image[key] > MAX_IMAGE_DIMENSION) throw new Error("写真の解像度が不正です。");
        }
        if (!Number.isFinite(Date.parse(image.createdAt))) throw new Error("写真の日時が不正です。");
        return { id: image.id, mediaType: image.mediaType, byteLength: image.byteLength,
            width: image.width, height: image.height, caption: String(image.caption || "").slice(0, 120), createdAt: image.createdAt };
    });
}

export function imageFilename(image) {
    const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    return `images/${image.id}.${extensions[image.mediaType]}`;
}

export async function validateImageBlob(blob, image) {
    if (!(blob instanceof Blob) || blob.size !== image.byteLength || blob.type !== image.mediaType) throw new Error("写真本体とメタデータが一致しません。");
    const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = [137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value);
    const webp = String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
    if (!(image.mediaType === "image/jpeg" && jpeg || image.mediaType === "image/png" && png || image.mediaType === "image/webp" && webp)) throw new Error("写真本体の形式が不正です。");
}
