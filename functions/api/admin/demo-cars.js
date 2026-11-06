import { handleDemoAdminRequest, d1DemoSettingsStore } from "../../../server/live-demo-settings.js";
export function onRequest({ request, env }) {
    return handleDemoAdminRequest(request, {
        store: env.ANNOTATIONS_DB ? d1DemoSettingsStore(env.ANNOTATIONS_DB) : null,
        adminKey: env.ANNOTATIONS_ADMIN_KEY
    });
}
