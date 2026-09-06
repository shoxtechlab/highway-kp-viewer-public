// =======================
// KP geometry utilities
// =======================

export function buildKPIndex(feature) {
    const coords = feature.geometry.coordinates;
  
    // 補正済みKPを優先し、未補正距離はフォールバックとして使う
    const chainageM =
      feature.properties.chainage_m ??
      feature.properties.raw_chainage_m;
  
    if (!Array.isArray(coords) || !Array.isArray(chainageM)) {
      throw new Error("coordinates または chainage_m/raw_chainage_m が存在しません");
    }
  
    if (coords.length !== chainageM.length) {
      throw new Error(
        `coordinates と chainage_m の数が一致しません: coordinates=${coords.length}, chainage_m=${chainageM.length}`
      );
    }
  
    return coords.map((c, i) => ({
      lon: c[0],
      lat: c[1],
      chainageM: chainageM[i],
      kp: chainageM[i] / 1000
    }));
  }
  
  // =======================
  // KP → 座標
  // =======================
export function kpToLatLon(index, targetKP) {
    if (!index || index.length < 2) return null;

    const minKP = index[0].kp;
    const maxKP = index[index.length - 1].kp;
    const KP_EPSILON = 1e-9;

    // 複合路線の通算KPと区間KPを相互変換すると、終端値にごく微小な丸め誤差が生じる。
    // 実データ範囲を広げず、浮動小数点誤差の範囲内だけ正確な始終端へ丸める。
    if (targetKP < minKP - KP_EPSILON || targetKP > maxKP + KP_EPSILON) {
      return null;
    }
    targetKP = Math.max(minKP, Math.min(maxKP, targetKP));
  
    for (let i = 0; i < index.length - 1; i++) {
      const a = index[i];
      const b = index[i + 1];
  
      if (targetKP >= a.kp && targetKP <= b.kp) {
        const t = (targetKP - a.kp) / (b.kp - a.kp);
  
        return {
          lon: a.lon + (b.lon - a.lon) * t,
          lat: a.lat + (b.lat - a.lat) * t,
          kp: targetKP,
          chainageM: targetKP * 1000,
          segmentIndex: i,
          t
        };
      }
    }
  
    return null;
  }
