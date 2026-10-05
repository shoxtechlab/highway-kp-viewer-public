/**
 * ラベル位置を決定する
 *
 * required: true  のラベルは必ず表示する
 * required: false のラベルは置けなければ非表示
 *
 * @param {Array} items
 * @param {(item)=>number} getCenterY
 * @param {(item)=>number} getMinY
 * @param {(item)=>number} getMaxY
 * @param {number} minGap
 * @param {(item)=>number} getPriority
 *
 * @returns {{ item:any, y:number }[]}
 */
export function layoutLabels(
    items,
    getCenterY,
    getMinY,
    getMaxY,
    minGap,
    getPriority = () => 0
) {
    const sorted = [...items].sort((a, b) => {
        const ar = a.required ? 1 : 0;
        const br = b.required ? 1 : 0;

        if (br !== ar) return br - ar;

        if (ar && br) {
            return getCenterY(a) - getCenterY(b);
        }

        return getPriority(b) - getPriority(a);
    });

    const placed = [];

    for (const item of sorted) {
        const center = getCenterY(item);
        const min = getMinY(item);
        const max = getMaxY(item);
        const required = item.required ?? false;

        let bestY = null;
        let d = 0;

        while (true) {
            const candidates = required
                ? [center + d]
                : (d === 0
                    ? [center]
                    : [center - d, center + d]);

            for (const y of candidates) {
                if (!required && (y < min || y > max)) continue;

                const collide = placed.some(p =>
                    Math.abs(p.y - y) < minGap
                );

                if (!collide) {
                    bestY = y;
                    break;
                }
            }

            if (bestY !== null) break;

            if (
                !required &&
                d >= Math.min(40, (max - min) / 2)
            ) break;

            d += 4;
        }

        if (bestY !== null) {
            placed.push({ item, y: bestY });
        }
    }

    placed.sort((a, b) => a.y - b.y);

    return placed;
}

export function stackLabels(
    items,
    getCenterY,
    minGap
) {
    const placed = [];

    const sorted = [...items].sort(
        (a, b) => getCenterY(a) - getCenterY(b)
    );

    sorted.forEach(item => {
        let y = getCenterY(item);

        while (
            placed.some(p => Math.abs(p.y - y) < minGap)
        ) {
            y += minGap;
        }

        placed.push({ item, y });
    });

    return placed;
}