const EARTH_RADIUS_M = 6371008.8;

export function matchPositionToRoutes(position, indexes, options = {}) {
    const candidates = ["up", "down"]
        .map(direction => {
            const match = matchPositionToIndex(position, indexes[direction], direction);
            return match ? { ...match, direction } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.distanceM - b.distanceM);

    if (!candidates.length) return null;

    const positionBest = candidates[0];
    const numericHeading = options.heading == null ? null : Number(options.heading);
    const numericSpeed = options.speed == null ? null : Number(options.speed);
    const headingUsable = Number.isFinite(numericHeading)
        && (numericSpeed == null || numericSpeed >= 2);
    let best = positionBest;

    // 方位は、位置だけで十分近い上下線候補の選択にだけ使う。
    // これにより、向きが一致する遠方の道路を誤選択しない。
    let headingCandidates = [];
    if (headingUsable) {
        headingCandidates = candidates.filter(
            candidate => candidate.distanceM <= positionBest.distanceM + 30
        )
            .map(candidate => ({
                ...candidate,
                headingDifference: angularDifference(numericHeading, candidate.roadHeading)
            }))
            .sort((a, b) =>
                a.headingDifference - b.headingDifference
                || a.distanceM - b.distanceM
            );
        best = headingCandidates[0];
    }
    const second = candidates[1];
    // GPS精度による曖昧幅は設けない。距離が完全に同じ場合だけ
    // 共通線形として、画面で選択中の方向を維持する。
    const ambiguous = headingUsable
        ? Boolean(
            headingCandidates[1]
            && headingCandidates[1].headingDifference === best.headingDifference
            && headingCandidates[1].distanceM === best.distanceM
        )
        : Boolean(second && second.distanceM === positionBest.distanceM);

    if (!headingUsable && ambiguous && options.preferredDirection) {
        const preferred = candidates.find(
            candidate => candidate.direction === options.preferredDirection
        );
        if (preferred) {
            return {
                ...preferred,
                ambiguous,
                directionMethod: "previous-selection",
                alternatives: candidates
            };
        }
    }

    return {
        ...best,
        ambiguous,
        directionMethod: headingUsable ? "position-and-heading" : "position-only",
        alternatives: candidates
    };
}

export function matchPositionToIndex(position, index, direction = "down") {
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
                roadHeading: segmentHeading(a, b, direction === "up"),
                segmentIndex: i,
                segmentT: projection.t
            };
        }
    }

    return best;
}

function segmentHeading(a, b, reverse) {
    const from = reverse ? b : a;
    const to = reverse ? a : b;
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = to.lat * Math.PI / 180;
    const deltaLon = (to.lon - from.lon) * Math.PI / 180;
    const y = Math.sin(deltaLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2)
        - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function angularDifference(a, b) {
    const difference = Math.abs(((a - b + 540) % 360) - 180);
    return difference;
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
