import {
  apiIsEnabled,
  consumeDailyApiRequest,
  dailyApiLimit,
  guardedJson,
  isProtectedBatchApiPath,
  isRouteApiPath,
  withUsageHeaders
} from "../server/api-usage-guard.js";
import { requireAdmin } from "../server/annotation-service.js";

export async function onRequest(context) {
  const pathname = new URL(context.request.url).pathname;
  if (!isRouteApiPath(pathname)) return context.next();

  // Emergency circuit breaker. Set API_ENABLED=false in the Pages environment
  // to stop route APIs before they access D1 or R2.
  if (!apiIsEnabled(context.env.API_ENABLED)) {
    return guardedJson({ error: "Route API is temporarily disabled." }, 503);
  }

  // Authenticate bulk conversion before consuming the shared daily quota.
  if (isProtectedBatchApiPath(pathname)) {
    try {
      await requireAdmin(context.request, context.env.BATCH_API_ADMIN_KEY);
    } catch (error) {
      return guardedJson({ error: error.message || "Unauthorized." }, error.status || 401);
    }
  }

  const limit = dailyApiLimit(context.env.API_DAILY_LIMIT);
  let usage;
  try {
    usage = await consumeDailyApiRequest(context.env.ANNOTATIONS_DB, { limit });
  } catch (error) {
    // Fail closed: if the safety counter is unavailable, do not access R2.
    console.error("API usage guard failed", error);
    return guardedJson({ error: "Route API safety limit is unavailable." }, 503);
  }

  if (!usage.allowed) {
    return guardedJson({
      error: "The daily route API limit has been reached.",
      resetAt: usage.resetAt
    }, 429, usage);
  }

  return withUsageHeaders(await context.next(), usage);
}
