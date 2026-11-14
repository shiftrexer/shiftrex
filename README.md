# SHIFTREX — 本番基盤（Cloudflare Pages + D1）

**状態：本番用の安全な基盤と主要予約フローを実装済み。ただし Cloudflare 側の初期設定が終わるまでは運用不可。全仕様の完成版ではありません。**

- 会員：`https://shiftrex.pages.dev/`
- 管理者：`https://shiftrex.pages.dev/admin/`
- GitHub：`shiftrexer/shiftrex`
- 他のプロジェクト `shiftrexer/100days` は変更していません。
- フォントは LISTell に合わせた `-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Noto Sans JP', sans-serif`。
- **有料プランの登録や課金を必要とする操作は行わないでください。** Cloudflareの無料枠には上限があります。

## 実装済み

- Cloudflare Pages Functions のAPI（`/api/*`）、D1共有データベース構造
- 管理者のメール／パスワード認証＋メールOTPによる二段階認証（メール送信プロバイダーの無料アカウント設定が必要）
- 安全なセッションCookie（HttpOnly、Secure、SameSite=Lax）、アクセス権限チェック、監査ログの基礎
- LINE Login（OAuth 2.0/OIDC、state/PKCE/nonce検証）＋会員別72時間招待リンク（LINE Developersのチャネル設定が必要）
- 会員登録、チケットメニュー追加、購入・入金登録、入金完了時のチケット自動発行、手動チケット付与
- 予約枠作成（30分単位開始、60分）、公開月設定、即時確定／承認制、会員申請・取下げ、管理者承認・却下・キャンセル
- D1トリガーによるチケット消化と重複時間帯ロック（重複予約の競合をDB側で拒否）
- 会員の連絡先変更申請、管理者の承認／却下
- サーバー未設定時には本番処理を閉じる（fail closed）。デモのlocalStorageによる業務データ保存を廃止

## **本番利用開始に必要な設定（Cloudflareにアクセスできる人が実施）**

### 1. D1を無料枠で作成

Cloudflare `shiftrexer@gmail.com` の **Workers & Pages → D1** からデータベース `shiftrex-db` を作成します。Freeプランのまま進めます。

### 2. SQLを順に適用

D1のコンソールから次のSQLを順番に実行します。

1. `database/001_initial_schema.sql`
2. `database/002_production.sql`

またはWranglerを使う場合は、D1データベースの正しいID/名前を選び、`--remote` を指定して適用します。**本番データベースに初期化用のDROP TABLEや削除コマンドを実行しないでください。**

### 3. PagesのD1 Bindingを設定

**Workers & Pages → shiftrex → Settings → Bindings** で、D1データベースのバインディングを追加します。

- 変数名：`DB`（大文字）
- 対象：`shiftrex-db`
- 環境：Production（必要ならPreviewにも別DB）

バインディング追加後、Cloudflare Pagesプロジェクトを**再デプロイ**します。

### 4. シークレット/環境変数を設定

**Cloudflare Pages → Settings → Variables and Secrets** で設定します。シークレットの値はGitHubに絶対に保存しないでください。

| 変数名 | 内容 |
|---|---|
| `SETUP_TOKEN` | オーナー初回登録時のみ使うランダムな32文字以上の秘密文字列（必須。初回登録後削除推奨） |
| `RESEND_API_KEY` | メール確認コードの送信に使うResendの無料プランAPIキー |
| `AUTH_FROM_EMAIL` | Resendで送信が許可された送信元メールアドレス |
| `LINE_CHANNEL_ID` | LINEログインチャネルのID |
| `LINE_CHANNEL_SECRET` | LINEログインチャネルのシークレット |

**注意：** 現在のメール二段階認証はResendを利用する方式です。Resendで使用可能な送信元ドメインがない場合、この方式ではメールを送れません。サービスの無料枠やドメイン所有の有無次第では、**追加料金なしでこの仕様を有効化できない可能性があります**。その場合はパスワード認証だけに落とさず、無料の代替認証方式を検証してから有効化してください。

### 5. LINE Developersの設定

LINE DevelopersでLINEログインチャネルを用意し、次をコールバックURLとして登録します。

`https://shiftrex.pages.dev/api/auth/line/callback`

### 6. オーナー登録・テスト

`https://shiftrex.pages.dev/admin/` にアクセスします。

- 初回画面で `SETUP_TOKEN`、オーナー名、メールアドレス、14文字以上のパスワードを入力し、登録します。
- メールに届く確認コードでログインします。
- 会員登録し、その会員専用の招待URLを生成します。LINEログインで連携します。
- テスト用データで、購入・入金、チケット、予約・承認の流れを確認します。
- **本物の会員情報を入力するのは、本番接続・認証・プライバシー対策の確認が済んでからです。**

## 現在未実装／制限事項

決定済みの全仕様にはまだ達していません。以下は本番導入前の対応・検証対象です。

- お知らせ配信、Webプッシュ通知とリマインダー、LINE公式アカウント自動送信
- スタッフ招待・詳細権限カスタマイズ、招待リンク再発行の本人確認フロー
- 曜日別営業時間と日付例外に基づく自動枠生成、公開後の既存予約変更
- 休会・退会の期日処理、実施済み・欠席処理、無券予約・チケット処理待ち
- 価格・購入日・対象月の事後変更、売上返金・預かり金・分割処理の一部、購入取消・入金修正
- 個人情報の削除・匿名化、データ保持ポリシー、利用規約やプライバシーポリシー
- 管理者限定の自動／手動バックアップ、全体復元・種類別復元
- 監査ログのフルUI、請求・残高調整の整合性検査、継続的セキュリティ試験
- API一覧には表示件数上限があり、会員数の増加に応じたページネーションが必要

**未設定時はサービス準備中画面を表示し、実会員のデータ登録を許可しません。**

## 開発者向けテスト

- `node --check assets/production.js`
- `node --check 'functions/api/[[path]].js'`
- Node 22+：`node tests/api-smoke.mjs`（SQLiteとメール・LINEの模擬レスポンスによるAPIテスト。外部には接続しません）

`_routes.json` で `/api/*` のみ Pages Functions に送ります。静的ファイルへの通常のアクセスはAPI呼び出しとして計上されません。
