// Viewer専用キー。原本に永続IDがあれば優先し、ない場合も名前だけでは識別しない。
// 管理範囲の切り詰め・複合路線のKP変換より先に付与し、元の諸元へ戻れるようにする。
export function withStructureKeys(road) {
    const used = new Map();
    return { ...road, structures: (road.structures || []).map(item => {
        const base = JSON.stringify(item.id != null ? ["id", String(item.id)] : [
            "range", item.section ?? null, item.type, item.name,
            item.down?.start ?? null, item.down?.end ?? null,
            item.up?.start ?? null, item.up?.end ?? null
        ]);
        const occurrence = used.get(base) || 0;
        used.set(base, occurrence + 1);
        return { ...item, structureKey: `${base}:${occurrence}` };
    }) };
}

export function findStructureForElement(road, element) {
    const key = element.dataset.structureKey;
    // あいまいな名前検索へフォールバックすると同名構造物の諸元を誤表示する。
    return key ? (road.structures || []).find(item => item.structureKey === key) : null;
}
