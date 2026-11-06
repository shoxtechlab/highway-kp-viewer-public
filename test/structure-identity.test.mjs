import test from "node:test";
import assert from "node:assert/strict";
import { withStructureKeys, findStructureForElement } from "../js/structureIdentity.js";

test("same-name structures retain separate identities and original specifications", () => {
    const original = { structures: [
        { type: "BRIDGE", name: "同名橋", section: "west", down: { start: 1, end: 2, length_m: 1000 } },
        { type: "BRIDGE", name: "同名橋", section: "east", down: { start: 1, end: 2, length_m: 950 } },
        { type: "BRIDGE", name: "同名橋", section: "east", down: { start: 1, end: 2, length_m: 951 } }
    ] };
    const road = withStructureKeys(original);
    assert.equal(new Set(road.structures.map(item => item.structureKey)).size, 3);
    const clipped = { ...road.structures[1], down: { start: 100, end: 101 } };
    const result = findStructureForElement(road, { dataset: { structureKey: clipped.structureKey } });
    assert.equal(result.down.length_m, 950);
    assert.equal(result.down.start, 1);
    assert.equal(original.structures[0].structureKey, undefined);
    assert.equal(findStructureForElement(road, { dataset: { name: "同名橋" } }), null);
});

test("persistent IDs remain stable when structures are reordered", () => {
    const a = { id: "bridge-a", type: "BRIDGE", name: "橋A" };
    const b = { id: "bridge-b", type: "BRIDGE", name: "橋B" };
    const before = withStructureKeys({ structures: [a, b] });
    const after = withStructureKeys({ structures: [b, a] });
    assert.equal(before.structures[0].structureKey, after.structures[1].structureKey);
});
