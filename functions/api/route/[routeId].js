import { apiHandler } from "../../../server/api-response.js";
import { getR2RouteService } from "../../../server/r2-route-service.js";

export function onRequestGet(context) {
  return apiHandler(() =>
    getR2RouteService(context.env.ROUTE_DATA).getRoute(context.params.routeId)
  );
}
