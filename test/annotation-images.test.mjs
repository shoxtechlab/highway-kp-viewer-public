import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { ANNOTATION_DB_NAME, openAnnotationDatabase, readLocalAnnotations, saveLocalAnnotations, readAnnotationImage, deleteLocalAnnotation } from "../js/annotationStore.js";
import { normalizeImageRefs, validateImageBlob } from "../js/annotationImageData.js";
import { createAnnotationZip, readAnnotationZip } from "../js/annotationZip.js";
import { normalizeLocalJsonImport } from "../js/editorPreview.js";

const imageId = "b7c43d21-0f24-47c5-901e-20591d2f0158";
const blob = new Blob([new Uint8Array([255, 216, 255, 0])], { type: "image/jpeg" });
const metadata = { id: imageId, mediaType: blob.type, byteLength: blob.size, width: 1, height: 1, caption: "現地", createdAt: "2026-11-06T00:00:00Z" };
const record = (id = "point") => ({ id, routeId: "e28", geometryType: "point", visibility: "private", name: "試験", startKp: 10, images: [metadata] });
const reset = () => { globalThis.indexedDB = new IDBFactory(); };

test("v1 database upgrades without replacing existing items", async () => {
    reset();
    await new Promise((resolve, reject) => {
        const request = indexedDB.open(ANNOTATION_DB_NAME, 1);
        request.onupgradeneeded = () => {
            const store = request.result.createObjectStore("items", { keyPath: "id" });
            store.createIndex("routeId", "routeId");
            store.put({ id: "old", routeId: "e18", name: "保存済み", startKp: 2 });
        };
        request.onsuccess = () => { request.result.close(); resolve(); };
        request.onerror = () => reject(request.error);
    });
    assert.equal((await readLocalAnnotations("e18"))[0].name, "保存済み");
    const db = await openAnnotationDatabase();
    assert.equal(db.version, 2);
    assert.ok(db.objectStoreNames.contains("images")); db.close();
});

test("image and parent save atomically; metadata-free CSV update retains image; deleting parent removes blob", async () => {
    reset();
    await saveLocalAnnotations([record()], [{ id: imageId, blob }]);
    assert.equal((await readLocalAnnotations("e28"))[0].schemaVersion, 2);
    assert.equal((await readAnnotationImage(imageId)).blob.size, blob.size);
    const { images, ...withoutImages } = record();
    const [updated] = await saveLocalAnnotations([{ ...withoutImages, name: "名称変更" }]);
    assert.deepEqual(updated.images, images);
    await deleteLocalAnnotation("point");
    assert.equal(await readAnnotationImage(imageId), null);
    assert.deepEqual(await readLocalAnnotations("e28"), []);
});

test("missing image aborts whole import and cross-record image reuse is rejected", async () => {
    reset();
    await assert.rejects(saveLocalAnnotations([record(), record("other")], [{ id: imageId, blob }]), /重複/);
    await assert.rejects(saveLocalAnnotations([{ ...record("plain"), images: [] }, record()]), /写真本体/);
    assert.deepEqual(await readLocalAnnotations("e28"), []);
    await saveLocalAnnotations([record()], [{ id: imageId, blob }]);
    await assert.rejects(saveLocalAnnotations([record("other")]), /他の地点/);
    assert.equal((await readLocalAnnotations("e28")).length, 1);
    await assert.rejects(saveLocalAnnotations([{ ...record(), geometryType: "section" }]), /地点/);
    await assert.rejects(saveLocalAnnotations([{ ...record(), images: [{ ...metadata, byteLength: 8 }] }]), /諸元/);
    await saveLocalAnnotations([{ ...record(), images: [] }]);
    assert.equal(await readAnnotationImage(imageId), null);
});

test("non-trial routes still save and read ordinary records and expire as before", async () => {
    reset();
    for (const routeId of ["e30", "e76", "e18", "e19"]) {
        const { images, ...plain } = record(routeId);
        await saveLocalAnnotations([{ ...plain, routeId, geometryType: "section", endKp: 11 }]);
        assert.equal((await readLocalAnnotations(routeId))[0].endKp, 11);
    }
    const { images, ...expired } = record("expired");
    await saveLocalAnnotations([{ ...expired, expiresAt: "2000-01-01T00:00:00Z" }]);
    assert.deepEqual(await readLocalAnnotations("e28"), []);
    assert.equal((await readLocalAnnotations("e28", { includeExpired: true })).length, 1);
});

test("v2 import preserves image metadata on every route, rejects sections and unknown versions", () => {
    assert.deepEqual(normalizeLocalJsonImport({ schemaVersion: 2, records: [record()] }, "e28").records[0].images, [metadata]);
    assert.deepEqual(normalizeLocalJsonImport([{ ...record(), routeId: "e30" }], "e30").records[0].images, [metadata]);
    assert.throws(() => normalizeLocalJsonImport([{ ...record(), geometryType: "section" }], "e28"), /地点/);
    assert.throws(() => normalizeLocalJsonImport({ schemaVersion: 3, records: [record()] }, "e28"), /未対応/);
    assert.throws(() => normalizeImageRefs([metadata, metadata]), /重複/);
});

test("photo ownership and route separation hold for E28/E30/E76/E18/E19 and composite or C routes", async () => {
    reset();
    for (const [index, routeId] of ["e28", "e30", "e76", "e18", "e19", "e6", "c3", "e1a-shin-meishin"].entries()) {
        const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
        const saved = { ...record(routeId), routeId, images: [{ ...metadata, id }] };
        await saveLocalAnnotations([saved], [{ id, blob }]);
        const [loaded] = await readLocalAnnotations(routeId);
        assert.equal(loaded.routeId, routeId);
        assert.equal(loaded.images[0].id, id);
        assert.equal((await readAnnotationImage(id)).recordId, routeId);
    }
    await deleteLocalAnnotation("e30");
    assert.deepEqual(await readLocalAnnotations("e30"), []);
    assert.equal((await readLocalAnnotations("e28")).length, 1);
});

test("ZIP round-trip, corruption, unsafe filenames and invalid image signatures", async () => {
    const zip = await createAnnotationZip([{ name: "annotations.json", blob: new Blob(["{}"] ) }, { name: `images/${imageId}.jpg`, blob }]);
    const files = await readAnnotationZip(zip);
    assert.equal(new TextDecoder().decode(files.get("annotations.json")), "{}");
    assert.deepEqual(files.get(`images/${imageId}.jpg`), new Uint8Array(await blob.arrayBuffer()));
    const broken = new Uint8Array(await zip.arrayBuffer()); broken[46] ^= 1;
    await assert.rejects(readAnnotationZip(new Blob([broken])), /破損/);
    await assert.rejects(createAnnotationZip([{ name: "../evil", blob }]), /ファイル名/);
    await validateImageBlob(blob, metadata);
    await assert.rejects(validateImageBlob(new Blob(["abcd"], { type: blob.type }), metadata), /形式/);
});
