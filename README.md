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
| `TARGET_ACCOUNT_IDS` | 取り込み対象のaccount_idをカンマ区切りで指定。全参加者が含まれるゲームのみ登録される。未設定の場合は全ゲームを対象とする | - |

## 主なスクリプト

| スクリプト | 説明 |
|-----------|------|
| `index.js` | メインエントリーポイント（ライブデータ取得・処理） |
| `importPaifu.js` | ローカルの `paifu/*.json` をCouchDBに取り込む |
| `extApi.js` | 外部向けAPIサーバー |
| `logGames.js` | ゲームログの取得 |
| `compactDaemon.js` | CouchDB compact処理デーモン |
| `cacheStatsProcessor.js` | 統計キャッシュ処理 |

## paifu JSONのインポート

`paifu/` ディレクトリに配置した `YYMMDD-<UUID>.json` ファイルをCouchDBに一括取り込みます。

```bash
# paifu/ ディレクトリのJSONをインポート
IMPORT_PAIFU=1 node index.js

# またはスクリプト直接実行
node importPaifu.js

# カスタムディレクトリを指定する場合
PAIFU_DIR=/path/to/paifu node importPaifu.js
```

### 対応するゲームモード

**category === 1（フレンドルーム戦）**

| 条件 | DBサフィックス | 説明 |
|------|--------------|------|
| accounts数=3 | `_friend3` | 三麻フレンドルーム |
| 非標準ルール（accounts数=4） | `_friend_special` | カスタムルールのフレンドルーム |
| 標準ルール（accounts数=4） | `_friend` | 通常フレンドルーム |

標準ルールの定義: `time_fixed=5, time_add=20, dora_count=3, shiduan=1, init_point=25000, fandian=30000, bianjietishi=true, ai_level=1, fanfu=1, guyi_mode=0, open_hand=0`

**category === 2（公式段位戦）**

| mode_id | DBサフィックス | 説明 |
|---------|--------------|------|
| 12, 16 | （なし） | 通常段位戦 |
| 9 | `_gold` | 金の間 |
| 22, 24, 26 | `_sanma` | 三麻 |
| 15, 11, 8 | `_e4` | 四麻段位戦（上位） |
| 25, 23, 21 | `_e3` | 三麻段位戦（上位） |
