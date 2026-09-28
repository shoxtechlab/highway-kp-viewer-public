import { apiHandler } from "../../../server/api-response.js";
import { annotationService, requireAdmin } from "../../../server/annotation-service.js";

export function onRequestPut(context) {
  return apiHandler(async () => {
    await requireAdmin(context.request, context.env.ANNOTATIONS_ADMIN_KEY);
    const body = await context.request.json();
    return annotationService(context.env.ANNOTATIONS_DB).update(
      String(body.routeId || "").toLowerCase(),
      context.params.id,
      body.record,
      body.version
    );
  });
}

export function onRequestDelete(context) {
  return apiHandler(async () => {
    await requireAdmin(context.request, context.env.ANNOTATIONS_ADMIN_KEY);
    const routeId = new URL(context.request.url).searchParams.get("route") || "";
    return annotationService(context.env.ANNOTATIONS_DB).remove(routeId, context.params.id);
  });
}
