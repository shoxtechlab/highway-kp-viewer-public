import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { injectViewerHomeConfig } from "../lib/viewerHomeConfig.mjs";

const html = await readFile(new URL("../viewer.html", import.meta.url), "utf8");
const script = await readFile(new URL("../js/viewerHome.js", import.meta.url), "utf8");
const scopes = {
    "test-office": { home: "e-nexco/kanto/test-office/", routes: { e18: { start: 10, end: 50 } } },
    "honshi-kobe-office": { home: "honshi/", routes: { e28: { start: 0, end: 40 } } }
};
function initialize(search, override) {
    const built = injectViewerHomeConfig(html, scopes);
    const config = override ?? built.match(/<script id="viewer-home-config" type="application\/json">([\s\S]*?)<\/script>/)[1];
    const attributes = new Map([["aria-disabled", "true"]]);
    const title = {
        set href(value) { attributes.set("href", value); },
        removeAttribute(name) { attributes.delete(name); }
    };
    runInNewContext(script, {
        document: { baseURI: "https://example.test/viewer?route=e28", getElementById: id => id === "app-title" ? title : { textContent: config } },
        location: { search, origin: "https://example.test" }, URL, URLSearchParams,
        fetch() { throw new Error("初期ホーム設定が通信に依存してはいけない"); }
    });
    return attributes;
}

test("HTML has no temporary nationwide href before bootstrap executes", () => {
    const anchor = html.match(/<a\b[^>]*id="app-title"[^>]*>/)[0];
    assert.ok(!/\bhref=/.test(anchor));
    assert.ok(anchor.includes('aria-disabled="true"'));
    assert.ok(html.indexOf('src="js/viewerHome.js"') < html.indexOf('src="js/main.js"'));
});

test("home is correct before any route API finishes, including office scope precedence", () => {
    assert.equal(initialize("?route=e28&portal=honshi").get("href"), "https://example.test/honshi/");
    assert.equal(initialize("?route=e30&portal=national").get("href"), "https://example.test/index.html");
    const office = initialize("?route=e18&scope=test-office&portal=national");
    assert.equal(office.get("href"), "https://example.test/e-nexco/kanto/test-office/");
    assert.equal(office.has("aria-disabled"), false);
    assert.equal(initialize("?route=e28&scope=honshi-kobe-office&portal=honshi").get("href"), "https://example.test/honshi/");
});

test("unknown or malformed contexts do not acquire a nationwide fallback link", () => {
    assert.equal(initialize("?route=e28&portal=unknown").has("href"), false);
    assert.equal(initialize("?route=e28").has("href"), false);
    assert.equal(initialize("?route=e28&scope=test-office").has("href"), false);
    assert.equal(initialize("?portal=honshi", "broken json").has("href"), false);
    assert.equal(initialize("?portal=bad", '{"portals":{"bad":"https://external.test/"}}').has("href"), false);
});

test("navigation config derives from existing scopes without embedding KP data", () => {
    const built = injectViewerHomeConfig(html, scopes);
    const config = JSON.parse(built.match(/<script id="viewer-home-config" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(config.scopes["test-office"], { home: scopes["test-office"].home, routes: ["e18"] });
    assert.equal(JSON.stringify(config).includes('"start"'), false);
});
