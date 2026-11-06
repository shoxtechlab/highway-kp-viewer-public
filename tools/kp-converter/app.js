const THEME_KEY = "kp-viewer-theme";
const MAX_ROWS = 200;

const elements = {
  modes: [...document.querySelectorAll('input[name="mode"]')],
  file: document.getElementById("file-input"),
  drop: document.getElementById("drop-zone"),
  input: document.getElementById("csv-input"),
  help: document.getElementById("input-help"),
  sample: document.getElementById("sample-button"),
  count: document.getElementById("row-count"),
  previewHead: document.getElementById("preview-head"),
  previewBody: document.getElementById("preview-body"),
  validation: document.getElementById("validation-message"),
  convert: document.getElementById("convert-button"),
  resultPanel: document.getElementById("result-panel"),
  resultHead: document.getElementById("result-head"),
  resultBody: document.getElementById("result-body"),
  resultSummary: document.getElementById("result-summary"),
  download: document.getElementById("download-button"),
  keyDialog: document.getElementById("key-dialog"),
  keyInput: document.getElementById("key-input"),
  keySubmit: document.getElementById("key-submit"),
  keyError: document.getElementById("key-error"),
  theme: document.getElementById("theme-toggle")
};

let parsedRows = [];
let resultRows = [];
let adminKey = "";

function currentMode() {
  return elements.modes.find(input => input.checked)?.value || "position";
}

function applyTheme(theme) {
  const dark = theme === "dark";
  document.body.classList.toggle("dark-theme", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  elements.theme.setAttribute("aria-label", dark ? "ライトモードに切り替え" : "ダークモードに切り替え");
  elements.theme.title = elements.theme.getAttribute("aria-label");
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field.trim()); field = ""; }
    else if (char === "\n") { row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error("引用符が閉じられていません。");
  if (rows.length < 2) return { headers: rows[0] || [], records: [] };
  const headers = rows[0].map(value => value.trim());
  return {
    headers,
    records: rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])))
  };
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function requiredColumns(mode) {
  return mode === "position" ? ["route", "direction", "kp"] : ["lat", "lon"];
}

function updateHelp() {
  elements.help.textContent = currentMode() === "position"
    ? "必須列: route, direction, kp　任意列: section"
    : "必須列: lat, lon　任意列: route, preferredDirection, heading, speed, accuracy";
}

function refreshPreview() {
  elements.validation.className = "message";
  elements.validation.textContent = "";
  elements.resultPanel.hidden = true;
  try {
    const parsed = parseCsv(elements.input.value);
    const missing = requiredColumns(currentMode()).filter(column => !parsed.headers.includes(column));
    parsedRows = parsed.records;
    elements.count.textContent = `${parsedRows.length}行`;
    if (!parsed.headers.length) {
      elements.previewHead.innerHTML = "";
      elements.previewBody.innerHTML = '<tr><td class="empty">CSVを入力すると先頭5行を表示します。</td></tr>';
      elements.convert.disabled = true;
      return;
    }
    elements.previewHead.innerHTML = `<tr>${parsed.headers.map(header => `<th>${escapeHtml(header)}</th>`).join("")}</tr>`;
    elements.previewBody.innerHTML = parsedRows.slice(0, 5).map(record => `<tr>${parsed.headers.map(header => `<td>${escapeHtml(record[header])}</td>`).join("")}</tr>`).join("") || '<tr><td class="empty">データ行がありません。</td></tr>';
    if (missing.length) throw new Error(`必須列がありません: ${missing.join(", ")}`);
    if (!parsedRows.length) throw new Error("データ行を入力してください。");
    if (parsedRows.length > MAX_ROWS) throw new Error(`1回の上限は${MAX_ROWS}行です。`);
    elements.convert.disabled = false;
    elements.validation.textContent = `${parsedRows.length}行を変換できます。`;
  } catch (error) {
    parsedRows = [];
    elements.convert.disabled = true;
    elements.validation.className = "message error";
    elements.validation.textContent = error.message;
  }
}

