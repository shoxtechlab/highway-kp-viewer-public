import { privateApiHandler } from "../../../server/api-response.js";
import { requireAdmin } from "../../../server/annotation-service.js";
import {
  batchSizeLimit,
  executeBatch,
  nearestInput,
  readBatchRequest
} from "../../../server/batch-route-service.js";
import { getR2RouteService } from "../../../server/r2-route-service.js";

export function onRequestPost(context) {
  return privateApiHandler(async () => {
    await requireAdmin(context.request, context.env.BATCH_API_ADMIN_KEY);
    const body = await readBatchRequest(context.request);
    const service = getR2RouteService(context.env.ROUTE_DATA);
    return executeBatch(
      body.records,
      record => service.getNearest(nearestInput(record)),
      { maxRecords: batchSizeLimit(context.env.BATCH_API_MAX_RECORDS), mode: "nearest" }
    );
  });
}
