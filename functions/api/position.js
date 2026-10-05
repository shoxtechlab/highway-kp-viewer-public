import { apiHandler } from "../../server/api-response.js";
import { getR2RouteService } from "../../server/r2-route-service.js";

export function onRequestGet(context) {
  const url = new URL(context.request.url);
  return apiHandler(() => getR2RouteService(context.env.ROUTE_DATA).getPosition({
    routeId: url.searchParams.get("route"),
    direction: url.searchParams.get("direction"),
    kp: url.searchParams.get("kp"),
    sectionId: url.searchParams.get("section")
  }));
}
