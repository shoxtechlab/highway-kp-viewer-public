export function parseKpInput(value) {
    const normalized = String(value ?? "")
        .trim()
        .replace(/[０-９]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
        .replace(/[．。]/g, ".")
        .replace(/[＋]/g, "+")
        .replace(/[－−]/g, "-")
        .replace(/\s+/g, "");
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return NaN;
    return Number(normalized);
}
