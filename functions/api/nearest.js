import { apiHandler } from "../../server/api-response.js";
import { getR2RouteService } from "../../server/r2-route-service.js";

export function onRequestGet(context) {
  const url = new URL(context.request.url);
  return apiHandler(() => getR2RouteService(context.env.ROUTE_DATA).getNearest({
    routeId: url.searchParams.get("route"),
    lat: url.searchParams.get("lat"),
    lon: url.searchParams.get("lon"),
    preferredDirection: url.searchParams.get("preferredDirection"),
    sectionIds: url.searchParams.get("sections")?.split(",").filter(Boolean)
  }));
}
