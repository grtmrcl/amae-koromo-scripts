/**
 * ローカル開発用スタブAPIサーバー
 *
 * amae-koromo フロントエンドからのリクエストを受け付けるためのスタブ実装。
 * CouchDB不要でポート3000でサーブする。
 *
 * 使い方:
 *   node devServer.js
 */

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const app = express();
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// amae-koromo 開発環境では apiSuffix = "api-test/v2/pl_friend/"
// ルーターを /api-test/ と /api/ の両方にマウントする
const router = express.Router();

// ゲーム一覧 (ListingDataLoader が使用)
// GET /v2/:type/games/:startDate/:endDate
router.get("/v2/:type/games/:startDate/:endDate", (req, res) => {
  res.json([]);
});

// プレイヤー統計 (PlayerDataLoader が使用)
// GET /v2/:type/player_stats/:playerId/:startDate/:endDate
// GET /v2/:type/player_stats/:playerId/:startDate/:endDate/:endDate2
router.get("/v2/:type/player_stats/:playerId/:startDate/:endDate", (req, res) => {
  res.json({
    id: parseInt(req.params.playerId, 10),
    nickname: "テストプレイヤー",
    count: 0,
    played_modes: [],
  });
});

// プレイヤー対局履歴
// GET /v2/:type/player_records/:playerId/:startDate/:endDate
router.get("/v2/:type/player_records/:playerId/:startDate/:endDate", (req, res) => {
  res.json([]);
});

// プレイヤー詳細統計
// GET /v2/:type/player_extended_stats/:playerId/:startDate/:endDate
router.get("/v2/:type/player_extended_stats/:playerId/:startDate/:endDate", (req, res) => {
  res.json({});
});

// プレイヤー検索
// GET /v2/:type/search_player/:keyword
// GET /:type/search_player/:keyword
router.get(["/v2/:type/search_player/:keyword", "/:type/search_player/:keyword"], (req, res) => {
  res.json([]);
});

// ハイライトゲーム
// GET /v2/:type/recent_highlight_games
router.get("/v2/:type/recent_highlight_games", (req, res) => {
  res.json([]);
});

// グローバル統計
// GET /v2/:type/global_statistics_2
router.get("/v2/:type/global_statistics_2", (req, res) => {
  res.json({});
});

// ランク別着席率
// GET /v2/:type/rank_rate_by_seat
router.get("/v2/:type/rank_rate_by_seat", (req, res) => {
  res.json([]);
});

// 役統計
// GET /v2/:type/fan_stats
router.get("/v2/:type/fan_stats", (req, res) => {
  res.json([]);
});

// グローバルヒストグラム
// GET /v2/:type/global_histogram
router.get("/v2/:type/global_histogram", (req, res) => {
  res.json({});
});

// レベル統計
// GET /v2/:type/level_statistics
router.get("/v2/:type/level_statistics", (req, res) => {
  res.json([]);
});

// キャリアランキング
// GET /v2/:type/career_ranking/:type/:subView?
router.get("/v2/:type/career_ranking/:rankType/:subView?", (req, res) => {
  res.json([]);
});

// デルタランキング
// GET /v2/:type/player_delta_ranking/:timespan
router.get("/v2/:type/player_delta_ranking/:timespan", (req, res) => {
  res.json({ ranking: [], updated_at: 0 });
});

// POST エンドポイント (FilteredPlayerDataLoader が使用)
// POST /v2/:type/player_stats/:playerId
router.post("/v2/:type/player_stats/:playerId", (req, res) => {
  res.json({
    id: parseInt(req.params.playerId, 10),
    nickname: "テストプレイヤー",
    count: 0,
    played_modes: [],
  });
});

// POST /v2/:type/player_extended_stats/:playerId
router.post("/v2/:type/player_extended_stats/:playerId", (req, res) => {
  res.json({});
});

app.use("/api/", router);
app.use("/api-test/", router);
app.use("/", router);

const port = parseInt(process.env.PORT, 10) || 3000;
const host = process.env.HOST || "0.0.0.0";
app.listen(port, host, () => {
  console.log(`[devServer] ローカル開発用スタブAPIサーバーを起動しました: http://${host}:${port}`);
  console.log(`[devServer] amae-koromo 開発環境からのリクエストを受け付けます`);
});
