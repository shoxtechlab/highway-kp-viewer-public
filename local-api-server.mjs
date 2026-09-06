import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { createRouteService, apiError } from "./server/route-service.js";
import { loadRoadSource } from "./lib/roadSourceCompiler.mjs";

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
      preferredDirection: url.searchParams.get("preferredDirection"),
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
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
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
