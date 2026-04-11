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
const { TILE_CATEGORIES, PLAYER_STATES } = require("./ronStats");

const app = express();
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// ホスト上から Docker の CouchDB にアクセスする場合、
// COUCHDB_SERVER=localhost:5984 を環境変数で上書きする
const COUCH_BASE = `${COUCHDB_PROTO}://${COUCHDB_USER}:${COUCHDB_PASSWORD}@${COUCHDB_SERVER}`;

// _bulk_get のチャンクサイズ（大量ドキュメント取得時のタイムアウト回避）
const BULK_GET_CHUNK_SIZE = 200;

/**
 * CouchDB の _bulk_get をチャンク分割して実行し、全 ok ドキュメントを返す
 * @param {string} dbUrl - CouchDB のDB URL
 * @param {{ id: string }[]} ids - 取得するドキュメントIDリスト
 * @returns {Promise<object[]>} - 取得できたドキュメントの配列
 */
async function bulkGetAll(dbUrl, ids) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += BULK_GET_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + BULK_GET_CHUNK_SIZE));
  }
  const chunkResults = await Promise.all(
    chunks.map((chunk) =>
      axios
        .post(`${dbUrl}/_bulk_get`, { docs: chunk })
        .catch((e) => (e.response?.status === 404 ? { data: { results: [] } } : Promise.reject(e)))
        .then((resp) =>
          (resp.data.results || []).flatMap((result) => {
            const doc = result.docs?.[0]?.ok;
            return doc ? [doc] : [];
          })
        )
    )
  );
  return chunkResults.flat();
}

