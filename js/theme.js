const THEME_STORAGE_KEY = "kp-viewer-theme";

const THEME_CONTROLS_HTML = `
    <button id="mobile-menu-toggle" type="button" hidden aria-label="表示設定を開く" aria-expanded="false" aria-controls="mobile-overflow-menu">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>
    </button>
    <div id="mobile-overflow-menu" hidden>
        <button id="mobile-theme-toggle" type="button" aria-pressed="false">
            <svg class="theme-icon theme-icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z"/></svg>
            <svg class="theme-icon theme-icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg>
            <span>ダークモード</span><span class="theme-switch" aria-hidden="true"></span>
        </button>
    </div>
    <button id="theme-toggle" type="button" hidden aria-label="ダークモードに切り替え" title="ダークモードに切り替え">
        <svg class="theme-icon theme-icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z"/></svg>
        <svg class="theme-icon theme-icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg>
    </button>`;

export function initTheme({ onChange } = {}) {
    const topbar = document.getElementById("topbar");
    if (!topbar) return;
    if (!document.getElementById("theme-toggle")) {
        topbar.insertAdjacentHTML("beforeend", THEME_CONTROLS_HTML);
    }

    const themeToggle = document.getElementById("theme-toggle");
    const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
    const mobileOverflowMenu = document.getElementById("mobile-overflow-menu");
    const mobileThemeToggle = document.getElementById("mobile-theme-toggle");
    if (!themeToggle || !mobileMenuToggle || !mobileOverflowMenu || !mobileThemeToggle) return;

    themeToggle.hidden = false;
    mobileMenuToggle.hidden = false;

    const applyTheme = (theme, notify = false) => {
        const isDark = theme === "dark";
        document.body.classList.toggle("dark-theme", isDark);
        document.documentElement.style.colorScheme = isDark ? "dark" : "light";
        themeToggle.setAttribute("aria-pressed", String(isDark));
        themeToggle.setAttribute("aria-label", isDark ? "ライトモードに切り替え" : "ダークモードに切り替え");
        themeToggle.title = themeToggle.getAttribute("aria-label");
        mobileThemeToggle.setAttribute("aria-pressed", String(isDark));
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", isDark ? "#152019" : "#00973a");
        if (notify) onChange?.(theme);
    };

    const closeMobileMenu = () => {
        mobileOverflowMenu.hidden = true;
        mobileMenuToggle.setAttribute("aria-expanded", "false");
        mobileMenuToggle.setAttribute("aria-label", "表示設定を開く");
    };
    const toggleTheme = () => {
        const nextTheme = document.body.classList.contains("dark-theme") ? "light" : "dark";
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        applyTheme(nextTheme, true);
    };

    applyTheme(localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light");
    themeToggle.addEventListener("click", toggleTheme);
    mobileThemeToggle.addEventListener("click", () => {
        toggleTheme();
        closeMobileMenu();
    });
    mobileMenuToggle.addEventListener("click", event => {
        event.stopPropagation();
        const opens = mobileOverflowMenu.hidden;
        mobileOverflowMenu.hidden = !opens;
        mobileMenuToggle.setAttribute("aria-expanded", String(opens));
        mobileMenuToggle.setAttribute("aria-label", opens ? "表示設定を閉じる" : "表示設定を開く");
    });
    mobileOverflowMenu.addEventListener("click", event => event.stopPropagation());
    document.addEventListener("click", closeMobileMenu);
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeMobileMenu();
    });
}
