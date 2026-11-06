import test from "node:test";
import assert from "node:assert/strict";
import { parseAnnotationCsv, exportAnnotationCsv } from "../js/annotationFiles.js";
import { normalizeLocalJsonImport } from "../js/editorPreview.js";

test("CSV round-trip preserves precise KP, multiline text, colors and ids", () => {
    const record = { id: "sample", routeId: "e30", geometryType: "section", startKp: 1.234567, endKp: 2.345678,
        name: '橋,"試験"', description: "一行目\n二行目", colors: { primary: "#123456", secondary: "#abcdef" } };
    const imported = normalizeLocalJsonImport(parseAnnotationCsv(exportAnnotationCsv([record])), "e30").records[0];
    for (const key of ["id", "startKp", "endKp", "name", "description"]) assert.equal(imported[key], record[key]);
    assert.deepEqual(imported.colors, record.colors);
    assert.equal(imported.visibility, "private");
});

test("CSV rejects missing KP, malformed quoting and inconsistent columns", () => {
    assert.throws(() => parseAnnotationCsv('name,startKp\n橋,'));
    assert.throws(() => parseAnnotationCsv('name,startKp\n"橋,1'));
    assert.throws(() => parseAnnotationCsv('name,startKp\n橋,1,2'));
});