function sampleCsv() {
  return currentMode() === "position"
    ? "route,direction,kp,section\ne28,down,25.0,\ne30,up,10.5,"
    : "lat,lon,route,preferredDirection,heading,speed,accuracy\n34.7250,135.3000,e28,down,220,80,10\n34.5000,133.9000,e30,up,45,0,8";
}

function toApiRecord(row) {
  const record = { ...row };
  for (const key of ["kp", "lat", "lon", "heading", "speed", "accuracy"]) {
    if (record[key] !== undefined && record[key] !== "") record[key] = Number(record[key]);
    else delete record[key];
  }
  return record;
}

function csvCell(value) {
  const text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function renderResults(data) {
  resultRows = data.results || [];
  const columns = [...new Set(resultRows.flatMap(row => Object.keys(row)))];
  elements.resultHead.innerHTML = `<tr>${columns.map(column => `<th>${escapeHtml(column)}</th>`).join("")}</tr>`;
  elements.resultBody.innerHTML = resultRows.slice(0, 20).map(row => `<tr>${columns.map(column => `<td>${escapeHtml(typeof row[column] === "object" ? JSON.stringify(row[column]) : row[column])}</td>`).join("")}</tr>`).join("");
  elements.resultSummary.textContent = `成功 ${data.successCount ?? 0} / エラー ${data.errorCount ?? 0}`;
  elements.resultPanel.hidden = false;
  elements.resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  elements.download.dataset.columns = JSON.stringify(columns);
}

async function runConversion() {
  elements.convert.disabled = true;
  elements.convert.textContent = "変換中…";
  elements.validation.className = "message";
  elements.validation.textContent = "サーバーへ変換を依頼しています。";
  try {
    const mode = currentMode();
    const response = await fetch(`/api/batch/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminKey}` },
      body: JSON.stringify({ records: parsedRows.map(toApiRecord) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) adminKey = "";
      throw new Error(data.error || `変換に失敗しました（${response.status}）`);
    }
    renderResults(data);
    elements.validation.textContent = "変換が完了しました。";
  } catch (error) {
    elements.validation.className = "message error";
    elements.validation.textContent = error.message;
  } finally {
    elements.convert.disabled = !parsedRows.length;
    elements.convert.textContent = "変換を実行";
  }
}

elements.theme.addEventListener("click", () => {
  const next = document.body.classList.contains("dark-theme") ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});
elements.modes.forEach(input => input.addEventListener("change", () => { updateHelp(); refreshPreview(); }));
elements.sample.addEventListener("click", () => { elements.input.value = sampleCsv(); refreshPreview(); });
elements.input.addEventListener("input", refreshPreview);
elements.file.addEventListener("change", async () => { const file = elements.file.files?.[0]; if (file) { elements.input.value = await file.text(); refreshPreview(); } });
for (const eventName of ["dragenter", "dragover"]) elements.drop.addEventListener(eventName, event => { event.preventDefault(); elements.drop.classList.add("is-dragover"); });
for (const eventName of ["dragleave", "drop"]) elements.drop.addEventListener(eventName, event => { event.preventDefault(); elements.drop.classList.remove("is-dragover"); });
elements.drop.addEventListener("drop", async event => { const file = event.dataTransfer?.files?.[0]; if (file) { elements.input.value = await file.text(); refreshPreview(); } });
elements.convert.addEventListener("click", () => { if (adminKey) runConversion(); else { elements.keyError.textContent = ""; elements.keyInput.value = ""; elements.keyDialog.showModal(); elements.keyInput.focus(); } });
elements.keyDialog.addEventListener("close", () => { if (elements.keyDialog.returnValue === "default") { const key = elements.keyInput.value.trim(); if (!key) return; adminKey = key; runConversion(); } });
elements.download.addEventListener("click", () => {
  const columns = JSON.parse(elements.download.dataset.columns || "[]");
  const csv = [columns.join(","), ...resultRows.map(row => columns.map(column => csvCell(row[column])).join(","))].join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  link.download = `kp-conversion-${currentMode()}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

applyTheme(localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light");
updateHelp();
refreshPreview();
