const EARTH_RADIUS_M = 6371008.8;

export function matchPositionToRoutes(position, indexes, options = {}) {
    const candidates = ["up", "down"]
        .map(direction => {
            const match = matchPositionToIndex(position, indexes[direction]);
            return match ? { ...match, direction } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.distanceM - b.distanceM);

    if (!candidates.length) return null;

    const best = candidates[0];
    const second = candidates[1];
    // GPS精度による曖昧幅は設けない。距離が完全に同じ場合だけ
    // 共通線形として、画面で選択中の方向を維持する。
    const ambiguous = Boolean(
        second && second.distanceM === best.distanceM
    );

    if (ambiguous && options.preferredDirection) {
        const preferred = candidates.find(
            candidate => candidate.direction === options.preferredDirection
        );
        if (preferred) {
            return { ...preferred, ambiguous, alternatives: candidates };
        }
    }

    return { ...best, ambiguous, alternatives: candidates };
}

export function matchPositionToIndex(position, index) {
    if (!index || index.length < 2) return null;

    let best = null;
    for (let i = 0; i < index.length - 1; i++) {
        const a = index[i];
        const b = index[i + 1];
        const projection = projectToSegment(position, a, b);

        if (!best || projection.distanceM < best.distanceM) {
            const chainageM = a.chainageM
                + (b.chainageM - a.chainageM) * projection.t;
            best = {
                kp: chainageM / 1000,
                chainageM,
                distanceM: projection.distanceM,
                snappedLat: projection.lat,
                snappedLon: projection.lon,
                segmentIndex: i,
                segmentT: projection.t
            };
        }
    }

    return best;
}

function projectToSegment(point, a, b) {
    const referenceLat = (point.lat + a.lat + b.lat) / 3;
    const metersPerDegreeLat = Math.PI * EARTH_RADIUS_M / 180;
    const metersPerDegreeLon = metersPerDegreeLat
        * Math.cos(referenceLat * Math.PI / 180);

    const ax = (a.lon - point.lon) * metersPerDegreeLon;
    const ay = (a.lat - point.lat) * metersPerDegreeLat;
    const bx = (b.lon - point.lon) * metersPerDegreeLon;
    const by = (b.lat - point.lat) * metersPerDegreeLat;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0
        ? clamp(-(ax * dx + ay * dy) / lengthSquared, 0, 1)
        : 0;
    const x = ax + dx * t;
    const y = ay + dy * t;

    return {
        t,
        distanceM: Math.hypot(x, y),
        lon: a.lon + (b.lon - a.lon) * t,
        lat: a.lat + (b.lat - a.lat) * t
    };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
