/**
 * ローカル開発用APIサーバー
 *
 * amae-koromo フロントエンドからのリクエストを受け付け、CouchDBのデータを返す。
 * extApi.js の代替として、design doc なしで直接 CouchDB へクエリを投げる実装。
 *
 * 使い方:
 *   COUCHDB_SERVER=localhost:5984 node devServer.js
 *   # または env.js の設定を使う場合:
 *   node devServer.js
 */

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const axios = require("axios").default;

const { COUCHDB_USER, COUCHDB_PASSWORD, COUCHDB_PROTO, COUCHDB_SERVER } = require("./env");

const app = express();
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// ホスト上から Docker の CouchDB にアクセスする場合、
// COUCHDB_SERVER=localhost:5984 を環境変数で上書きする
const COUCH_BASE = `${COUCHDB_PROTO}://${COUCHDB_USER}:${COUCHDB_PASSWORD}@${COUCHDB_SERVER}`;

// 友人戦DBのマッピング (modeId -> dbName)
// modeId=1: 標準ルール4人, modeId=2: 非標準ルール4人
const FRIEND_DBS = {
  1: "majsoul_friend_basic",
  2: "majsoul_friend_special_basic",
};
// pl_friend: modes=[1,2], pl_friend3: modes=[3]
const TYPE_MODES = {
  pl_friend: [1, 2],
  pl_friend3: [3],
};

/**
 * CouchDB ドキュメントを amae-koromo の GameRecord 形式に変換する
 */
function docToGameRecord(doc) {
  const modeId = doc.standard_rule === 1 ? 1 : 2;
  const players = (doc.accounts || []).map((account) => {
    const resultPlayer = (doc.result?.players || []).find((p) => p.seat === account.seat);
    return {
      accountId: account.account_id,
      nickname: account.nickname,
      score: resultPlayer ? resultPlayer.total_point : 0,
      gradingScore: resultPlayer ? resultPlayer.grading_score : 0,
    };
  });
  return {
    _id: doc._id,
    modeId,
    uuid: doc.uuid,
    startTime: doc.start_time,
    endTime: doc.end_time,
    players,
  };
}

/**
 * Mango クエリで start_time 範囲のドキュメントを取得する
 */
async function queryGamesByTimeRange(dbName, startTimeSec, endTimeSec, limit, descending) {
  try {
    const resp = await axios.post(`${COUCH_BASE}/${dbName}/_find`, {
      selector: {
        $and: [
          { start_time: { $gte: startTimeSec } },
          { start_time: { $lt: endTimeSec } },
        ],
      },
      sort: [{ start_time: descending ? "desc" : "asc" }],
      limit,
      fields: ["_id", "uuid", "start_time", "end_time", "accounts", "result", "standard_rule", "config"],
    });
    return resp.data.docs || [];
  } catch (e) {
    if (e.response && e.response.status === 404) {
      return [];
    }
    throw e;
  }
}

/**
 * CouchDB に必要なインデックスを作成する（存在する場合はスキップ）
 */
async function ensureIndexes() {
  const dbs = [...new Set(Object.values(FRIEND_DBS))];
  for (const db of dbs) {
    try {
      await axios.post(`${COUCH_BASE}/${db}/_index`, {
        index: { fields: ["start_time"] },
        name: "start_time_idx",
        type: "json",
      });
      await axios.post(`${COUCH_BASE}/${db}/_index`, {
        index: { fields: ["start_time", "accounts"] },
        name: "start_time_accounts_idx",
        type: "json",
      });
    } catch (e) {
      if (e.response?.status !== 404) {
        console.warn(`[devServer] インデックス作成をスキップ (${db}):`, e.response?.data || e.message);
      }
    }
  }
}

const router = express.Router();

// ゲーム一覧取得
// GET /v2/:type/games/:startDate/:endDate?mode=1
router.get("/v2/:type/games/:startDate/:endDate", async (req, res) => {
  const typeConf = TYPE_MODES[req.params.type];
  if (!typeConf) {
    return res.status(404).json({ error: "type_not_found" });
  }

  const mode = req.query.mode ? parseInt(req.query.mode, 10) : null;
  const descending = !!req.query.descending;
  const limit = Math.min(parseInt(req.query.limit || "100", 10), 500);

  const startMs = parseInt(req.params.startDate, 10);
  const endMs = parseInt(req.params.endDate, 10);
  if (isNaN(startMs) || isNaN(endMs)) {
    return res.status(400).json({ error: "invalid_date" });
  }
  const startTimeSec = Math.floor(startMs / 1000);
  const endTimeSec = Math.ceil(endMs / 1000);

  const targetModes = mode ? [mode] : typeConf;
  const dbNames = [...new Set(targetModes.map((m) => FRIEND_DBS[m]).filter(Boolean))];

  const allDocs = (
    await Promise.all(dbNames.map((db) => queryGamesByTimeRange(db, startTimeSec, endTimeSec, limit, descending)))
  ).flat();

  allDocs.sort((a, b) => (descending ? b.start_time - a.start_time : a.start_time - b.start_time));
  const result = allDocs.slice(0, limit).map(docToGameRecord);
  return res.json(result);
});

