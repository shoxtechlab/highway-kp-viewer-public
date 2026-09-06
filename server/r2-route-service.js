import { createRouteService, apiError } from "./route-service.js";

const services = new WeakMap();

export function getR2RouteService(bucket) {
  if (!bucket) throw apiError(503, "Route data storage is not configured.");
  if (!services.has(bucket)) {
    services.set(bucket, createRouteService(async (routeId, fileName) => {
      const object = await bucket.get(`${routeId}/${fileName}`);
      if (!object) throw apiError(404, "Route data not found.");
      return object.text();
    }));
  }
  return services.get(bucket);
}
