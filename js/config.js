// =======================
// UIレイアウト定数（固定）
// =======================
export const LAYOUT = {

    width: 800,
    breakpoint: 800,
    marginTop: 50,
    marginBottom: 50,

    centerX: 400,

    roadWidth: 48,
    roadGap: 24,

    labelFontSize: 16,
    scaleFontSize: 12,

    labelWidth: 120,
    labelHeight: 24,
    labelMargin: 30
};


// =======================
// カラーパレット
// =======================
export const COLORS = {

    get canvas() {
        return document.body.classList.contains("dark-theme") ? "#181d1a" : "#ffffff";
    },

    // SVGはテーマ変更時に再描画されるため、現在のbodyテーマを参照できる。
    get road() {
        return document.body.classList.contains("dark-theme") ? "#b8bec2" : "#999";
    },

    bridge: "#ff9800",
    tunnel: "#2196f3",

    labelFill: "#ffffff",
    labelStroke: "#444444",
    leaderLine: "#666666",

    icsaGreen: "#006c2a",
    icsaWhite: "#ffffff",

    sicPurple: "#81007c",

    bridgeLabel: "#fb8a007d",
    tunnelLabel: "#6A1B9A",

    labelText: "#ffffff",
};


// =======================
// UI状態（動的）
// =======================
export const STATE = {

    // スケール制御
    baseScale: 30,
    scale: 30,
    zoom: 1,

    // デバイス状態
    isMobile: false,

    // 選択位置
    selectedKp: null,
    selectedDirection: null,
    selectedStructure: null,

    // 表示対象となる公式KP範囲
    viewStart: 0,
    viewEnd: null,
    // KPを持たない末端未開通区間を固定幅で描く場合のYオフセット。
    terminalUnopenedOffset: 0
};


// =======================
// KP設定
// =======================
export const KP_STEP = 0.05; // km