// プレイヤー統計取得
// GET /v2/:type/player_stats/:playerId/:startDate/:endDate
router.get("/v2/:type/player_stats/:playerId/:startDate/:endDate", async (req, res) => {
  const typeConf = TYPE_MODES[req.params.type];
  if (!typeConf) {
    return res.status(404).json({ error: "type_not_found" });
  }

  const playerId = parseInt(req.params.playerId, 10);
  const modes = req.query.mode
    ? req.query.mode.split(/[,.-]/).map((x) => parseInt(x, 10)).filter((m) => typeConf.includes(m))
    : typeConf;

  let startMs = parseInt(req.params.startDate, 10);
  let endMs = parseInt(req.params.endDate, 10);
  if (startMs > endMs) [startMs, endMs] = [endMs, startMs];
  const startTimeSec = Math.floor(startMs / 1000);
  const endTimeSec = Math.ceil(endMs / 1000);

  const dbNames = [...new Set(modes.map((m) => FRIEND_DBS[m]).filter(Boolean))];
  const allDocs = (
    await Promise.all(
      dbNames.map((db) =>
        axios
          .post(`${COUCH_BASE}/${db}/_find`, {
            selector: {
              $and: [
                { accounts: { $elemMatch: { account_id: playerId } } },
                { start_time: { $gte: startTimeSec } },
                { start_time: { $lt: endTimeSec } },
              ],
            },
            fields: ["_id", "uuid", "start_time", "end_time", "accounts", "result", "standard_rule", "config"],
            limit: 10000,
          })
          .then((r) => r.data.docs || [])
          .catch((e) => (e.response?.status === 404 ? [] : Promise.reject(e)))
      )
    )
  ).flat();

  const nickname = allDocs
    .flatMap((doc) => doc.accounts)
    .find((a) => a.account_id === playerId)?.nickname || "";

  const numPlayers = 4;
  const rankCounts = Array(numPlayers).fill(0);
  const rankScoreSum = Array(numPlayers).fill(0);
  let rankSum = 0;
  let negativeCount = 0;

  for (const doc of allDocs) {
    const players = (doc.result?.players || []).slice().sort((a, b) => b.total_point - a.total_point);
    const myResult = (doc.result?.players || []).find(
      (p) => (doc.accounts || []).find((a) => a.account_id === playerId)?.seat === p.seat
    );
    if (!myResult) continue;
    const rank = players.findIndex((p) => p.seat === myResult.seat);
    if (rank === -1) continue;
    rankCounts[rank]++;
    rankScoreSum[rank] += myResult.total_point;
    rankSum += rank + 1;
    if (myResult.part_point_1 < 0) negativeCount++;
  }

  const count = rankCounts.reduce((s, c) => s + c, 0);
  const rank_rates = rankCounts.map((c) => (count > 0 ? c / count : 0));
  const rank_avg_score = rankCounts.map((c, i) => (c > 0 ? Math.round(rankScoreSum[i] / c) : 0));
  const avg_rank = count > 0 ? rankSum / count : 0;
  const negative_rate = count > 0 ? negativeCount / count : 0;

  return res.json({
    id: playerId,
    nickname,
    count,
    played_modes: [...new Set(allDocs.map((doc) => (doc.standard_rule === 1 ? 1 : 2)).filter((m) => modes.includes(m)))],
    rank_rates,
    rank_avg_score,
    avg_rank,
    negative_rate,
  });
});

