// 自分で書き出した無圧縮ZIP用。外部ライブラリを本番へ追加せず、全体100MiB以内で扱う。
const MAX_ARCHIVE = 100 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const table = Array.from({ length: 256 }, (_, n) => {
    for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
});
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
function safePath(path) {
    return path === "annotations.json" || /^images\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(path);
}

export async function createAnnotationZip(entries) {
    if (entries.length > 1501) throw new Error("ZIPのファイル数が多すぎます。");
    const locals = [], centrals = [];
    const seen = new Set();
    let offset = 0;
    for (const { name, blob } of entries) {
        if (!safePath(name) || seen.has(name)) throw new Error("ZIP内のファイル名が不正または重複しています。");
        seen.add(name);
        if (offset + blob.size > MAX_ARCHIVE) throw new Error("画像込みZIPは100MiBまでです。");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const filename = encoder.encode(name);
        const crc = crc32(bytes);
        const header = new Uint8Array(30 + filename.length);
        const local = new DataView(header.buffer);
        local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true);
        local.setUint16(6, 0x800, true); local.setUint32(14, crc, true);
        local.setUint32(18, bytes.length, true); local.setUint32(22, bytes.length, true);
        local.setUint16(26, filename.length, true); header.set(filename, 30);
        const center = new Uint8Array(46 + filename.length);
        const central = new DataView(center.buffer);
        central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true);
        central.setUint16(8, 0x800, true); central.setUint32(16, crc, true);
        central.setUint32(20, bytes.length, true); central.setUint32(24, bytes.length, true);
        central.setUint16(28, filename.length, true); central.setUint32(42, offset, true); center.set(filename, 46);
        locals.push(header, bytes); centrals.push(center);
        offset += header.length + bytes.length;
    }
    const centralSize = centrals.reduce((sum, bytes) => sum + bytes.length, 0);
    if (offset + centralSize + 22 > MAX_ARCHIVE) throw new Error("画像込みZIPは100MiBまでです。");
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true); view.setUint16(8, entries.length, true); view.setUint16(10, entries.length, true);
    view.setUint32(12, centralSize, true); view.setUint32(16, offset, true);
    return new Blob([...locals, ...centrals, end], { type: "application/zip" });
}

export async function readAnnotationZip(blob) {
    if (blob.size > MAX_ARCHIVE || blob.size < 22) throw new Error("ZIPのサイズが不正です（上限100MiB）。");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const end = bytes.length - 22;
    if (view.getUint32(end, true) !== 0x06054b50 || view.getUint16(end + 20, true) !== 0) throw new Error("このアプリが書き出したZIPを選択してください。");
    const count = view.getUint16(end + 10, true);
    const centerOffset = view.getUint32(end + 16, true);
    if (count > 1501 || centerOffset + view.getUint32(end + 12, true) !== end
        || view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true)) throw new Error("ZIPの構成が不正です。");
    const files = new Map();
    let offset = 0, center = centerOffset;
    for (let i = 0; i < count; i++) {
        if (offset + 30 > centerOffset || view.getUint32(offset, true) !== 0x04034b50) throw new Error("ZIPのヘッダーが不正です。");
        if (view.getUint16(offset + 6, true) !== 0x800 || view.getUint16(offset + 8, true) !== 0) throw new Error("暗号化・圧縮されたZIPには対応していません。");
        const size = view.getUint32(offset + 18, true);
        const nameLength = view.getUint16(offset + 26, true), extra = view.getUint16(offset + 28, true);
        const start = offset + 30 + nameLength + extra;
        if (size !== view.getUint32(offset + 22, true) || start + size > centerOffset) throw new Error("ZIPのデータ長が不正です。");
        const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
        if (!safePath(name) || files.has(name)) throw new Error("ZIP内のファイル名が不正または重複しています。");
        const data = bytes.subarray(start, start + size);
        if (crc32(data) !== view.getUint32(offset + 14, true)) throw new Error("ZIPの内容が破損しています。");
        if (center + 46 + nameLength > end || view.getUint32(center, true) !== 0x02014b50
            || view.getUint32(center + 42, true) !== offset || view.getUint16(center + 28, true) !== nameLength
            || decoder.decode(bytes.subarray(center + 46, center + 46 + nameLength)) !== name) throw new Error("ZIPの索引が不正です。");
        center += 46 + nameLength + view.getUint16(center + 30, true) + view.getUint16(center + 32, true);
        files.set(name, data);
        offset = start + size;
    }
    if (offset !== centerOffset || center !== end || !files.has("annotations.json")) throw new Error("追加データのJSONが見つかりません。");
    return files;
}
