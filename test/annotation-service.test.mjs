import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAnnotation, requireAdmin } from "../server/annotation-service.js";

const base = {
  id: "test-1",
  routeId: "e28",
  kpSystemId: "route",
  geometryType: "point",
  startKp: 12.3,
  direction: "both",
  type: "construction",
  name: "舗装補修工事",
  description: "夜間規制",
  colors: { primary: "#d97706", secondary: "#fff7e6" },
  author: "管理者"
};

test("shared annotation is normalized and bounded", () => {
  const record = normalizeAnnotation(base, { routeId: "e28", now: "2026-09-25T00:00:00.000Z" });
  assert.equal(record.routeId, "e28");
  assert.equal(record.visibility, "public");
  assert.equal(record.endKp, null);
  assert.equal(record.updatedAt, "2026-09-25T00:00:00.000Z");
});
test("section end must follow its start", () => {
  assert.throws(() => normalizeAnnotation({ ...base, geometryType: "section", endKp: 10 }), /endKp/);
});

test("shared annotation requires an author", () => {
  assert.throws(() => normalizeAnnotation({ ...base, author: "" }), /author/);
});

test("admin key accepts only an exact match", async () => {
  await requireAdmin(new Request("https://example.test", {
    headers: { Authorization: "Bearer correct-secret" }
  }), "correct-secret");
  await assert.rejects(
    requireAdmin(new Request("https://example.test", {
      headers: { Authorization: "Bearer wrong-secret" }
    }), "correct-secret"),
    error => error.status === 401
  );
});
