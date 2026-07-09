# 遊戯王カードWikiビューア

iPhone Safari / Chrome向けの遊戯王カードWiki用Web/PWAビューアです。収益化はAdSenseではなく、Amazonアソシエイトの関連アイテムリンクに一本化しています。

## 最初に設定すること

`affiliate-config.js` の `amazonAssociateTag` を、自分のAmazonアソシエイトのトラッキングIDに置き換えてください。

```js
window.YUGIOH_CARD_WIKI_VIEWER_CONFIG = {
  siteName: "遊戯王カードWikiビューア",
  siteOwnerName: "遊戯王カードWikiビューア",
  amazonAssociateTag: "your-tag-22"
};
```

未設定のままでもAmazon検索リンクは動きますが、紹介料は発生しません。

## 公開方法

推奨は Cloudflare Pages です。`functions/api/article.js` を同梱しているため、遊戯王カードWiki本文取得用の `/api/article` も一緒に公開できます。

単なる静的ホスティングだけだと、ブラウザのCORS制限で記事取得が失敗しやすくなります。GitHub Pagesなど関数を置けない場所で公開する場合は、別途APIサーバーが必要です。

## ローカル確認

`index.html` を `file://` で直接開くと記事取得APIが使えないため、取得失敗になります。ローカルでは次のようにサーバー経由で開いてください。

```powershell
& "C:\Users\saito\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" .\local-server.mjs
```

表示された `http://127.0.0.1:4173` をブラウザで開きます。

## Amazonアソシエイト運用メモ

- サイト上にアソシエイトであることの表記を置いています。
- 商品価格、在庫、レビュー、画像はこのサイトでは表示しません。
- Amazon検索リンクに `tag=` を付ける方式です。
- 公開時は問い合わせ先と権利対応方針を正式化してください。
- 運用前に最新のAmazonアソシエイト・プログラム運営規約を確認してください。

参考: https://affiliate.amazon.co.jp/help/operating/agreement
