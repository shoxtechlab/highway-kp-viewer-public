# Highway KP Viewer

高速道路をキロポスト基準で可視化し、指定地点をGoogle Street Viewで開くWebアプリケーションです。

公開サイト: https://highway-kp-viewer.pages.dev/

## Public source snapshot

このリポジトリは公開用ソースコードのスナップショットです。公開サイトのデプロイ元ではなく、自動更新も行いません。

高精度な路線形状と道路施設データは非公開環境およびCloudflare R2で管理しているため、次のファイルは収録していません。

- `data/e*/road.json`
- `data/e*/route.geojson`

公開サイトではCloudflare Pages FunctionsのAPIを通じて必要な情報だけを取得します。

## Build

```powershell
npm run build
```

生成物は `dist/` に出力されます。非公開路線データはビルド対象になりません。

## Data sources

- Map data: © OpenStreetMap contributors (ODbL)
- Individual facility and structure sources are listed in the application.

## License

Copyright (c) 2026 shoxtechlab. All Rights Reserved.

ソースコードは閲覧・参照目的で公開しています。書面による事前の許可なく、利用、複製、改変、再配布、派生物の作成、販売その他の商用利用を行うことはできません。詳細は `LICENSE` を参照してください。

