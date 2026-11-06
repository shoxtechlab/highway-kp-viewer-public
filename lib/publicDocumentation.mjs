// 公開スナップショットへ運用者専用のリンク・内部資料案内を持ち出さない。
// キーをここへ書くための仕組みではない。秘密の値は元のMarkdownにも保存しない。
export function publicDocumentation(source) {
    const cleaned = source.replace(/<!-- private-only:start -->[\s\S]*?<!-- private-only:end -->\s*/g, "");
    if (/<!--\s*private-only:/.test(cleaned)) throw new Error("private-only範囲が閉じられていません。");
    if (/\]\([^)]*(?:private-notes\/|docs-internal\/|\/tools\/demo-cars\/)/.test(cleaned)) {
        throw new Error("公開Markdownに内部資料・管理操作のリンクが残っています。");
    }
    return cleaned;
}
