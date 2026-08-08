# 遊戯王カードWikiビュアー

iPhone Safari / Chrome向けの遊戯王カードWiki用Web/PWAビュアーです。検索、お気に入り、履歴、端末保存、共有に対応しています。

## 公開方法

推奨は Cloudflare Pages です。`functions/api/article.js` を同梱しているため、遊戯王カードWiki本文取得用の `/api/article` も一緒に公開できます。

単なる静的ホスティングだけだと、ブラウザのCORS制限で記事取得が失敗しやすくなります。GitHub Pagesなど関数を置けない場所で公開する場合は、別途APIサーバーが必要です。

## ローカル確認

`index.html` を `file://` で直接開くと記事取得APIが使えないため、取得失敗になります。ローカルでは次のようにサーバー経由で開いてください。

```powershell
& "C:\Users\saito\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" .\local-server.mjs
```

表示された `http://127.0.0.1:4173` をブラウザで開きます。

## 広告運用

現在のソースには広告コードを含めていません。広告サービスを導入する場合は、審査と利用規約に合わせて広告コード、プライバシーポリシー、同意管理を設定してください。
