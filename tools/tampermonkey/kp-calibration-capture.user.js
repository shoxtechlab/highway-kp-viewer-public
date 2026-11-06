// ==UserScript==
// @name         Highway KP Calibration Capture
// @namespace    https://github.com/shoxtechlab/
// @version      0.4.0
// @description  Google Street Viewの現在地点をKPキャリブレーション点として保存します。
// @match        https://www.google.com/maps/*
// @match        https://www.google.co.jp/maps/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// ==/UserScript==

(() => {
  "use strict";

  const STORAGE_KEY = "highway-kp-calibration-capture-v1";
  const emptyState = () => ({
    formatVersion: 1,
    selection: { routeId: "", segmentId: "", direction: "down", pointType: "normal", kp: "" },
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
      .actions { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:8px }.danger { border-color:#b3261e; color:#b3261e }.status { min-height:18px; margin:7px 0 0; color:#137333 }.summary { color:#5f6368 }
      ul { margin:8px 0 0; padding:0; list-style:none; border-top:1px solid #dadce0 } li { display:grid; grid-template-columns:1fr auto; gap:6px; padding:6px 0; border-bottom:1px solid #eee } small { display:block;color:#5f6368 }.delete { color:#b3261e }.hidden { display:none }
      @media(max-width:600px) { .panel { top:auto; right:6px; bottom:6px; left:6px; width:auto; max-height:55vh; padding:9px } button { min-height:38px } }
    </style>
    <section class="panel"><header><h1>KPキャリブレーション点</h1><button id="fold" type="button">－</button></header><div class="body">
      <div class="grid">
        <label>路線ID<input id="routeId" placeholder="e6"></label>
        <label>区間ID（任意）<input id="segmentId" placeholder="joban"></label>
        <label>方向<select id="direction"><option value="down">下り</option><option value="up">上り</option></select></label>
        <label>点の種類<select id="pointType"><option value="normal">通常補正点</option><option value="origin">始点延長</option><option value="terminus">終点延長</option></select></label>
        <label>KP<input id="kp" type="text" inputmode="decimal" placeholder="100.0"></label>
      </div>
      <div id="coord" class="coord error">URLから座標を取得できません</div>
      <button id="register" class="primary" type="button" disabled>この地点を登録</button>
      <div class="actions"><button id="copy">補正JSONコピー</button><button id="download">JSON保存</button><button id="import">JSON読込</button><button id="delete-all" class="danger">全削除</button></div>
      <input id="file" class="hidden" type="file" accept="application/json,.json">
      <p id="status" class="status"></p><div id="summary" class="summary"></div><ul id="history"></ul>
    </div></section>`;

  const $ = (selector) => root.querySelector(selector);
  const fields = { routeId: $("#routeId"), segmentId: $("#segmentId"), direction: $("#direction"), pointType: $("#pointType"), kp: $("#kp") };

  // Google Maps uses "." as a page shortcut. When the KP field is active,
  // consume it before Maps sees it and insert the decimal point ourselves.
  window.addEventListener("keydown", (event) => {
    if ((event.key !== "." && event.code !== "NumpadDecimal") || root.activeElement !== fields.kp) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const input = fields.kp;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.setRangeText(".", start, end, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, true);

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
      pointType: fields.pointType.value,
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
  function calibrationPayload() {
    const routeId = norm(fields.routeId.value);
    const segmentId = norm(fields.segmentId.value);
    const selected = state.points.filter((point) => norm(point.routeId) === routeId && norm(point.segmentId) === segmentId);
    const json = Object.fromEntries(["down", "up"].map((direction) => [direction, selected
      .filter((point) => point.direction === direction && (!point.pointType || point.pointType === "normal"))
      .sort((a, b) => Number(a.kp) - Number(b.kp))
      .map((point) => ({ name: `${Number(point.kp)}KP`, coord: point.coord, kp_m: Math.round(Number(point.kp) * 1000) }))]));
    const origins = Object.fromEntries(["down", "up"].flatMap((direction) => {
      const point = selected.find((item) => item.direction === direction && item.pointType === "origin");
      return point ? [[direction, { name:`${Number(point.kp)}KP`, coord:point.coord, kp_m:Math.round(Number(point.kp)*1000), length_to_route_m:"auto" }]] : [];
    }));
    const termini = Object.fromEntries(["down", "up"].flatMap((direction) => {
      const point = selected.find((item) => item.direction === direction && item.pointType === "terminus");
      return point ? [[direction, { name:`${Number(point.kp)}KP`, coord:point.coord, kp_m:Math.round(Number(point.kp)*1000), length_from_route_m:"auto" }]] : [];
    }));
    if (Object.keys(origins).length) json.origins = origins;
    if (Object.keys(termini).length) json.termini = termini;
    return {
      routeId,
      segmentId,
      selected,
      json
    };
  }
  function downloadJson(json, fileName) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type:"application/json" }));
    const a = document.createElement("a"); a.href=url; a.download=fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadCalibration() {
    const output = calibrationPayload();
    if (!output.routeId || !output.selected.length) return status("選択中の路線・区間に補正点がありません。", true);
    const suffix = output.segmentId ? `-${output.segmentId}` : "";
    downloadJson(output.json, `${output.routeId}${suffix}-kp_calibration.json`);
    status(`${output.routeId}${output.segmentId ? ` / ${output.segmentId}` : ""}の${output.selected.length}点を補正JSONとして保存しました。`);
  }
  function calibrationPointToHistory(point, routeId, segmentId, direction, pointType) {
    if (!point || !Array.isArray(point.coord) || point.coord.length !== 2 || !point.coord.every(Number.isFinite) || !Number.isFinite(Number(point.kp_m))) {
      throw new Error(`${direction}の補正点形式が不正です`);
    }
    return {
      routeId,
      segmentId,
      direction,
      pointType,
      kp: Number(point.kp_m) / 1000,
      coord: point.coord,
      registeredAt: new Date().toISOString(),
      source: "calibration-json-import"
    };
  }

  function pointsFromCalibrationJson(input, routeId, segmentId) {
    const points = [];
    for (const direction of ["down", "up"]) {
      if (input[direction] != null && !Array.isArray(input[direction])) {
        throw new Error(`${direction}は配列で指定してください`);
      }
      for (const point of input[direction] || []) {
        points.push(calibrationPointToHistory(point, routeId, segmentId, direction, "normal"));
      }
      if (input.origins?.[direction]) {
        points.push(calibrationPointToHistory(input.origins[direction], routeId, segmentId, direction, "origin"));
      }
      if (input.termini?.[direction]) {
        points.push(calibrationPointToHistory(input.termini[direction], routeId, segmentId, direction, "terminus"));
      }
    }
    if (!points.length) throw new Error("down/up/origins/terminiに補正点がありません");
    return points;
  }

  async function importFile(file) {
    try {
      const input = JSON.parse(await file.text());
      const routeId = norm(fields.routeId.value);
      const segmentId = norm(fields.segmentId.value);
      if (!routeId) throw new Error("読み込み先の路線IDを先に入力してください");
      // 0.3以前の全履歴JSONも移行用途に限り引き続き読み込める。
      const imported = Array.isArray(input.points)
        ? input.points
        : pointsFromCalibrationJson(input, routeId, segmentId);
      const map = new Map(state.points.map((p) => [pointKey(p), p])); let added=0, updated=0;
      imported.forEach((p) => {
        if (!p.routeId || !["up","down"].includes(p.direction) || !Number.isFinite(Number(p.kp)) || !Array.isArray(p.coord) || !p.coord.every(Number.isFinite)) throw new Error("形式が不正な点があります");
        const clean = { ...p, routeId:norm(p.routeId), segmentId:norm(p.segmentId), kp:Number(p.kp) };
        map.has(pointKey(clean)) ? updated++ : added++; map.set(pointKey(clean), clean);
      });
      state.points=[...map.values()]; persist(); render(); status(`${routeId}${segmentId ? ` / ${segmentId}` : ""}へJSON読込完了：追加${added}点、更新${updated}点。`);
    } catch (e) { status(`読み込み失敗：${e.message}`, true); }
  }

  function deleteAllPoints() {
    if (!state.points.length) return status("削除する点はありません。");
    if (!confirm(`保存中の全${state.points.length}点を削除しますか？この操作は元に戻せません。`)) return;
    state.points = [];
    persist();
    render();
    status("保存中の補正点をすべて削除しました。");
  }
  function render() {
    const list=$("#history"); list.textContent="";
    state.points.slice(-10).reverse().forEach((point) => {
      const li=document.createElement("li"), text=document.createElement("span"), small=document.createElement("small"), del=document.createElement("button");
      const typeLabel = point.pointType === "origin" ? "始点延長" : point.pointType === "terminus" ? "終点延長" : "通常";
      text.textContent=`${point.routeId}${point.segmentId ? ` / ${point.segmentId}` : ""}　${point.direction === "down" ? "下り" : "上り"} ${point.kp} KP（${typeLabel}）`;
      small.textContent=`${point.coord[1]}, ${point.coord[0]}`; text.appendChild(small); del.textContent="削除"; del.className="delete";
      del.onclick=()=>{ if(confirm(`${point.kp} KPを削除しますか？`)){ state.points=state.points.filter((p)=>p!==point); persist(); render(); } };
      li.append(text,del); list.appendChild(li);
    });
    $("#summary").textContent=`保存中：${state.points.length}点${state.points.length>10 ? "（最新10点を表示）" : ""}`;
  }

  $("#fold").onclick=(e)=>{ $(".panel").classList.toggle("fold"); e.currentTarget.textContent=$(".panel").classList.contains("fold") ? "KP＋" : "－"; };
  $("#register").onclick=register;
  $("#copy").onclick=()=>{ const output=calibrationPayload(); if(!output.routeId||!output.selected.length)return status("選択中の路線・区間に補正点がありません。",true); GM_setClipboard(JSON.stringify(output.json,null,2),"text"); status(`${output.selected.length}点の補正JSONをコピーしました。`); };
  $("#download").onclick=downloadCalibration; $("#import").onclick=()=>$("#file").click(); $("#delete-all").onclick=deleteAllPoints;
  $("#file").onchange=(e)=>{ if(e.target.files[0]) importFile(e.target.files[0]); e.target.value=""; };
  root.addEventListener("keydown", (e)=>{ if(e.altKey && e.key === "Enter") register(); });
  render(); refreshCoordinate(); setInterval(refreshCoordinate, 500);
})();
