# データモデルと移行方針

Highway KP Viewerは、既存路線を表示し続けながら、データを段階的に「ネットワーク・区間・KP体系」へ分離しています。この文書では、現在の互換形式と移行時のルールを説明します。

## 1. 現在のデータ構成

ブラウザとAPIが扱う主な生成物は次のとおりです。

- `road.json` — 路線情報、施設、橋梁、トンネル
- `route.geojson` — 上下線の線形と補正済みKP
- `route-scopes.json` — 管理事務所などの表示範囲

路線ごとにKP体系や位置の持ち方が異なるため、ビルド時に`lib/dataCompiler.mjs`が表現を正規化し、ファイル間の参照関係を検証します。既存Viewerは、この処理で生成された従来互換形式を引き続き読み込みます。

## 2. 位置の内部表現

KP位置は内部で「区間」と「その区間のKP」の組として扱います。

```json
{
  "section": "joban",
  "kp": 69.1
}
```

単一路線では`section`は`null`です。複数のKP体系を持つ路線では、`section`によって同じ数値のKPを区別します。この形に統一することで、通算位置、路線KP、将来の南北別などの特殊KPを、画面側へ個別実装せず扱えるようにします。

KPと座標を相互変換する処理は、[KP・座標変換アルゴリズム](kp-coordinate-algorithms.md)を参照してください。

## 3. 管理範囲の参照

管理事務所などの表示範囲は、施設名やKPを直接複製せず、安定した施設IDで参照します。

- `data/facility-registry.json` — 境界に使う施設のID、名称、区間、KP
- `data/scope-definitions.json` — 始点・終点となる施設ID

ビルド時に両者を解決して、従来互換の`route-scopes.json`を生成します。施設名やKPを変更するときは登録元を1か所直せばよく、表示範囲との不整合を防げます。

## 4. 路線データの分割

移行済み路線では、編集元を`data-source/<route>/`へ分割します。

```text
data-source/e4/
├─ metadata.json    路線ID、名称、データ状態
├─ network.json     路線長、区間、端点
├─ facilities.json  IC、JCT、SA・PA
└─ structures.json 橋梁、トンネル
```

ビルド、ローカルAPI、R2同期では、これらを既存の`road.json`形式へコンパイルします。未移行路線は従来の`data/<route>/road.json`を正として扱うため、一斉移行を必要としません。

## 5. 移行時のルール

新しい分割元が一部だけ存在する状態は許可しません。`data-source/<route>/`を作成した路線では4ファイルをすべて必須とし、不足があればビルドを停止します。

```powershell
npm run migrate:road-source -- e17
npm run validate:data
npm run build
```

移行コマンドは、既存の分割元を上書きしません。移行直後には分割データを再コンパイルし、従来の`road.json`と意味的に一致することを確認します。移行期間中の旧ファイルは互換性確認用として残しますが、生成物は分割元から作成します。

## 6. 公開範囲

公開リポジトリには、このデータモデルとAPIインターフェースを理解するための資料を収録します。高精度な路線線形、KP補正点、OSMの中間生成物、路線別の加工設定は公開しません。

OSM由来データの扱いは、[OpenStreetMap由来の路線データについて](osm-derived-route-data.md)を参照してください。
