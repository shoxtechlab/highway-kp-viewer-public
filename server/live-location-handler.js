import { privateApiHandler } from "./api-response.js";
import { createLiveLocationService, d1LiveLocationStore } from "./live-location-service.js";
import { liveDemoPosition } from "./live-location-demo.js";
import { d1DemoSettingsStore, readDemoSettings } from "./live-demo-settings.js";

export async function handleLiveLocationRequest(request, service) {
    return privateApiHandler(async () => {
        const url = new URL(request.url);
        if (request.method === "GET") {
            if (url.searchParams.get("status") === "1") return { enabled: !!service };
            return service ? service.list(url.searchParams.get("route")) : { enabled: false, positions: [], serverNow: Date.now() };
        }
        if (!service) throw Object.assign(new Error("位置公開は現在設定されていません。"), { status: 503 });
        const origin = request.headers.get("Origin");
        if (origin && origin !== url.origin) throw Object.assign(new Error("別サイトからの書込はできません。"), { status: 403 });
        const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
        if (request.method === "DELETE") return service.remove(token);
        if (!["POST", "PUT"].includes(request.method)) throw Object.assign(new Error("Method not allowed."), { status: 405 });
        if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw Object.assign(new Error("JSONを指定してください。"), { status: 415 });
        const reader = request.body?.getReader(); const chunks = []; let length = 0;
        if (reader) for (;;) {
            const { value, done } = await reader.read(); if (done) break;
            length += value.byteLength;
            if (length > 2048) { await reader.cancel(); throw Object.assign(new Error("入力が大きすぎます。"), { status: 413 }); }
            chunks.push(value);
        }
        let body;
        try { body = JSON.parse(await new Blob(chunks).text()); }
        catch { throw Object.assign(new Error("JSONが不正です。"), { status: 400 }); }
        return request.method === "POST" ? service.create(body) : service.update(token, body);
    });
}

export function cloudLiveLocationService(env) {
    if (String(env.LIVE_LOCATIONS_ENABLED).toLowerCase() !== "true" || !env.ANNOTATIONS_DB || !env.ROUTE_DATA) return null;
    const rawLimit = Number(env.LIVE_LOCATIONS_DAILY_WRITES);
    const service = createLiveLocationService(d1LiveLocationStore(env.ANNOTATIONS_DB), {
        dailyLimit: Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 20_000,
        routeIds: async () => {
            const object = await env.ROUTE_DATA.get("_index/routes.json");
            if (!object) throw new Error("Route index unavailable.");
            return (JSON.parse(await object.text()).routes || []).map(route => route.id);
        }
    });
    const list = service.list;
    service.list = async routeId => {
        const result = await list(routeId);
        // 動的設定のみを正とする。古い環境変数へフォールバックして再出現させない。
        const demoConfig = await readDemoSettings(d1DemoSettingsStore(env.ANNOTATIONS_DB), routeId, result.serverNow);
        const demo = liveDemoPosition(demoConfig, routeId, result.serverNow);
        if (demo) result.positions.push(demo);
        return result;
    };
    return service;
}
