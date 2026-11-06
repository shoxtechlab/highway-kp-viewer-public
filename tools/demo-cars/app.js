const endpoint = "/api/admin/demo-cars";
const $ = id => document.getElementById(id);
function setKeyVisible(visible) {
    $("key").type = visible ? "text" : "password";
    $("show-key").textContent = visible ? "非表示" : "表示";
    $("show-key").setAttribute("aria-pressed", String(visible));
}
$("show-key").addEventListener("click", () => setKeyVisible($("key").type === "password"));
document.addEventListener("visibilitychange", () => { if (document.hidden) setKeyVisible(false); });
let key = "", busy = false, clockOffset = 0;
function notice(text, error = false) { $("notice").textContent = text; $("notice").classList.toggle("error", error); }
async function request(method = "GET", body) {
    const response = await fetch(endpoint, { method, cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) {
        if (response.status === 401) logout();
        throw new Error(result.error || "操作に失敗しました。");
    }
    return result;
}
function render(configs) {
    const root = $("routes"); root.replaceChildren();
    for (const c of configs) {
        const form = document.createElement("form"); form.className = "panel";
        // 表示名と路線IDはサーバー定義の3路線だけだが、文字列はtextContentで設定する。
        form.innerHTML = '<h2><span class="name"></span><span class="state"></span></h2><div class="fields"><label>出発KP<input name="kp" type="number" min="0" step="any" required></label><label>方向<select name="direction"><option value="down">下り</option><option value="up">上り</option></select></label><label>速度 km/h<input name="speed" type="number" min="1" max="200" step="any" required></label></div><div class="actions"><button type="submit">開始・再スタート</button><button type="button" class="stop secondary">停止</button><a target="_blank" rel="noopener">路線図</a></div>';
        form.querySelector(".name").textContent = `${c.routeId.toUpperCase()} ${c.name}`;
        const state = form.querySelector(".state"); state.textContent = c.enabled ? "走行中" : "停止中"; state.classList.toggle("running", c.enabled);
        if (c.enabled && c.expiresAt) {
            state.dataset.expiresAt = c.expiresAt;
            const deadline = document.createElement("p");
            deadline.textContent = `自動停止：${new Date(c.expiresAt).toLocaleTimeString("ja-JP")}`;
            form.querySelector("h2").after(deadline);
        }
        const kp = form.elements.namedItem("kp"); kp.value = c.startKp; kp.max = c.endKp;
        form.elements.namedItem("direction").value = c.direction;
        form.elements.namedItem("speed").value = c.speedKmh;
        form.querySelector("a").href = `/viewer?route=${encodeURIComponent(c.routeId)}`;
        form.addEventListener("submit", event => { event.preventDefault(); void operate(() => request("PUT", { routeId: c.routeId, enabled: true,
            startKp: Number(kp.value), direction: form.elements.namedItem("direction").value, speedKmh: Number(form.elements.namedItem("speed").value) }), "開始しました。"); });
        form.querySelector(".stop").addEventListener("click", () => void operate(() => request("PUT", { routeId: c.routeId, enabled: false }), "停止しました。"));
        root.appendChild(form);
    }
}
async function operate(action, message) {
    if (busy) return;
    busy = true; document.querySelectorAll("button").forEach(b => { b.disabled = true; }); notice("処理中…");
    try {
        const result = await action(); clockOffset = (result.serverNow || Date.now()) - Date.now(); render(result.configs);
        $("login").hidden = true; $("controls").hidden = false; notice(message);
    } catch (error) { notice(error.message, true); }
    finally { busy = false; document.querySelectorAll("button").forEach(b => { b.disabled = false; }); }
}
function logout() { key = ""; $("key").value = ""; setKeyVisible(false); $("routes").replaceChildren(); $("controls").hidden = true; $("login").hidden = false; }
$("login").addEventListener("submit", event => { event.preventDefault(); key = $("key").value; $("key").value = ""; setKeyVisible(false); void operate(() => request(), "設定を読み込みました。"); });
$("refresh").addEventListener("click", () => void operate(() => request(), "状態を更新しました。"));
$("stop-all").addEventListener("click", () => void operate(() => request("POST", { action: "stopAll" }), "全車停止しました。"));
$("logout").addEventListener("click", () => { if (!busy) { logout(); notice("認証を解除しました。走行状態は変更していません。"); } });
// 状態表示だけを更新する。自動停止のための通信・管理画面の常駐は不要。
setInterval(() => {
    for (const state of document.querySelectorAll(".state[data-expires-at]")) {
        if (Number(state.dataset.expiresAt) <= Date.now() + clockOffset) {
            state.textContent = "自動停止済み"; state.classList.remove("running"); delete state.dataset.expiresAt;
        }
    }
}, 1000);