// 友人戦DBのマッピング (modeId -> dbName)
// modeId=1: 標準ルール4人 (suffix: _friend)
// modeId=2: 非標準ルール4人 (suffix: _friend_special)
// modeId=3: 3人打ち (suffix: _friend3)
const FRIEND_DBS = {
  1: "majsoul_friend_basic",
  2: "majsoul_friend_special_basic",
  3: "majsoul_friend3_basic",
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
      score: resultPlayer ? resultPlayer.part_point_1 : 0,
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
 * basicDB: start_time / accounts + start_time
 * extendedDB: start_time / accounts + start_time
 */
async function ensureIndexes() {
  const basicDbs = [...new Set(Object.values(FRIEND_DBS))];
  const extendedDbs = basicDbs.map((db) => db.replace("_basic", "_extended"));
  const indexDefs = [
    { name: "start_time_idx", fields: ["start_time"] },
    { name: "accounts_start_time_idx", fields: ["accounts", "start_time"] },
  ];

  for (const db of [...basicDbs, ...extendedDbs]) {
    for (const { name, fields } of indexDefs) {
      try {
        const resp = await axios.post(`${COUCH_BASE}/${db}/_index`, {
          index: { fields },
          name,
          type: "json",
        });
        if (resp.data.result === "created") {
          console.log(`[devServer] インデックス作成: "${name}" on ${db}`);
        }
      } catch (e) {
        if (e.response?.status !== 404) {
          console.warn(`[devServer] インデックス作成をスキップ (${db}/${name}):`, e.response?.data || e.message);
        }
      }
    }
  }
}

/**
 * ron_stats エンドポイント用のCouchDBセレクタを構築する
 *
 * @param {string} playerIdStr - 対象プレイヤーID（文字列）
 * @param {string|undefined} startDateStr - 開始日時（ミリ秒文字列）、省略時は全期間
 * @param {string|undefined} endDateStr - 終了日時（ミリ秒文字列）、省略時は現在時刻
 * @returns {{ selector: object } | { error: string }}
 */
function buildRonStatsSelector(playerIdStr, startDateStr, endDateStr) {
  const selector = { [`ronStats.${playerIdStr}`]: { $exists: true } };
  if (startDateStr) {
    let startMs = parseInt(startDateStr, 10);
    let endMs = endDateStr ? parseInt(endDateStr, 10) : Date.now();
    if (isNaN(startMs) || isNaN(endMs)) return { error: "invalid_date" };
    if (startMs > endMs) [startMs, endMs] = [endMs, startMs];
    selector.start_time = { $gte: Math.floor(startMs / 1000), $lt: Math.ceil(endMs / 1000) };
  }
  return { selector };
}

/**
 * extendedDB から取得した ronStats ドキュメント群を集計し、出力形式に変換する
 *
 * @param {object[]} extDocs - fields: ["ronStats.{playerIdStr}"] で取得したドキュメント配列
 * @param {string} playerIdStr - 対象プレイヤーID（文字列）
 * @returns {{ [state: string]: { [category: string]: { [junme: string]: number } } }}
 */
const OUTPUT_STATES = ["total", ...PLAYER_STATES];

function buildRonStatsOutput(extDocs, playerIdStr) {
  // state ごとの巡目別集計: totals[state][cat][junme] = { discarded, won }
  const totals = Object.fromEntries(
    OUTPUT_STATES.map((state) => [
      state,
      Object.fromEntries(TILE_CATEGORIES.map((cat) => [cat, {}])),
    ])
  );

  for (const doc of extDocs) {
    const seatStats = doc.ronStats?.[playerIdStr];
    if (!seatStats) continue;
    for (const [junme, junmeData] of Object.entries(seatStats)) {
      for (const state of PLAYER_STATES) {
        if (!junmeData[state]) continue;
        for (const cat of TILE_CATEGORIES) {
          const src = junmeData[state][cat];
          if (!src) continue;
          // 各 state に加算
          if (!totals[state][cat][junme]) {
            totals[state][cat][junme] = { discarded: 0, won: 0 };
          }
          totals[state][cat][junme].discarded += src.discarded;
          totals[state][cat][junme].won += src.won;
          // total にも加算
          if (!totals.total[cat][junme]) {
            totals.total[cat][junme] = { discarded: 0, won: 0 };
          }
          totals.total[cat][junme].discarded += src.discarded;
          totals.total[cat][junme].won += src.won;
        }
      }
    }
  }

  return Object.fromEntries(
    OUTPUT_STATES.map((state) => [
      state,
      Object.fromEntries(
        TILE_CATEGORIES.map((cat) => {
          const junmeMap = totals[state][cat];
          const rates = Object.fromEntries(
            Object.entries(junmeMap).map(([junme, { discarded, won }]) => [
              junme,
              discarded > 0 ? won / discarded : 0,
            ])
          );
          return [cat, rates];
        })
      ),
    ])
  );
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
    const players = (doc.result?.players || []).slice().sort((a, b) => b.part_point_1 - a.part_point_1);
    const myResult = (doc.result?.players || []).find(
      (p) => (doc.accounts || []).find((a) => a.account_id === playerId)?.seat === p.seat
    );
    if (!myResult) continue;
    const rank = players.findIndex((p) => p.seat === myResult.seat);
    if (rank === -1) continue;
    rankCounts[rank]++;
    rankScoreSum[rank] += myResult.part_point_1;
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

// プレイヤー詳細統計
router.get("/v2/:type/player_extended_stats/:playerId/:startDate/:endDate", async (req, res) => {
  const typeConf = TYPE_MODES[req.params.type];
  if (!typeConf) {
    return res.status(404).json({ error: "type_not_found" });
  }

  const playerId = parseInt(req.params.playerId, 10);
  if (isNaN(playerId)) return res.status(400).json({ error: "invalid_player_id" });

  const modes = req.query.mode
    ? req.query.mode.split(/[,.-]/).map((x) => parseInt(x, 10)).filter((m) => typeConf.includes(m))
    : typeConf;

  let startMs = parseInt(req.params.startDate, 10);
  let endMs = parseInt(req.params.endDate, 10);
  if (isNaN(startMs) || isNaN(endMs)) return res.status(400).json({ error: "invalid_date" });
  if (startMs > endMs) [startMs, endMs] = [endMs, startMs];
  const startTimeSec = Math.floor(startMs / 1000);
  const endTimeSec = Math.ceil(endMs / 1000);

  const dbNames = [...new Set(modes.map((m) => FRIEND_DBS[m]).filter(Boolean))];
  const extendedDbMap = Object.fromEntries(
    Object.entries(FRIEND_DBS).map(([, dbName]) => [dbName, dbName.replace("_basic", "_extended")])
  );
  const playerSelector = {
    $and: [
      { accounts: { $elemMatch: { account_id: playerId } } },
      { start_time: { $gte: startTimeSec } },
      { start_time: { $lt: endTimeSec } },
    ],
  };

  // basicDB と extendedDB を並列で取得
  const [basicDocsByDb, extDocsByDb] = await Promise.all([
    Promise.all(
      dbNames.map(async (db) => {
        const docs = await axios
          .post(`${COUCH_BASE}/${db}/_find`, {
            selector: playerSelector,
            fields: ["_id", "standard_rule", "accounts", "result"],
            limit: 10000,
          })
          .then((r) => r.data.docs || [])
          .catch((e) => (e.response?.status === 404 ? [] : Promise.reject(e)));
        return [db, docs];
      })
    ).then(Object.fromEntries),
    Promise.all(
      dbNames.map(async (db) => {
        const extDb = extendedDbMap[db];
        const docs = await axios
          .post(`${COUCH_BASE}/${extDb}/_find`, {
            selector: {
              $and: [
                { accounts: { $elemMatch: { $eq: playerId } } },
                { start_time: { $gte: startTimeSec } },
                { start_time: { $lt: endTimeSec } },
              ],
            },
            limit: 10000,
          })
          .then((r) => r.data.docs || [])
          .catch((e) => (e.response?.status === 404 ? [] : Promise.reject(e)));
        return [db, docs];
      })
    ).then(Object.fromEntries),
  ]);

  const allBasicDocs = Object.values(basicDocsByDb).flat();
  const playedModes = [...new Set(
    allBasicDocs.map((doc) => (doc.standard_rule === 1 ? 1 : 2)).filter((m) => modes.includes(m))
  )];
  const allExtDocs = Object.values(extDocsByDb).flat();

  return res.json(buildExtendedStats(allBasicDocs, allExtDocs, playerId, playedModes));
});

/**
 * プレイヤー詳細統計を計算する純粋関数
 * @param {object[]} allBasicDocs - basicDBから取得した全ドキュメント
 * @param {object[]} allExtDocs - extendedDBから取得した全ドキュメント（全DBフラット）
 * @param {number} playerId - プレイヤーID
 * @param {number[]} playedModes - プレイ済みモードの配列
 * @returns {object} 統計データ
 */
function buildExtendedStats(allBasicDocs, allExtDocs, playerId, playedModes) {
  // extendedDB から取得した全ドキュメント
  let count = 0;
  let winCount = 0;
  let tsumoCount = 0;
  let damatenCount = 0;
  let ronCount = 0;
  let fuuroCount = 0;
  let richiCount = 0;
  let winPointSum = 0;
  let winJunSum = 0;
  let ronPointSum = 0;
  let ryukyokuCount = 0;
  let ryukyokuTenpaiCount = 0;
  let richiWinCount = 0;
  let richiTsumoCount = 0;
  let fuuroWinCount = 0;
  let richiRyukyokuCount = 0;
  let fuuroRyukyokuCount = 0;
  let richiJunSum = 0;
  let richiWinPointSum = 0;
  let richiRonPointSum = 0;
  let richiRonCount = 0;
  let richiAfterRonCount = 0;
  let richiAfterRonNonInstantCount = 0;
  let fuuroAfterRonCount = 0;
  let oyaCount = 0;
  let bazoCount = 0;
  let bazoPointSum = 0;
  let maxRenchan = 0;
  let ippatsuCount = 0;
  let yakumanCount = 0;
  let maxFanCount = 0;
  let wrichiCount = 0;
  let uraCount = 0;
  let ronTimeRichiCount = 0;
  let ronTimeFuuroCount = 0;
  let ronToRichiCount = 0;
  let ronToFuuroCount = 0;
  let ronToDamatenCount = 0;
  let furitenRichiCount = 0;
  let goodShapeCount = 0;
  let multiWaitCount = 0;
  let goodShape2Count = 0;
  let senteCount = 0;
  let oiRichiCount = 0;
  let shantenSum = 0;
  let shantenOyaSum = 0;
  let shantenOyaCount = 0;
  let shantenKoSum = 0;
  let shantenKoCount = 0;
  let gameScoreSum = 0;
  let gameCount = 0;

  // basicDocから対局単位の収支を集計
  for (const doc of allBasicDocs) {
    const mySeat = (doc.accounts || []).find((a) => a.account_id === playerId)?.seat;
    if (mySeat == null) continue;
    const myResult = (doc.result?.players || []).find((p) => p.seat === mySeat);
    if (!myResult || myResult.part_point_1 == null) continue;
    gameScoreSum += myResult.part_point_1 - 25000;
    gameCount++;
  }

  // fan_idに基づく役コード定数
  const FAN_IPPATSU = 30;  // 一発
  const FAN_URA = 33;      // 裏ドラ
  const isYakuman = (id) => (id >= 35 && id <= 50) || (id >= 59 && id <= 64);

  for (const doc of allExtDocs) {
    const seat = doc.accounts?.indexOf(playerId);
    if (seat === -1 || seat == null) continue;
          let currentRenchan = 0;
          for (const kyoku of doc.data || []) {
            const p = kyoku[seat];
            if (!p) continue;
            // 途中流局は集計から除外
            if (p["途中流局"] != null) continue;
            count++;
            const isOya = p["亲"] === true;
            if (isOya) {
              oyaCount++;
              currentRenchan++;
              if (currentRenchan > maxRenchan) maxRenchan = currentRenchan;
              // 被炸: 他プレイヤーの自摸和了で点数8000以上
              for (let s = 0; s < kyoku.length; s++) {
                if (s === seat) continue;
                const other = kyoku[s];
                if (!other || !other["和"] || other["自摸"] !== true) continue;
                const points = other["和"][0];
                if (points >= 8000) {
                  bazoCount++;
                  bazoPointSum += points;
                  break;
                }
              }
            } else {
              currentRenchan = 0;
            }
            const shanten = p["起手向听"];
            if (shanten != null) {
              shantenSum += shanten;
              if (isOya) {
                shantenOyaSum += shanten;
                shantenOyaCount++;
              } else {
                shantenKoSum += shanten;
                shantenKoCount++;
              }
            }
            const hasWin = p["和"] != null;
            const hasRichi = p["立直"] != null;
            const fuuro = p["副露"] || 0;
            if (hasWin) {
              winCount++;
              winPointSum += p["和"][0];
              winJunSum += p["和"][2];
              if (p["自摸"] === true) tsumoCount++;
              if (!hasRichi && !(fuuro >= 1)) damatenCount++;
              const fans = p["和"][1] || [];
              const fanCount = fans.length;
              if (fanCount > maxFanCount) maxFanCount = fanCount;
              if (fans.some(isYakuman)) yakumanCount++;
              if (hasRichi) {
                richiWinCount++;
                richiWinPointSum += p["和"][0];
                if (p["自摸"] === true) richiTsumoCount++;
                if (fans.includes(FAN_IPPATSU)) ippatsuCount++;
                if (fans.includes(FAN_URA)) uraCount++;
              }
              if (fuuro >= 1) fuuroWinCount++;
            }
            if (p["放铳"] != null) {
              ronCount++;
              ronPointSum += p["放铳"];
              if (hasRichi) {
                richiRonCount++;
                richiRonPointSum += p["放铳"];
                ronTimeRichiCount++;
              }
              if (fuuro >= 1) {
                ronTimeFuuroCount++;
                fuuroAfterRonCount++;
              }
              // 放铳相手（和了プレイヤー）の状態を判定
              const winner = kyoku.find((other, s) => s !== seat && other?.["和"] != null);
              if (winner) {
                const winnerHasRichi = winner["立直"] != null;
                const winnerFuuro = winner["副露"] || 0;
                if (winnerHasRichi) ronToRichiCount++;
                else if (winnerFuuro >= 1) ronToFuuroCount++;
                else ronToDamatenCount++;
                // 立直后放铳: 自分が立直していて、自分の立直巡目 <= 相手の和了巡目
                // 立直后非瞬间放铳: 立直打牌の次の巡以降での放銃 (立直巡目+1 <= 和了巡目)
                if (hasRichi) {
                  const winnerHuleJun = winner["和"][2];
                  if (p["立直"] <= winnerHuleJun) richiAfterRonCount++;
                  if (p["立直"] + 1 <= winnerHuleJun) richiAfterRonNonInstantCount++;
                }
              }
            }
            if (fuuro >= 1) fuuroCount++;
            if (hasRichi) {
              richiCount++;
              richiJunSum += p["立直"];
              if (p["振听立直"] === true) furitenRichiCount++;
              if (p["W立直"] === true) wrichiCount++;
              const tingpais = p["立直听牌"];
              if (tingpais && tingpais.length >= 2) {
                goodShapeCount++;
                multiWaitCount++;
              }
              const remainingTiles = p["立直听牌残枚"];
              if (remainingTiles != null && remainingTiles >= 6) goodShape2Count++;
              // 先制立直判定: 局内で最も早く立直した(巡目最小、同巡はseat最小)かどうか
              const myRichiJun = p["立直"];
              let isSente = true;
              for (let s = 0; s < kyoku.length; s++) {
                if (s === seat) continue;
                const other = kyoku[s];
                if (!other || other["立直"] == null) continue;
                const otherJun = other["立直"];
                if (otherJun < myRichiJun || (otherJun === myRichiJun && s < seat)) {
                  isSente = false;
                  break;
                }
              }
              if (isSente) senteCount++;
              // 被追判定: 自分より後に立直した他プレイヤーが存在するか
              const hasOiRichi = kyoku.some((other, s) => {
                if (s === seat || !other || other["立直"] == null) return false;
                const otherJun = other["立直"];
                return otherJun > myRichiJun || (otherJun === myRichiJun && s > seat);
              });
              if (hasOiRichi) oiRichiCount++;
            }
            if (p["流听"] != null) {
              ryukyokuCount++;
              if (p["流听"] === true) {
                ryukyokuTenpaiCount++;
                if (hasRichi) richiRyukyokuCount++;
              }
              if (fuuro >= 1) fuuroRyukyokuCount++;
            }
    } // end for kyoku
  } // end for allExtDocs

  return {
    count,
    win_rate: count > 0 ? winCount / count : 0,
    tsumo_rate: winCount > 0 ? tsumoCount / winCount : 0,
    damaten_rate: winCount > 0 ? damatenCount / winCount : 0,
    deal_in_rate: count > 0 ? ronCount / count : 0,
    call_rate: count > 0 ? fuuroCount / count : 0,
    riichi_rate: count > 0 ? richiCount / count : 0,
    avg_win_point: winCount > 0 ? Math.round(winPointSum / winCount) : 0,
    max_consecutive_dealer: maxRenchan,
    avg_win_turn: winCount > 0 ? winJunSum / winCount : 0,
    avg_deal_in_point: ronCount > 0 ? Math.round(ronPointSum / ronCount) : 0,
    draw_rate: count > 0 ? ryukyokuCount / count : 0,
    draw_tenpai_rate: ryukyokuCount > 0 ? ryukyokuTenpaiCount / ryukyokuCount : 0,
    ippatsu_rate: richiWinCount > 0 ? ippatsuCount / richiWinCount : 0,
    ura_rate: richiWinCount > 0 ? uraCount / richiWinCount : 0,
    bombed_rate: oyaCount > 0 ? bazoCount / oyaCount : 0,
    avg_bombed_point: bazoCount > 0 ? Math.round(bazoPointSum / bazoCount) : 0,
    deal_in_riichi_rate: ronCount > 0 ? ronTimeRichiCount / ronCount : 0,
    deal_in_call_rate: ronCount > 0 ? ronTimeFuuroCount / ronCount : 0,
    riichi_deal_in_rate: richiCount > 0 ? richiAfterRonCount / richiCount : 0,
    riichi_deal_in_non_instant_rate: richiCount > 0 ? richiAfterRonNonInstantCount / richiCount : 0,
    call_deal_in_rate: fuuroCount > 0 ? fuuroAfterRonCount / fuuroCount : 0,
    riichi_win_rate: richiCount > 0 ? richiWinCount / richiCount : 0,
    riichi_tsumo_rate: richiWinCount > 0 ? richiTsumoCount / richiWinCount : 0,
    call_win_rate: fuuroCount > 0 ? fuuroWinCount / fuuroCount : 0,
    riichi_draw_rate: richiCount > 0 ? richiRyukyokuCount / richiCount : 0,
    call_draw_rate: fuuroCount > 0 ? fuuroRyukyokuCount / fuuroCount : 0,
    deal_in_to_riichi: ronToRichiCount,
    deal_in_to_call: ronToFuuroCount,
    deal_in_to_damaten: ronToDamatenCount,
    riichi_win_count: richiWinCount,
    call_win_count: fuuroWinCount,
    damaten_win_count: damatenCount,
    avg_riichi_turn: richiCount > 0 ? richiJunSum / richiCount : 0,
    riichi_point_balance: richiCount > 0 ? Math.round((richiWinPointSum - richiRonPointSum) / richiCount) : 0,
    riichi_win_income: richiWinCount > 0 ? Math.round(richiWinPointSum / richiWinCount) : 0,
    riichi_deal_in_cost: richiRonCount > 0 ? Math.round(richiRonPointSum / richiRonCount) : 0,
    first_riichi_rate: richiCount > 0 ? senteCount / richiCount : 0,
    chasing_riichi_rate: richiCount > 0 ? 1 - senteCount / richiCount : 0,
    chased_riichi_rate: richiCount > 0 ? oiRichiCount / richiCount : 0,
    furiten_riichi_rate: richiCount > 0 ? furitenRichiCount / richiCount : 0,
    riichi_good_shape_rate: richiCount > 0 ? goodShapeCount / richiCount : 0,
    riichi_multiway_rate: richiCount > 0 ? multiWaitCount / richiCount : 0,
    riichi_good_shape_rate2: richiCount > 0 ? goodShape2Count / richiCount : 0,
    yakuman: yakumanCount,
    max_fan_count: maxFanCount,
    w_riichi: wrichiCount,
    win_point_efficiency: count > 0 ? Math.round(winCount / count * (winCount > 0 ? winPointSum / winCount : 0)) : 0,
    deal_in_point_loss: count > 0 ? Math.round(ronCount / count * (ronCount > 0 ? ronPointSum / ronCount : 0)) : 0,
    net_point_efficiency: count > 0 ? Math.round(winCount / count * (winCount > 0 ? winPointSum / winCount : 0) - ronCount / count * (ronCount > 0 ? ronPointSum / ronCount : 0)) : 0,
    game_score_balance: gameCount > 0 ? Math.round(gameScoreSum / count) : 0,
    avg_start_shanten: shantenOyaCount + shantenKoCount > 0 ? shantenSum / (shantenOyaCount + shantenKoCount) : 0,
    avg_start_shanten_dealer: shantenOyaCount > 0 ? shantenOyaSum / shantenOyaCount : 0,
    avg_start_shanten_non_dealer: shantenKoCount > 0 ? shantenKoSum / shantenKoCount : 0,
    account_id: playerId,
    played_modes: playedModes,
  };
}

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

// ron_stats: 牌カテゴリ・状態・巡目別の放銃確率
// GET /v2/:type/ron_stats/:playerId[/:startDate[/:endDate]]
async function handleRonStats(req, res) {
  const typeConf = TYPE_MODES[req.params.type];
  if (!typeConf) {
    return res.status(404).json({ error: "type_not_found" });
  }

  const playerId = parseInt(req.params.playerId, 10);
  if (isNaN(playerId)) return res.status(400).json({ error: "invalid_player_id" });

  const modes = req.query.mode
    ? req.query.mode.split(/[,.-]/).map((x) => parseInt(x, 10)).filter((m) => typeConf.includes(m))
    : typeConf;

  const dbNames = [...new Set(modes.map((m) => FRIEND_DBS[m]).filter(Boolean))];
  const extendedDbMap = Object.fromEntries(
    Object.entries(FRIEND_DBS).map(([, dbName]) => [dbName, dbName.replace("_basic", "_extended")])
  );

  // basicDB を経由せず extendedDB を直接クエリ（buildRonStatsOutput に集計を委譲）
  // fields に "ronStats.{playerId}" を指定することで対象プレイヤーのデータのみ転送し高速化
  const playerIdStr = String(playerId);

  const selectorResult = buildRonStatsSelector(playerIdStr, req.params.startDate, req.params.endDate);
  if (selectorResult.error) return res.status(400).json({ error: selectorResult.error });
  const selector = selectorResult.selector;

  const extDocs = (
    await Promise.all(
      dbNames.map(async (db) => {
        const extDb = extendedDbMap[db];
        return axios
          .post(`${COUCH_BASE}/${extDb}/_find`, {
            selector,
            fields: [`ronStats.${playerIdStr}`],
            limit: 10000,
          })
          .then((r) => r.data.docs || [])
          .catch((e) => (e.response?.status === 404 ? [] : Promise.reject(e)));
      })
    )
  ).flat();

  return res.json(buildRonStatsOutput(extDocs, playerIdStr));
}

router.get("/v2/:type/ron_stats/:playerId/:startDate/:endDate", handleRonStats);
router.get("/v2/:type/ron_stats/:playerId/:startDate", handleRonStats);
router.get("/v2/:type/ron_stats/:playerId", handleRonStats);

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

module.exports = { buildRonStatsOutput, buildRonStatsSelector, buildExtendedStats };

if (require.main === module) {
  const port = parseInt(process.env.PORT, 10) || 3000;
  const host = process.env.HOST || "0.0.0.0";
  app.listen(port, host, async () => {
    console.log(`[devServer] 起動しました: http://${host}:${port}`);
    console.log(`[devServer] CouchDB: ${COUCHDB_PROTO}://${COUCHDB_SERVER}`);
    await ensureIndexes();
    console.log(`[devServer] インデックスを確認しました`);
  });
}
