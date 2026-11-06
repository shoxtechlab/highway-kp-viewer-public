import test from "node:test";
import assert from "node:assert/strict";
import { parseKpInput } from "../js/kpInput.js";

test("KP input accepts ASCII and full-width decimals", () => {
    assert.equal(parseKpInput("25.500"), 25.5);
    assert.equal(parseKpInput("２５．５００"), 25.5);
    assert.equal(parseKpInput(" ２５。５ "), 25.5);
});

test("KP input rejects mixed or incomplete values", () => {
    assert.equal(Number.isNaN(parseKpInput("25KP")), true);
    assert.equal(Number.isNaN(parseKpInput(".")), true);
    assert.equal(Number.isNaN(parseKpInput("")), true);
});
