import { cloudLiveLocationService, handleLiveLocationRequest } from "../../server/live-location-handler.js";

export function onRequest(context) {
    return handleLiveLocationRequest(context.request, cloudLiveLocationService(context.env));
}
