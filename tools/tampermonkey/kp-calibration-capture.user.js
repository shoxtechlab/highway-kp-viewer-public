// ==UserScript==
// @name         Highway KP Calibration Capture
// @namespace    https://github.com/shoxtechlab/
// @version      0.1.0
// @description  Google Street Viewの現在地点をKPキャリブレーション点として保存します。
// @match        https://www.google.com/maps/*
// @match        https://www.google.co.jp/maps/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// ==/UserScript==

(() => {
  "use strict";

  const STORAGE_KEY = "highway-kp-calibration-capture-v1";
  const emptyState = () => ({
    formatVersion: 1,
    selection: { routeId: "", segmentId: "", direction: "down", kp: "" },
    points: [],
  });
  const saved = GM_getValue(STORAGE_KEY, null);
  let state = saved && typeof saved === "object"
    ? { ...emptyState(), ...saved, selection: { ...emptyState().selection, ...(saved.selection || {}) }, points: Array.isArray(saved.points) ? saved.points : [] }
    : emptyState();
  let currentCoordinate = null;
  let lastUrl = "";

  const host = document.createElement("div");
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial } * { box-sizing: border-box }
      .panel { position:fixed; z-index:2147483647; top:64px; right:12px; width:326px; max-height:calc(100vh - 76px); overflow:auto; padding:12px; border:1px solid #9aa0a6; border-radius:12px; background:rgba(255,255,255,.97); color:#202124; box-shadow:0 3px 14px #0005; font:13px/1.4 system-ui,sans-serif }
      .panel.fold { width:auto; padding:7px }.panel.fold .body { display:none }
      header { display:flex; align-items:center; justify-content:space-between; gap:8px } h1 { margin:0; font-size:14px }
      button,input,select { font:inherit } button { min-height:32px; border:1px solid #9aa0a6; border-radius:7px; background:#fff; color:#202124; cursor:pointer }
      .grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px } label { display:grid; gap:3px; color:#5f6368 }
      input,select { width:100%; min-width:0; height:34px; padding:5px 7px; border:1px solid #bdc1c6; border-radius:6px; background:#fff }
      .coord { margin-top:10px; padding:8px; border-radius:7px; background:#f1f3f4; font-family:monospace; overflow-wrap:anywhere }.error { color:#b3261e!important }
      .primary { width:100%; margin-top:9px; border-color:#137333; background:#188038; color:#fff; font-weight:700 }.primary:disabled { border-color:#dadce0; background:#dadce0; color:#80868b }
      .actions { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-top:8px }.status { min-height:18px; margin:7px 0 0; color:#137333 }.summary { color:#5f6368 }
      ul { margin:8px 0 0; padding:0; list-style:none; border-top:1px solid #dadce0 } li { display:grid; grid-template-columns:1fr auto; gap:6px; padding:6px 0; border-bottom:1px solid #eee } small { display:block;color:#5f6368 }.delete { color:#b3261e }.hidden { display:none }
      @media(max-width:600px) { .panel { top:auto; right:6px; bottom:6px; left:6px; width:auto; max-height:55vh; padding:9px } button { min-height:38px } }
    </style>
    <section class="panel"><header><h1>KPキャリブレーション点</h1><button id="fold" type="button">－</button></header><div class="body">
      <div class="grid">
        <label>路線ID<input id="routeId" placeholder="e6"></label>
        <label>区間ID（任意）<input id="segmentId" placeholder="joban"></label>
        <label>方向<select id="direction"><option value="down">下り</option><option value="up">上り</option></select></label>
        <label>KP<input id="kp" type="number" inputmode="decimal" step="0.001" placeholder="100.0"></label>
      </div>
      <div id="coord" class="coord error">URLから座標を取得できません</div>
      <button id="register" class="primary" type="button" disabled>この地点を登録</button>
      <div class="actions"><button id="copy">JSONコピー</button><button id="download">DL</button><button id="import">読込</button></div>
      <input id="file" class="hidden" type="file" accept="application/json,.json">
      <p id="status" class="status"></p><div id="summary" class="summary"></div><ul id="history"></ul>
    </div></section>`;

  const $ = (selector) => root.querySelector(selector);
  const fields = { routeId: $("#routeId"), segmentId: $("#segmentId"), direction: $("#direction"), kp: $("#kp") };
  Object.entries(fields).forEach(([key, el]) => {
    el.value = state.selection[key] ?? "";
    el.addEventListener("input", () => { state.selection[key] = el.value; persist(); updateButton(); });
  });
  const persist = () => GM_setValue(STORAGE_KEY, state);
  const norm = (value) => String(value || "").trim().toLowerCase();
  const pointKey = (p) => [norm(p.routeId), norm(p.segmentId), p.direction, Number(p.kp)].join("|");
  const status = (text, error = false) => { $("#status").textContent = text; $("#status").classList.toggle("error", error); };

  function extractCoordinate(url) {
    let decoded = url;
    try { decoded = decodeURIComponent(url); } catch (_) {}
    const match = decoded.match(/[?&]viewpoint=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i)
      || decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|\/|$)/);
    if (!match) return null;
    const lat = Number(match[1]); const lon = Number(match[2]);
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
  }
  function refreshCoordinate() {
    if (location.href === lastUrl) return;
    lastUrl = location.href; currentCoordinate = extractCoordinate(lastUrl);
    $("#coord").textContent = currentCoordinate ? `緯度 ${currentCoordinate.lat} / 経度 ${currentCoordinate.lon}` : "URLから座標を取得できません";
    $("#coord").classList.toggle("error", !currentCoordinate); updateButton();
  }
  function updateButton() {
    $("#register").disabled = !currentCoordinate || !norm(fields.routeId.value) || !Number.isFinite(Number(fields.kp.value));
  }
  function register() {
    refreshCoordinate();
    const point = {
      routeId: norm(fields.routeId.value), segmentId: norm(fields.segmentId.value), direction: fields.direction.value,
      kp: Number(fields.kp.value), coord: currentCoordinate ? [currentCoordinate.lon, currentCoordinate.lat] : null,
      registeredAt: new Date().toISOString(), source: "streetview-manual", sourceUrl: location.href,
    };
    if (!point.routeId || !Number.isFinite(point.kp) || !point.coord) return status("路線ID、KP、座標を確認してください。", true);
    const index = state.points.findIndex((p) => pointKey(p) === pointKey(point));
    if (index >= 0) {
      const old = state.points[index];
      const changed = old.coord?.[0] !== point.coord[0] || old.coord?.[1] !== point.coord[1];
      if (changed && !confirm(`${point.routeId} ${point.segmentId || "(単一路線)"} ${point.direction} ${point.kp} KPの座標を更新しますか？`)) return;
      state.points[index] = point; status(changed ? "登録済み点を更新しました。" : "登録日時を更新しました。");
    } else { state.points.push(point); status("登録しました。"); }
    persist(); render();
  }
  function payload() {
    return { formatVersion:1, exportedAt:new Date().toISOString(), coordinateOrder:"longitude,latitude", points:[...state.points].sort((a,b) => a.routeId.localeCompare(b.routeId) || (a.segmentId||"").localeCompare(b.segmentId||"") || a.direction.localeCompare(b.direction) || a.kp-b.kp) };
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload(), null, 2)], { type:"application/json" }));
    const a = document.createElement("a"); a.href=url; a.download=`kp-calibration-points-${new Date().toISOString().slice(0,10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); status(`${state.points.length}点をダウンロードしました。`);
  }
  async function importFile(file) {
    try {
      const input = JSON.parse(await file.text());
      if (!Array.isArray(input.points)) throw new Error("points配列がありません");
      const map = new Map(state.points.map((p) => [pointKey(p), p])); let added=0, updated=0;
      input.points.forEach((p) => {
        if (!p.routeId || !["up","down"].includes(p.direction) || !Number.isFinite(Number(p.kp)) || !Array.isArray(p.coord) || !p.coord.every(Number.isFinite)) throw new Error("形式が不正な点があります");
        const clean = { ...p, routeId:norm(p.routeId), segmentId:norm(p.segmentId), kp:Number(p.kp) };
        map.has(pointKey(clean)) ? updated++ : added++; map.set(pointKey(clean), clean);
      });
      state.points=[...map.values()]; persist(); render(); status(`読み込み完了：追加${added}点、更新${updated}点。`);
    } catch (e) { status(`読み込み失敗：${e.message}`, true); }
  }
  function render() {
    const list=$("#history"); list.textContent="";
    state.points.slice(-10).reverse().forEach((point) => {
      const li=document.createElement("li"), text=document.createElement("span"), small=document.createElement("small"), del=document.createElement("button");
      text.textContent=`${point.routeId}${point.segmentId ? ` / ${point.segmentId}` : ""}　${point.direction === "down" ? "下り" : "上り"} ${point.kp} KP`;
      small.textContent=`${point.coord[1]}, ${point.coord[0]}`; text.appendChild(small); del.textContent="削除"; del.className="delete";
      del.onclick=()=>{ if(confirm(`${point.kp} KPを削除しますか？`)){ state.points=state.points.filter((p)=>p!==point); persist(); render(); } };
      li.append(text,del); list.appendChild(li);
    });
    $("#summary").textContent=`保存中：${state.points.length}点${state.points.length>10 ? "（最新10点を表示）" : ""}`;
  }

  $("#fold").onclick=(e)=>{ $(".panel").classList.toggle("fold"); e.currentTarget.textContent=$(".panel").classList.contains("fold") ? "KP＋" : "－"; };
  $("#register").onclick=register;
  $("#copy").onclick=()=>{ GM_setClipboard(JSON.stringify(payload(),null,2),"text"); status(`${state.points.length}点をコピーしました。`); };
  $("#download").onclick=download; $("#import").onclick=()=>$("#file").click();
  $("#file").onchange=(e)=>{ if(e.target.files[0]) importFile(e.target.files[0]); e.target.value=""; };
  root.addEventListener("keydown", (e)=>{ if(e.altKey && e.key === "Enter") register(); });
  render(); refreshCoordinate(); setInterval(refreshCoordinate, 500);
})();

