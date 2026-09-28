import { apiHandler } from "../../server/api-response.js";
import { annotationService, requireAdmin } from "../../server/annotation-service.js";

export function onRequestGet(context) {
  const routeId = new URL(context.request.url).searchParams.get("route") || "";
  return apiHandler(async () => ({ routeId, records: await annotationService(context.env.ANNOTATIONS_DB).list(routeId) }));
}
export function onRequestPost(context) {
  return apiHandler(async () => {
    await requireAdmin(context.request, context.env.ANNOTATIONS_ADMIN_KEY);
    const body = await context.request.json();
    return annotationService(context.env.ANNOTATIONS_DB).merge(
      String(body.routeId || "").toLowerCase(),
      body.records,
      { replace: body.mode === "replace" }
    );
  });
}
