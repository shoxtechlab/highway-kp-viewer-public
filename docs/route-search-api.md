# 路線・KP検索API

公開環境: `https://highway-kp-viewer.pages.dev/api`

すべてJSONを返します。成功レスポンスはブラウザで60秒、共有キャッシュで300秒キャッシュされます。エラー時は `{ "error": "..." }` とHTTPステータスを返します。

## 路線情報

```http
GET /api/route/{routeId}
```

表示用の路線情報と座標収録範囲を返します。高精度な路線GeoJSONそのものは返しません。

## KPから座標

```http
GET /api/position?route=e17&direction=down&kp=100.2
```

| パラメータ | 必須 | 内容 |
| --- | --- | --- |
| `route` | はい | 路線ID |
| `direction` | はい | `up` または `down` |
| `kp` | はい | KP（km） |
| `section` | いいえ | 複合路線の区間ID。指定時の`kp`は区間内KP |

主な返却値は `route`, `section`, `direction`, `directionLabel`, `kp`, `lat`, `lon`, `heading` です。座標収録範囲外はHTTP 422になります。

## 座標から路線・方向・KP

```http
GET /api/nearest?lat=36.10&lon=139.10&heading=25&speed=80&accuracy=12
```

| パラメータ | 必須 | 内容 |
| --- | --- | --- |
| `lat`, `lon` | はい | WGS84緯度・経度 |
| `route` | いいえ | 指定路線内だけを検索。省略時は収録全路線を探索 |
| `heading` | いいえ | 進行方位（0以上360未満） |
| `speed` | いいえ | 速度（m/s、Geolocation API準拠） |
| `accuracy` | いいえ | GPS精度（m） |
| `preferredRoute` | いいえ | 直前の路線。僅差時の安定化に使用 |
| `preferredDirection` | いいえ | 直前の方向（`up` / `down`） |
| `sections` | いいえ | 検索する区間IDのカンマ区切り |

主な返却値:

```json
{
  "route": "e17",
  "routeName": "関越自動車道",
  "section": null,
  "direction": "down",
  "directionLabel": "下り",
  "kp": 100.2,
  "distanceM": 8.4,
  "snappedLat": 36.1,
  "snappedLon": 139.1,
  "roadHeading": 24.1,
  "headingDifference": 0.9,
  "directionMethod": "position-and-heading",
  "routeMethod": "nearest-route",
  "ambiguous": false,
  "alternatives": []
}
```

`direction` は内部値、`directionLabel` は路線設定に応じた「上り・下り」「内回り・外回り」「東行・西行」などの表示名です。`alternatives` には最大4件の別路線候補と、採用候補との距離差 `distanceDifferenceM` が入ります。

方位は停止中や低速時に不安定なため、位置との距離を基本とし、十分な移動がある場合に方向判定を補助します。返却値は測量値や公的な位置証明ではありません。
