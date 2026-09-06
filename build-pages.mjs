import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileDataModel } from "./lib/dataCompiler.mjs";
import { writeCompiledRoadSources } from "./lib/roadSourceCompiler.mjs";

const projectRoot = process.cwd();
const outputDir = join(projectRoot, "dist");
const includePrivateRouteData = process.env.BUILD_PUBLIC_ROUTE_DATA !== "false"
  && !process.argv.includes("--exclude-private-route-data");

// Validate and normalize all cross-file references before publishing anything.
// The returned compatibility model is intentionally not used by the browser yet.
let compiledDataModel;
try {
  compiledDataModel = await compileDataModel({ projectRoot });
} catch (error) {
  // The public source snapshot intentionally omits road.json and route.geojson.
  // In that environment, reuse the public-safe scope data compiled by the
  // private repository instead of making the excluded datasets mandatory.
  if (includePrivateRouteData || error?.code !== "ENOENT") throw error;
  const runtimeScopes = JSON.parse(
    await readFile(join(projectRoot, "data", "route-scopes.json"), "utf8")
  );
  compiledDataModel = { routeIds: [], runtimeScopes };
}

const publicEntries = [
  "index.html",
  "app-version.json",
  "manifest.webmanifest",
  "viewer.html",
  "data-sources.html",
  "css",
  "js",
  "icons",
  "honshi",
  "data"
];
const serverOnlyModules = new Set([
  "/js/kpGeo.js",
  "/js/routeMatcher.js",
  "/js/svEngine.js"
]);

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const entry of publicEntries) {
  await cp(join(projectRoot, entry), join(outputDir, entry), {
    recursive: true,
    filter(source) {
      const normalizedSource = source.replaceAll("\\", "/");
      if ([...serverOnlyModules].some(path => normalizedSource.endsWith(path))) {
        return false;
      }
      if (includePrivateRouteData) return true;
      return !(
        normalizedSource.endsWith("/route.geojson") ||
        normalizedSource.endsWith("/road.json")
      );
    }
  });
}

if (includePrivateRouteData) {
  await writeCompiledRoadSources({
    projectRoot,
    outputRoot: join(outputDir, "data"),
    routeIds: compiledDataModel.routeIds
  });
}

// Keep the browser contract stable: facility-based source definitions are
// compiled back into the legacy numeric route-scopes.json shape.
await writeFile(
  join(outputDir, "data", "route-scopes.json"),
  `${JSON.stringify(compiledDataModel.runtimeScopes, null, 2)}\n`
);

// Company, branch and office portals are generated from one organization registry.
// This keeps dozens of office pages from becoming separately maintained copies.
const organizations = JSON.parse(
  await readFile(join(projectRoot, "data", "organizations.json"), "utf8")
);
const portalTemplate = await readFile(
  join(projectRoot, "portals", "templates", "portal.html"),
  "utf8"
);

const escapeHtml = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function renderPortal(values) {
  return portalTemplate.replace(/{{([A-Z_]+)}}/g, (_, key) => values[key] ?? "");
}

function renderLinks(items) {
  if (!items.length) return '<p class="route-unavailable">表示できる入口は準備中です。</p>';
  return `<div class="route-list">${items.map(item =>
    `<a href="${escapeHtml(item.href)}">${escapeHtml(item.name)}</a>`
  ).join("\n")}</div>`;
}

function viewerHref(item) {
  const routeId = item.route || item.id;
  const params = new URLSearchParams({ route: routeId });
  if (item.scope) params.set("scope", item.scope);
  if (item.portal) params.set("portal", item.portal);
  return `/viewer.html?${params}`;
}

async function writePortal(relativeDir, html) {
  const directory = join(outputDir, relativeDir);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.html"), html);
  return directory;
}

const { operators, branches, offices } = organizations;

await writePortal("operators", renderPortal({
  TITLE: "道路会社",
  MANIFEST: "",
  BODY_DATA: "",
  HOME_HREF: "/",
  PARENT_KEY: "",
  PARENT_HREF: "",
  KICKER: "ROAD OPERATORS",
  HEADING: "道路会社から選ぶ",
  DESCRIPTION: "道路会社、支社、管理拠点の順に表示範囲を選択します。",
  LIST_TITLE: "道路会社",
  LIST_CONTENT: renderLinks(operators.map(item => ({
    name: item.name,
    href: `/${item.id}/?from=operators`
  }))),
  SCRIPT: '<script src="/js/appVersionNotice.js" type="module"></script>'
}));

