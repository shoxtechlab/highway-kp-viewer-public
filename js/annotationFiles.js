const columns = ["id", "routeId", "kpSystemId", "geometryType", "startKp", "endKp", "direction", "type", "name", "description", "primary", "secondary", "createdAt", "expiresAt"];

export function parseAnnotationCsv(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    text = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '"') {
            if (quoted && text[i + 1] === '"') { field += '"'; i++; }
            else if (quoted || field === "") quoted = !quoted;
            else throw new Error("CSVの引用符が不正です。");
        } else if (!quoted && (char === "," || char === "\n" || char === "\r")) {
            row.push(field); field = "";
            if (char !== ",") {
                if (row.some(value => value !== "")) rows.push(row);
                row = [];
                if (char === "\r" && text[i + 1] === "\n") i++;
            }
        } else field += char;
    }
    if (quoted) throw new Error("CSVの引用符が閉じられていません。");
    row.push(field);
    if (row.some(value => value !== "")) rows.push(row);
    const headers = (rows.shift() || []).map(value => value.trim());
    if (!headers.includes("startKp") || !headers.includes("name")) throw new Error("CSVにはstartKpとname列が必要です。");
    if (new Set(headers).size !== headers.length) throw new Error("CSVの列名が重複しています。");
    return rows.map((values, index) => {
        if (values.length !== headers.length) throw new Error(`CSV ${index + 2}行目の列数が一致しません。`);
        const record = Object.fromEntries(headers.map((key, i) => [key, values[i]]));
        if (!record.startKp.trim()) throw new Error(`CSV ${index + 2}行目のstartKpが空です。`);
        record.colors = { primary: record.primary, secondary: record.secondary };
        return record;
    });
}

export function exportAnnotationCsv(records) {
    const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
    return "\uFEFF" + [columns, ...records.map(record => columns.map(key =>
        key === "primary" || key === "secondary" ? record.colors?.[key] : record[key]
    ))].map(row => row.map(quote).join(",")).join("\r\n");
}
