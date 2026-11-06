import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { createRouteService, apiError } from "./server/route-service.js";
import { loadRoadSource } from "./lib/roadSourceCompiler.mjs";
import { buildRouteSearchIndex } from "./lib/routeSearchIndex.mjs";
import { createLiveLocationService, memoryLiveLocationStore } from "./server/live-location-service.js";
import { handleLiveLocationRequest } from "./server/live-location-handler.js";
import { liveDemoPosition } from "./server/live-location-demo.js";
import { memoryDemoSettingsStore, readDemoSettings, handleDemoAdminRequest } from "./server/live-demo-settings.js";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(projectRoot, "dist");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

let localRouteIndex;
const routeService = createRouteService(async (routeId, fileName) => {
  try {
    if (fileName === "road.json") {
      return JSON.stringify(await loadRoadSource(projectRoot, routeId));
    }
    return await readFile(join(projectRoot, "data", routeId, fileName), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw apiError(404, "Route data not found.");
    throw error;
  }
}, {
  readRouteIndex: async () => {
    if (!localRouteIndex) {
      const routes = JSON.parse(await readFile(join(projectRoot, "data", "routes.json"), "utf8"));
      localRouteIndex = JSON.stringify(await buildRouteSearchIndex({ projectRoot, routes }));
    }
    return localRouteIndex;
  }
});

export const loadRoute = routeService.loadRoute;

export async function handleApi(url) {
  const routeMatch = url.pathname.match(/^\/api\/route\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/);
  if (routeMatch) {
    return routeService.getRoute(routeMatch[1]);
  }

  if (url.pathname === "/api/position") {
    return routeService.getPosition({
      routeId: url.searchParams.get("route"),
      direction: url.searchParams.get("direction"),
      kp: url.searchParams.get("kp"),
      sectionId: url.searchParams.get("section")
    });
  }

  if (url.pathname === "/api/nearest") {
    return routeService.getNearest({
      routeId: url.searchParams.get("route"),
      lat: url.searchParams.get("lat"),
      lon: url.searchParams.get("lon"),
      preferredRoute: url.searchParams.get("preferredRoute"),
      preferredDirection: url.searchParams.get("preferredDirection"),
      heading: url.searchParams.get("heading"),
      speed: url.searchParams.get("speed"),
      accuracy: url.searchParams.get("accuracy"),
      sectionIds: url.searchParams.get("sections")?.split(",").filter(Boolean)
    });
  }

  throw apiError(404, "API endpoint not found.");
}

async function serveStatic(pathname, response) {
  let requested = decodeURIComponent(pathname);
  if (requested === "/") requested = "/index.html";
  else if (requested.endsWith("/")) requested += "index.html";
  if (!extname(requested)) requested += ".html";
  const filePath = normalize(join(publicRoot, requested));
  const relativePath = relative(publicRoot, filePath);
  if (relativePath.startsWith("..") || relativePath === "") {
    throw apiError(404, "Not found.");
  }
  const info = await stat(filePath);
  if (!info.isFile()) throw apiError(404, "Not found.");
  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  response.end(await readFile(filePath));
}

export function createAppServer() {
  const demoStore = memoryDemoSettingsStore();
  const liveService = process.env.LIVE_LOCATIONS_ENABLED === "false" ? null : createLiveLocationService(memoryLiveLocationStore(), {
    routeIds: async () => JSON.parse(await readFile(join(projectRoot, "data", "routes.json"), "utf8")).map(route => route.id)
  });
  if (liveService) {
    const list = liveService.list;
    liveService.list = async routeId => {
      const result = await list(routeId);
      const demo = liveDemoPosition(await readDemoSettings(demoStore, routeId, result.serverNow), routeId, result.serverNow);
      if (demo) result.positions.push(demo);
      return result;
    };
  }
  return createServer(async (request, response) => {
    try {
      // Tailscale Serve等のHTTPS終端をループバック経由で使う場合も、
      // ブラウザのOriginと照合できるよう外側のスキームを復元する。
      // LANから来た任意の転送ヘッダーは信用しない。
      const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress);
      const scheme = loopback && request.headers["x-forwarded-proto"] === "https" ? "https" : "http";
      const forwardedHost = loopback ? request.headers["x-forwarded-host"] : null;
      const url = new URL(request.url, `${scheme}://${forwardedHost || request.headers.host || `${host}:${port}`}`);
      if (url.pathname === "/api/live-locations" || url.pathname === "/api/admin/demo-cars") {
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 2048) throw apiError(413, "入力が大きすぎます。"); chunks.push(chunk); }
        const webRequest = new Request(url, { method: request.method, headers: request.headers,
          ...(["GET", "HEAD"].includes(request.method) ? {} : { body: Buffer.concat(chunks) }) });
        const result = url.pathname === "/api/admin/demo-cars"
          ? await handleDemoAdminRequest(webRequest, { store: demoStore, adminKey: process.env.ANNOTATIONS_ADMIN_KEY })
          : await handleLiveLocationRequest(webRequest, liveService);
        response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(await result.text()); return;
      }
      if (url.pathname.startsWith("/api/")) {
        const body = await handleApi(url);
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        });
        response.end(JSON.stringify(body));
        return;
      }
      await serveStatic(url.pathname, response);
    } catch (error) {
      const status = error.status || (error.code === "ENOENT" ? 404 : 500);
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error.message || "Internal server error." }));
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createAppServer().listen(port, host, () => {
    console.log(`Local KP API: http://${host}:${port}/`);
  });
}
