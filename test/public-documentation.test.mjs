import test from "node:test";
import assert from "node:assert/strict";
import { publicDocumentation } from "../lib/publicDocumentation.mjs";
test("private operations references are stripped without removing public guides", () => {
    const source = '# Title\n\n[Guide](docs/README.md)\n\n<!-- private-only:start -->\n[Operations](private-notes/operations.md)\n[Control](https://example.test/tools/demo-cars/)\n<!-- private-only:end -->\n## Next\n';
    const clean = publicDocumentation(source);
    assert.ok(clean.includes('[Guide](docs/README.md)'));
    assert.ok(clean.includes('## Next'));
    assert.ok(!clean.includes('private-notes'));
    assert.ok(!clean.includes('tools/demo-cars'));
});
test("unclosed private ranges and unmarked internal links fail closed", () => {
    assert.throws(() => publicDocumentation('<!-- private-only:start -->\nPrivate'), /閉じ/);
    assert.throws(() => publicDocumentation('[private](private-notes/test.md)'), /リンク/);
    assert.throws(() => publicDocumentation('[private](docs-internal/operations.md)'), /リンク/);
    assert.throws(() => publicDocumentation('[control](https://example.test/tools/demo-cars/)'), /リンク/);
});
