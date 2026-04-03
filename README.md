# amae-koromo-scripts

雀魂のJSONを解析してCouchDBに格納するスクリプト群。

## アーキテクチャ

- **Node.js**: メインアプリケーション
- **CouchDB**: ゲームデータの永続化
- **Redis**: キュー管理（bee-queue / compact処理）

## セットアップ

### Docker（推奨）

```bash
# 環境変数ファイルを作成
cp .env.example .env
# .env を編集して各種認証情報を設定

# env.js を作成
cp env.js.example env.js
# env.js を編集（Dockerでは環境変数から自動読み込み）

# 起動
docker compose up -d
```

### ローカル開発

```bash
npm install
cp env.js.example env.js
# env.js を編集して接続情報を設定
node index.js
```

## 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `COUCHDB_USER` | CouchDBのユーザー名 | `admin` |
| `COUCHDB_PASSWORD` | CouchDBのパスワード | - |
| `COUCHDB_PROTO` | CouchDBのプロトコル | `http` |
| `COUCHDB_SERVER` | CouchDBのホスト:ポート | `couchdb:5984` |
| `COUCHDB_URL` | CouchDBの接続URL | - |
| `REDIS_HOST` | RedisのホストURL | `redis` |
| `REDIS_PASSWORD` | Redisのパスワード | - |
| `PLAYER_SERVERS` | プレイヤーDBサーバーのJSON | - |
| `PORT` | APIサーバーのポート | `3000` |

## 主なスクリプト

| スクリプト | 説明 |
|-----------|------|
| `index.js` | メインエントリーポイント（ライブデータ取得・処理） |
| `extApi.js` | 外部向けAPIサーバー |
| `logGames.js` | ゲームログの取得 |
| `compactDaemon.js` | CouchDB compact処理デーモン |
| `cacheStatsProcessor.js` | 統計キャッシュ処理 |
