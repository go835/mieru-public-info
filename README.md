# みえる公共情報

音声中心の交通・公共情報を、文字で見えるようにする市民参加型MVPです。現在は都営バスの位置情報と、ブラウザ内に保存する現地情報の投稿を扱います。

> このアプリの市民投稿は公式発表ではありません。安全に関わる判断では、交通事業者・自治体などの公式情報を確認してください。

## はじめる

```powershell
npm install
npm run local
```

ブラウザで `http://localhost:8788` を開きます。投稿・確認・お気に入りは、このブラウザだけに保存されます。

## ToeiBus データ

同階層の `ToeiBus` はGTFS-Realtime形式の車両位置データとして読み込みます。地図上の点は車両の位置、選択時には車両ID・路線ID・最終更新時刻を表示します。

現在のファイルは配置時点のスナップショットです。画面は60秒ごとに再読込しますが、公開後に真のリアルタイム表示へ移行するには、データ提供元の更新URLをCloudflare Workersから取得・配信する必要があります。

データ提供者の利用条件・表示義務・再配布可否は、公開前に必ず確認してください。`ToeiBus` のデータ自体には本リポジトリのMITライセンスは適用されません。

## Cloudflare Pages への公開

1. [Cloudflare](https://dash.cloudflare.com/) のアカウントを作成またはログインします。
2. このフォルダで `npm install` を実行します。
3. `npm run deploy -- --project-name=mieru-public-data` を実行します。
4. 初回だけブラウザでCloudflareへのログインを承認します。完了画面に表示される `pages.dev` のURLが公開URLです。

ローカル確認には `npm run local` を使用してください。

## 重要：この版のデータ範囲

このMVPは静的サイトです。投稿とリアクションは各利用者のブラウザ内（LocalStorage）だけに保存されるため、他の利用者へは共有されません。公開デモ、画面検証、ハッカソン発表向けの実装です。

実際に市民投稿を共有する公開サービスへ進めるには、Cloudflare Workers + D1 などで投稿API・認証・不正利用対策・削除／訂正フローを追加してください。正確な位置情報は保存・公開しない設計を維持します。

## 共有版（Cloudflare Workers + D1）

共有APIとデータベースの実装は将来用に同梱していますが、現在の画面はローカル保存モードに固定されています。公開共有を有効にする際は、本人確認・不正利用対策・削除運用を先に整備してください。

1. `Copy-Item wrangler.jsonc.example wrangler.jsonc` を実行します。
2. `npx wrangler d1 create mieru-bus-data` を実行し、表示された `database_id` を `wrangler.jsonc` の該当欄へ貼り付けます。
3. `npx wrangler d1 migrations apply mieru-bus-data --remote` を実行します。
4. `npm run worker:deploy` を実行します。

これ以降は、同じWorker URLを開いた利用者間で投稿と3種類のリアクションが共有されます。匿名の端末識別子で重複操作を抑止していますが、本番運用前にはTurnstile・利用規約・通報と管理画面を追加してください。

## オープンソース

コードは [MIT License](LICENSE) で公開します。参加方法は [CONTRIBUTING.md](CONTRIBUTING.md)、行動規範は [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)、脆弱性の報告方法は [SECURITY.md](SECURITY.md) をご覧ください。
