# 地図・航空写真・Street View利用ガイド

最終確認: 2026-09-18

この文書は、Highway KP Viewerの開発・説明・印刷物作成時に迷わないための運用メモです。法的助言ではありません。規約は変更されるため、実際の公開・配布時にはリンク先の最新版を確認してください。

## 結論

本プロジェクトでは、**Google MapsとStreet Viewは、原則としてリンク先での閲覧・位置確認にとどめます。** Googleの画像を保存して素材化したり、Street Viewから情報を読み取って独自データセットを作ったりしません。

印刷物、公式配布資料、再利用可能な画像や地図を作る場合は、用途とライセンスを確認したうえで、**OpenStreetMapまたは地理院地図を優先**します。

## 判断早見表

| やりたいこと | 推奨方法 | 注意点 |
| --- | --- | --- |
| Webページから地点を開く | Google Maps / Street Viewへの通常リンク | 現在の本アプリ方式。Google画像を自サイトへ保存しない |
| Webページ内で地図を見せる | Google公式の埋め込みまたは適切なMaps Platform API | 表示中の帰属表示を隠さない。商用統合はMaps Platformの条件を確認 |
| Street Viewを見て現地状況を確認 | Google上で閲覧する | スクリーンショット保存、画像抽出、画像からのデータ作成は避ける |
| 会議資料・社内説明へGoogle Mapsを掲載 | Googleの印刷ガイドライン内か個別確認 | 帰属表示を画像の近くに残し、大幅な改変をしない |
| 印刷物・配布資料の地図 | OSMまたは地理院地図を優先 | それぞれの出典・ライセンス表示を付ける |
| 航空写真を掲載・配布 | 地理院地図の対象タイルを優先し、個別条件を確認 | 地理院タイルにも第三者権利や個別法令の制約がある |
| 地図から道路線形や施設データを作る | 再利用可能なOSMデータや公的オープンデータを使用 | Google Maps、航空写真、Street Viewからのトレース・抽出はしない |

## Google Maps

GoogleのGeo Guidelinesでは、Google Mapsへのリンクや通常のWeb埋め込みは認められています。Google Mapsのスクリーンショットへ注記を加える場合も、見た目を大幅に変更したり帰属表示を削除したりしてはいけません。

印刷は全面禁止ではなく、非商用・個人利用のほか、ガイドラインに挙げられた書籍・定期刊行物・社内文書等で条件付き利用が示されています。一方、次の用途は避けるべきものとして明記されています。

- 5,000部を超える書籍への掲載や表紙への利用
- 有償配布するナビゲーション資料の中核としての利用
- 商品、パッケージ、ポスター等への利用
- 印刷広告・販促物における主要または創作的な利用

利用できるケースでも、Googleおよび画像中に表示される第三者データ提供者の帰属表示を、画像の近くに読みやすく残す必要があります。

参照: [Google Geo Guidelines](https://about.google/brand-resource-center/products-and-services/geo-guidelines/)

## Street View

Street ViewはGoogle Mapsより制限が強いため、本プロジェクトでは特に保守的に扱います。

Googleの公式ガイドラインでは、以下が禁止事項として示されています。

- Street View画像を印刷物に使用する
- Street Viewをスクリーンショットして埋め込み元から切り離す
- 画像から情報をデジタイズ、トレースしてデータを作る
- アプリケーションで画像を解析して情報を抽出する
- オフライン利用のために画像をダウンロードする
- 複数画像を結合して大きな画像を作る

したがって、KP標識・施設・道路線形などの**公開用データをStreet View画像から転記・生成する運用は採用しません**。確認が必要な場合はGoogle上で閲覧し、記録する値の根拠には道路管理者の資料、現地調査、GPS測定、利用可能なオープンデータ等を使います。

WebでStreet Viewを見せたい場合は、通常リンク、Google公式の埋め込み、または適切なGoogle Maps Platform APIを使います。

参照: [Google Geo Guidelines — Street View](https://about.google/brand-resource-center/products-and-services/geo-guidelines/#street-view)

## 航空写真・衛星画像

Google Mapsの衛星表示は、用途によってGoogle Earthと同様の商用制限が適用されます。特に広告・販促用途への転用、帰属表示の削除、画像を素材として保存・再配布する扱いは避けます。

航空写真から地物や道路線形をトレースして公開データを作る場合も、画像提供元が明示的に許可しているかを確認します。Googleの画像をOSMや本プロジェクトの線形データへ転記しません。

## OpenStreetMapを使う場合

OpenStreetMapのデータはODbLで提供され、コピー・配布・改変が可能ですが、帰属表示とライセンス条件への対応が必要です。

- Webでは `© OpenStreetMap contributors` を表示し、通常は著作権・ライセンスページへリンクする
- 印刷物ではリンクをクリックできないため、`https://www.openstreetmap.org/copyright` のようにURLを明記する
- データベースを改変・公開する場合は、ODbLの継承条件を確認する
- openstreetmap.orgの標準タイルはデータとは別に利用ポリシーがあるため、大量利用や配布用画像の生成では自前レンダリングや適切なタイル提供者を検討する

参照: [OpenStreetMap Copyright and License](https://www.openstreetmap.org/copyright)、[OSMF Licence and Legal FAQ](https://osmfoundation.org/wiki/Licence_and_Legal_FAQ)

## 地理院地図を使う場合

地理院地図は印刷・画像保存機能を公式に提供しており、配布資料への利用例も案内されています。ただし、公開されている全タイルが一律に自由という意味ではありません。

- 国土地理院コンテンツ利用規約に従う
- 出典を明記する
- タイルごとに第三者が権利を持つ情報や、個別法令による制約がないか確認する
- 編集・加工した場合、国土地理院が作成したものと誤認させない
- 大量アクセスやタイルの一括取得を行わない

参照: [地理院地図 利用規約](https://maps.gsi.go.jp/help/termsofuse.html)、[印刷・画像として保存](https://maps.gsi.go.jp/help/intro/kinolist/1-insatu.html)

## 本プロジェクトでの運用ルール

1. アプリの「ストリートビュー」機能はGoogle Mapsへのリンクとして提供する
2. Google Maps / Street Viewの画像ファイルをリポジトリ、R2、配布物へ保存しない
3. Googleの画像を道路線形、KP、施設位置、橋梁・トンネル情報のデータソースにしない
4. 公開データの根拠は、出典を確認できる道路管理者資料、現地調査、GPS測定、OSM等にする
5. 印刷・公式配布ではOSMまたは地理院地図を第一候補とし、用途ごとの帰属表示と利用条件を確認する
6. Googleの地図画像を例外的に利用する場合は、公開前に最新のGeo Guidelinesと対象用途を再確認する

## 表示例

OSMを用いた印刷物では、少なくとも次のような出典表示を地図の近くに置きます。

```text
Map data © OpenStreetMap contributors
https://www.openstreetmap.org/copyright
```

地理院地図は使用したタイル・加工内容に応じ、国土地理院の案内に従った出典を記載します。Googleのコンテンツを利用する場合は、画像内に実際に表示されるGoogleおよび第三者提供者の帰属表示を切り取らず、その画像の近くに保持します。
