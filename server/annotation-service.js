const ROUTE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const TYPES = new Set(["pa", "sa", "ic", "jct", "tunnel", "bridge", "bus-stop", "electrical", "incident", "construction", "other"]);
const DIRECTIONS = new Set(["up", "down", "both"]);
const GEOMETRIES = new Set(["point", "section"]);

function apiError(status, message) {
  return Object.assign(new Error(message), { status });
}

function text(value, max, field, required = false) {
  const result = String(value ?? "").trim();
  if (required && !result) throw apiError(400, `${field} is required.`);
  if (result.length > max) throw apiError(400, `${field} is too long.`);
  return result;
}

function isoDate(value, field, required = false) {
  if (value == null || value === "") {
    if (required) throw apiError(400, `${field} is required.`);
    return null;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw apiError(400, `${field} is invalid.`);
  return date.toISOString();
}

function color(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback;
}

export function normalizeAnnotation(input, { routeId, now = new Date().toISOString() } = {}) {
  const id = text(input?.id, 80, "id", true);
  const resolvedRouteId = text(routeId || input?.routeId, 50, "routeId", true).toLowerCase();
  if (!ROUTE_ID.test(resolvedRouteId)) throw apiError(400, "routeId is invalid.");
  const geometryType = GEOMETRIES.has(input?.geometryType) ? input.geometryType : "point";
  const startKp = Number(input?.startKp);
  const endKp = geometryType === "section" ? Number(input?.endKp) : null;
  if (!Number.isFinite(startKp) || startKp < 0 || startKp > 2000) throw apiError(400, "startKp is invalid.");
  if (geometryType === "section" && (!Number.isFinite(endKp) || endKp <= startKp || endKp > 2000)) {
    throw apiError(400, "endKp is invalid.");
  }
  const type = TYPES.has(input?.type) ? input.type : "other";
  const direction = DIRECTIONS.has(input?.direction) ? input.direction : "both";
  const createdAt = isoDate(input?.createdAt, "createdAt") || now;
  return {
    id,
    schemaVersion: 1,
    routeId: resolvedRouteId,
    kpSystemId: text(input?.kpSystemId || "route", 80, "kpSystemId", true),
    geometryType,
    startKp,
    endKp,
    direction,
    type,
    name: text(input?.name, 60, "name", true),
    description: text(input?.description, 240, "description"),
    colors: {
      primary: color(input?.colors?.primary, "#59636d"),
      secondary: color(input?.colors?.secondary, "#f2f4f5")
    },
    visibility: "public",
    author: text(input?.author, 30, "author", true),
    createdAt,
    updatedAt: now,
    expiresAt: isoDate(input?.expiresAt, "expiresAt")
  };
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function requireAdmin(request, secret) {
  if (!secret) throw apiError(503, "Shared editing is not configured.");
  const authorization = request.headers.get("Authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : request.headers.get("X-Admin-Key") || "";
  const [actual, expected] = await Promise.all([digest(supplied), digest(secret)]);
  let mismatch = actual.length ^ expected.length;
  for (let i = 0; i < Math.max(actual.length, expected.length); i += 1) {
    mismatch |= (actual[i] || 0) ^ (expected[i] || 0);
  }
  if (mismatch !== 0) throw apiError(401, "管理者キーが正しくありません。");
}

export function annotationService(db) {
  if (!db) throw apiError(503, "Shared annotations database is not configured.");
  return {
    async list(routeId) {
      if (!ROUTE_ID.test(routeId || "")) throw apiError(400, "route is invalid.");
      const result = await db.prepare(
        "SELECT payload, version FROM annotations WHERE route_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY updated_at"
      ).bind(routeId, new Date().toISOString()).all();
      return (result.results || []).map(row => ({ ...JSON.parse(row.payload), version: row.version, visibility: "public" }));
    },

    async merge(routeId, inputs, { replace = false } = {}) {
      if (!Array.isArray(inputs) || inputs.length > 500) throw apiError(400, "records must contain at most 500 items.");
      const now = new Date().toISOString();
      if (!ROUTE_ID.test(routeId || "")) throw apiError(400, "routeId is invalid.");
      const records = inputs.map(input => normalizeAnnotation(input, { routeId, now }));
      const statements = [];
      if (replace) statements.push(db.prepare("DELETE FROM annotations WHERE route_id = ?").bind(routeId));
      for (const record of records) {
        statements.push(db.prepare(`
          INSERT INTO annotations (id, route_id, payload, version, created_at, updated_at, expires_at)
          VALUES (?, ?, ?, 1, ?, ?, ?)
          ON CONFLICT(route_id, id) DO UPDATE SET
            payload = excluded.payload,
            version = annotations.version + 1,
            updated_at = excluded.updated_at,
            expires_at = excluded.expires_at
        `).bind(record.id, routeId, JSON.stringify(record), record.createdAt, now, record.expiresAt));
      }
      if (statements.length) await db.batch(statements);
      return { routeId, imported: records.length, mode: replace ? "replace" : "merge" };
    },

    async update(routeId, id, input, expectedVersion) {
      if (!ROUTE_ID.test(routeId || "")) throw apiError(400, "routeId is invalid.");
      const version = Number(expectedVersion);
      if (!Number.isInteger(version) || version < 1) throw apiError(400, "version is required.");
      const now = new Date().toISOString();
      const record = normalizeAnnotation({ ...input, id }, { routeId, now });
      const result = await db.prepare(`
        UPDATE annotations
        SET payload = ?, version = version + 1, updated_at = ?, expires_at = ?
        WHERE route_id = ? AND id = ? AND version = ?
      `).bind(JSON.stringify(record), now, record.expiresAt, routeId, id, version).run();
      if (!result.meta?.changes) throw apiError(409, "別の端末で更新されています。共有データを再読み込みしてください。");
      return { ...record, version: version + 1 };
    },

    async remove(routeId, id) {
      const result = await db.prepare("DELETE FROM annotations WHERE route_id = ? AND id = ?").bind(routeId, id).run();
      if (!result.meta?.changes) throw apiError(404, "Annotation not found.");
      return { deleted: id };
    }
  };
}