// プレイヤー対局履歴
// GET /v2/:type/player_records/:playerId/:startDate/:endDate
router.get("/v2/:type/player_records/:playerId/:startDate/:endDate", async (req, res) => {
  const typeConf = TYPE_MODES[req.params.type];
  if (!typeConf) {
    return res.status(404).json({ error: "type_not_found" });
  }

  const playerId = parseInt(req.params.playerId, 10);
  const descending = !!req.query.descending;
  const limit = Math.min(parseInt(req.query.limit || "100", 10), 500);
  const modes = req.query.mode
    ? req.query.mode.split(/[,.-]/).map((x) => parseInt(x, 10)).filter((m) => typeConf.includes(m))
    : typeConf;

  let startMs = parseInt(req.params.startDate, 10);
  let endMs = parseInt(req.params.endDate, 10);
  if (startMs > endMs) [startMs, endMs] = [endMs, startMs];
  const startTimeSec = Math.floor(startMs / 1000);
  const endTimeSec = Math.ceil(endMs / 1000);

  const dbNames = [...new Set(modes.map((m) => FRIEND_DBS[m]).filter(Boolean))];
  const allDocs = (
    await Promise.all(
      dbNames.map((db) =>
        axios
          .post(`${COUCH_BASE}/${db}/_find`, {
            selector: {
              $and: [
                { accounts: { $elemMatch: { account_id: playerId } } },
                { start_time: { $gte: startTimeSec } },
                { start_time: { $lt: endTimeSec } },
              ],
            },
            sort: [{ start_time: descending ? "desc" : "asc" }],
            limit,
            fields: ["_id", "uuid", "start_time", "end_time", "accounts", "result", "standard_rule", "config"],
          })
          .then((r) => r.data.docs || [])
          .catch((e) => (e.response?.status === 404 ? [] : Promise.reject(e)))
      )
    )
  ).flat();

  allDocs.sort((a, b) => (descending ? b.start_time - a.start_time : a.start_time - b.start_time));
  const result = allDocs.slice(0, limit).map(docToGameRecord);
  return res.json(result);
});

// プレイヤー検索
// GET /v2/:type/search_player/:keyword
// GET /:type/search_player/:keyword
router.get(["/v2/:type/search_player/:keyword", "/:type/search_player/:keyword"], async (req, res) => {
  const keyword = decodeURIComponent(req.params.keyword).trim();
  if (!keyword) {
    return res.json([]);
  }

  const typeConf = TYPE_MODES[req.params.type];
  const dbNames = typeConf
    ? [...new Set(typeConf.map((m) => FRIEND_DBS[m]).filter(Boolean))]
    : Object.values(FRIEND_DBS).filter((v, i, a) => a.indexOf(v) === i);

  const seen = new Map();
  await Promise.all(
    dbNames.map((db) =>
      axios
        .post(`${COUCH_BASE}/${db}/_find`, {
          selector: { accounts: { $elemMatch: { nickname: { $regex: keyword } } } },
          fields: ["accounts", "start_time"],
          limit: 100,
        })
        .then((r) => {
          for (const doc of r.data.docs || []) {
            for (const account of doc.accounts || []) {
              if (account.nickname && account.nickname.includes(keyword)) {
                const key = account.account_id;
                const existing = seen.get(key);
                if (!existing || existing.latest_timestamp < doc.start_time) {
                  seen.set(key, {
                    id: account.account_id,
                    nickname: account.nickname,
                    latest_timestamp: doc.start_time,
                  });
                }
              }
            }
          }
        })
        .catch((e) => (e.response?.status === 404 ? null : Promise.reject(e)))
    )
  );

  const limit = parseInt(req.query.limit || "20", 10);
  const results = [...seen.values()]
    .sort((a, b) => b.latest_timestamp - a.latest_timestamp)
    .slice(0, limit);
  return res.json(results);
});

// プレイヤー詳細統計 (未実装のため空を返す)
router.get("/v2/:type/player_extended_stats/:playerId/:startDate/:endDate", (req, res) => {
  res.json({});
});

// POST: player_stats (FilteredPlayerDataLoader が使用)
router.post("/v2/:type/player_stats/:playerId", (req, res) => {
  res.json({
    id: parseInt(req.params.playerId, 10),
    nickname: "",
    count: 0,
    played_modes: [],
  });
});

// POST: player_extended_stats
router.post("/v2/:type/player_extended_stats/:playerId", (req, res) => {
  res.json({});
});

// ハイライトゲーム
router.get("/v2/:type/recent_highlight_games", (req, res) => res.json([]));
// グローバル統計系（未実装）
router.get("/v2/:type/global_statistics_2", (req, res) => res.json({}));
router.get("/v2/:type/rank_rate_by_seat", (req, res) => res.json([]));
router.get("/v2/:type/fan_stats", (req, res) => res.json([]));
router.get("/v2/:type/global_histogram", (req, res) => res.json({}));
router.get("/v2/:type/level_statistics", (req, res) => res.json([]));
router.get("/v2/:type/career_ranking/:rankType/:subView?", (req, res) => res.json([]));
router.get("/v2/:type/player_delta_ranking/:timespan", (req, res) =>
  res.json({ ranking: [], updated_at: 0 })
);

app.use("/api/", router);
app.use("/api-test/", router);
app.use("/", router);

const port = parseInt(process.env.PORT, 10) || 3000;
const host = process.env.HOST || "0.0.0.0";
app.listen(port, host, async () => {
  console.log(`[devServer] 起動しました: http://${host}:${port}`);
  console.log(`[devServer] CouchDB: ${COUCHDB_PROTO}://${COUCHDB_SERVER}`);
  await ensureIndexes();
  console.log(`[devServer] インデックスを確認しました`);
});
