const DEFAULT_DAILY_LIMIT = 50_000;
const GUARDED_PATH = /^\/api\/(?:route(?:\/|$)|position$|nearest$|batch\/(?:position|nearest)$)/;
const PROTECTED_BATCH_PATH = /^\/api\/batch\/(?:position|nearest)$/;

export function isRouteApiPath(pathname) {
  return GUARDED_PATH.test(pathname);
}

export function isProtectedBatchApiPath(pathname) {
  return PROTECTED_BATCH_PATH.test(pathname);
}

export function apiIsEnabled(value) {
  return !["0", "false", "off", "disabled"].includes(String(value ?? "true").trim().toLowerCase());
}

export function dailyApiLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_LIMIT;
}

export function utcUsageWindow(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const reset = new Date(`${day}T00:00:00.000Z`);
  reset.setUTCDate(reset.getUTCDate() + 1);
  return { day, resetAt: reset.toISOString() };
}

export async function consumeDailyApiRequest(db, { limit, now = new Date() }) {
  if (!db) throw new Error("API usage database is not configured.");
  const { day, resetAt } = utcUsageWindow(now);
  const row = await db.prepare(`
    INSERT INTO api_daily_usage (usage_date, request_count, updated_at)
    VALUES (?, 1, ?)
    ON CONFLICT(usage_date) DO UPDATE SET
      request_count = api_daily_usage.request_count + 1,
      updated_at = excluded.updated_at
    WHERE api_daily_usage.request_count < ?
    RETURNING request_count
  `).bind(day, now.toISOString(), limit).first();

  return {
    allowed: Boolean(row),
    count: Number(row?.request_count ?? limit),
    limit,
    remaining: row ? Math.max(0, limit - Number(row.request_count)) : 0,
    resetAt
  };
}

export function guardedJson(body, status, usage = null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  if (usage) {
    headers.set("X-RateLimit-Limit", String(usage.limit));
    headers.set("X-RateLimit-Remaining", String(usage.remaining));
    headers.set("X-RateLimit-Reset", usage.resetAt);
    if (status === 429) {
      headers.set("Retry-After", String(Math.max(1, Math.ceil((Date.parse(usage.resetAt) - Date.now()) / 1000))));
    }
  }
  return Response.json(body, { status, headers });
}

export function withUsageHeaders(response, usage) {
  const headers = new Headers(response.headers);
  headers.set("X-RateLimit-Limit", String(usage.limit));
  headers.set("X-RateLimit-Remaining", String(usage.remaining));
  headers.set("X-RateLimit-Reset", usage.resetAt);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