for (const operator of operators) {
  const childBranches = branches.filter(item => item.operatorId === operator.id);
  const directOffices = offices.filter(item =>
    item.operatorId === operator.id && !item.branchId
  );
  const featuredRoutes = operator.featuredRoutesSource
    ? JSON.parse(await readFile(join(projectRoot, operator.featuredRoutesSource), "utf8"))
    : [];
  const featuredOffices = operator.featuredOfficesSource
    ? JSON.parse(await readFile(join(projectRoot, operator.featuredOfficesSource), "utf8"))
    : [];
  const hierarchyLinks = [
    ...childBranches.map(item => ({
      name: item.name,
      href: `/${operator.id}/${item.id}/?from=${operator.id}`
    })),
    ...directOffices.map(item => ({
      name: item.name,
      href: `/${operator.id}/${item.id}/?from=${operator.id}`
    }))
  ];
  await writePortal(operator.id, renderPortal({
    TITLE: operator.name,
    MANIFEST: operator.manifest
      ? `<meta name="apple-mobile-web-app-title" content="${escapeHtml(operator.appleWebAppTitle || operator.name)}">
  <link rel="manifest" href="${escapeHtml(operator.manifest)}">`
      : "",
    BODY_DATA: "",
    HOME_HREF: "/operators/",
    PARENT_KEY: "operators",
    PARENT_HREF: "/operators/",
    KICKER: "ROAD OPERATOR",
    HEADING: operator.name,
    DESCRIPTION: operator.description,
    LIST_TITLE: featuredRoutes.length
      ? "路線別表示"
      : (childBranches.length ? "支社・管理拠点" : "管理拠点"),
    LIST_CONTENT: renderLinks(featuredRoutes.length
      ? featuredRoutes.map(item => ({ name: item.name, href: viewerHref(item) }))
      : hierarchyLinks),
    EXTRA_CONTENT: featuredOffices.length
      ? `<section class="route-panel">
      <h2>管理センター別表示</h2>
      <p class="panel-description">担当区間だけを直接表示します。</p>
      ${renderLinks(featuredOffices.map(item => ({ name: item.name, href: viewerHref(item) })))}
    </section>`
      : "",
    SCRIPT: '<script src="/js/appVersionNotice.js" type="module"></script>'
  }));

  for (const branch of childBranches) {
    const childOffices = offices.filter(item =>
      item.operatorId === operator.id && item.branchId === branch.id
    );
    await writePortal(join(operator.id, branch.id), renderPortal({
      TITLE: `${operator.name} ${branch.name}`,
      MANIFEST: "",
      BODY_DATA: "",
      HOME_HREF: `/${operator.id}/`,
      PARENT_KEY: operator.id,
      PARENT_HREF: `/${operator.id}/`,
      KICKER: "BRANCH AREA",
      HEADING: branch.name,
      DESCRIPTION: `${operator.name} ${branch.name}の管理拠点から選択します。`,
      LIST_TITLE: "管理拠点",
      LIST_CONTENT: renderLinks(childOffices.map(item => ({
        name: item.name,
        href: `/${operator.id}/${branch.id}/${item.id}/?from=${operator.id}/${branch.id}`
      }))),
      SCRIPT: '<script src="/js/appVersionNotice.js" type="module"></script>'
    }));
  }
}

for (const office of offices) {
  const operator = operators.find(item => item.id === office.operatorId);
  const branch = office.branchId
    ? branches.find(item => item.id === office.branchId && item.operatorId === office.operatorId)
    : null;
  if (!operator || (office.branchId && !branch)) {
    throw new Error(`Invalid office hierarchy: ${office.id}`);
  }

  let routesSource = office.routesSource;
  if (!routesSource && office.routes) {
    const generatedRouteDir = join(outputDir, "data", "office-routes");
    await mkdir(generatedRouteDir, { recursive: true });
    await writeFile(
      join(generatedRouteDir, `${office.id}.json`),
      JSON.stringify(office.routes, null, 2)
    );
    routesSource = `data/office-routes/${office.id}.json`;
  }
  if (!routesSource) throw new Error(`Office has no routes: ${office.id}`);

  const html = renderPortal({
    TITLE: `${office.name}管内`,
    MANIFEST: '<link rel="manifest" href="manifest.webmanifest">',
    BODY_DATA: ` data-routes-src="/${routesSource}" data-viewer-base="/viewer.html"`,
    HOME_HREF: branch ? `/${operator.id}/${branch.id}/` : `/${operator.id}/`,
    PARENT_KEY: branch ? `${operator.id}/${branch.id}` : operator.id,
    PARENT_HREF: branch ? `/${operator.id}/${branch.id}/` : `/${operator.id}/`,
    KICKER: `${office.id.replace(/-office$/, "").toUpperCase()} OFFICE AREA`,
    HEADING: `${office.name}管内 KP Viewer`,
    DESCRIPTION: `${office.name}が担当する路線・区間を表示します。`,
    LIST_TITLE: "管内路線",
    LIST_CONTENT: '<div id="route-list" class="route-list"></div>',
    SCRIPT: '<script src="/js/index.js" type="module"></script>'
  });
  const createManifest = startPath => JSON.stringify({
    id: startPath,
    name: `高速道路 KP Viewer ${office.name}管内`,
    short_name: `高速道路KP ${office.name.replace(/管理事務所|保全・サービスセンター|高速道路事務所/g, "")}`,
    start_url: startPath,
    scope: "/",
    display: "standalone",
    background_color: "#f3f3f3",
    theme_color: "#00973a",
    lang: "ja",
    icons: [{ src: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  }, null, 2);

  const canonicalPath = branch
    ? `/${operator.id}/${branch.id}/${office.id}/`
    : `/${operator.id}/${office.id}/`;
  const canonicalDir = await writePortal(
    branch ? join(operator.id, branch.id, office.id) : join(operator.id, office.id),
    html
  );
  await writeFile(
    join(canonicalDir, "manifest.webmanifest"),
    createManifest(canonicalPath)
  );

  // Legacy paths remain valid for existing bookmarks and installed web apps.
  const legacyDir = await writePortal(office.id, html);
  await writeFile(
    join(legacyDir, "manifest.webmanifest"),
    createManifest(`/${office.id}/`)
  );
}

console.log(
  `Built dist/ (private route data: ${includePrivateRouteData ? "included" : "excluded"})`
);
