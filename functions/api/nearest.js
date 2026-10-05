import { apiHandler } from "../../server/api-response.js";
import { getR2RouteService } from "../../server/r2-route-service.js";

export function onRequestGet(context) {
  const url = new URL(context.request.url);
  return apiHandler(() => getR2RouteService(context.env.ROUTE_DATA).getNearest({
    routeId: url.searchParams.get("route"),
    lat: url.searchParams.get("lat"),
    lon: url.searchParams.get("lon"),
    preferredRoute: url.searchParams.get("preferredRoute"),
    preferredDirection: url.searchParams.get("preferredDirection"),
    heading: url.searchParams.get("heading"),
    speed: url.searchParams.get("speed"),
    accuracy: url.searchParams.get("accuracy"),
    sectionIds: url.searchParams.get("sections")?.split(",").filter(Boolean)
  }));
}
