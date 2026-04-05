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

  // basicDB からプレイヤー・期間に一致する対局をDB別に取得
  const basicDocsByDb = Object.fromEntries(await Promise.all(
    dbNames.map(async (db) => {
      const docs = await axios
        .post(`${COUCH_BASE}/${db}/_find`, {
          selector: {
            $and: [
              { accounts: { $elemMatch: { account_id: playerId } } },
              { start_time: { $gte: startTimeSec } },
              { start_time: { $lt: endTimeSec } },
            ],
          },
          fields: ["_id", "standard_rule", "accounts", "result"],
          limit: 10000,
        })
        .then((r) => r.data.docs || [])
        .catch((e) => (e.response?.status === 404 ? [] : Promise.reject(e)));
      return [db, docs];
    })
  ));

  const allBasicDocs = Object.values(basicDocsByDb).flat();
  const playedModes = [...new Set(
    allBasicDocs.map((doc) => (doc.standard_rule === 1 ? 1 : 2)).filter((m) => modes.includes(m))
  )];

  // extendedDB を bulk_get で一括取得し局数を合計
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

  if (allBasicDocs.length > 0) {
    // basicDB名 -> extendedDB名のマッピング
    const extendedDbMap = Object.fromEntries(
      Object.entries(FRIEND_DBS).map(([, dbName]) => [dbName, dbName.replace("_basic", "_extended")])
    );

    await Promise.all(
      dbNames.map(async (db) => {
        const docsForDb = basicDocsByDb[db] || [];
        if (docsForDb.length === 0) return;
        const ids = docsForDb.map((doc) => ({ id: `r-${doc._id}` }));
        const extDb = extendedDbMap[db];
        const resp = await axios
          .post(`${COUCH_BASE}/${extDb}/_bulk_get`, { docs: ids })
          .catch((e) => (e.response?.status === 404 ? { data: { results: [] } } : Promise.reject(e)));
        for (const result of resp.data.results || []) {
          const doc = result.docs?.[0]?.ok;
          if (!doc) continue;
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
          }
        }
      })
    );
  }

  return res.json({
    count,
    和牌率: count > 0 ? winCount / count : 0,
    自摸率: winCount > 0 ? tsumoCount / winCount : 0,
    默听率: winCount > 0 ? damatenCount / winCount : 0,
    放铳率: count > 0 ? ronCount / count : 0,
    副露率: count > 0 ? fuuroCount / count : 0,
    立直率: count > 0 ? richiCount / count : 0,
    平均打点: winCount > 0 ? Math.round(winPointSum / winCount) : 0,
    最大连庄: maxRenchan,
    和了巡数: winCount > 0 ? winJunSum / winCount : 0,
    平均铳点: ronCount > 0 ? Math.round(ronPointSum / ronCount) : 0,
    流局率: count > 0 ? ryukyokuCount / count : 0,
    流听率: ryukyokuCount > 0 ? ryukyokuTenpaiCount / ryukyokuCount : 0,
    一发率: richiWinCount > 0 ? ippatsuCount / richiWinCount : 0,
    里宝率: richiWinCount > 0 ? uraCount / richiWinCount : 0,
    被炸率: oyaCount > 0 ? bazoCount / oyaCount : 0,
    平均被炸点数: bazoCount > 0 ? Math.round(bazoPointSum / bazoCount) : 0,
    放铳时立直率: ronCount > 0 ? ronTimeRichiCount / ronCount : 0,
    放铳时副露率: ronCount > 0 ? ronTimeFuuroCount / ronCount : 0,
    立直后放铳率: richiCount > 0 ? richiAfterRonCount / richiCount : 0,
    立直后非瞬间放铳率: richiCount > 0 ? richiAfterRonNonInstantCount / richiCount : 0,
    副露后放铳率: fuuroCount > 0 ? fuuroAfterRonCount / fuuroCount : 0,
    立直后和牌率: richiCount > 0 ? richiWinCount / richiCount : 0,
    副露后和牌率: fuuroCount > 0 ? fuuroWinCount / fuuroCount : 0,
    立直后流局率: richiCount > 0 ? richiRyukyokuCount / richiCount : 0,
    副露后流局率: fuuroCount > 0 ? fuuroRyukyokuCount / fuuroCount : 0,
    放铳至立直: ronToRichiCount,
    放铳至副露: ronToFuuroCount,
    放铳至默听: ronToDamatenCount,
    立直和了: richiWinCount,
    副露和了: fuuroWinCount,
    默听和了: damatenCount,
    立直巡目: richiCount > 0 ? richiJunSum / richiCount : 0,
    立直收支: richiCount > 0 ? Math.round((richiWinPointSum - richiRonPointSum) / richiCount) : 0,
    立直收入: richiWinCount > 0 ? Math.round(richiWinPointSum / richiWinCount) : 0,
    立直支出: richiRonCount > 0 ? Math.round(richiRonPointSum / richiRonCount) : 0,
    先制率: richiCount > 0 ? senteCount / richiCount : 0,
    追立率: richiCount > 0 ? 1 - senteCount / richiCount : 0,
    被追率: richiCount > 0 ? oiRichiCount / richiCount : 0,
    振听立直率: richiCount > 0 ? furitenRichiCount / richiCount : 0,
    立直好型: richiCount > 0 ? goodShapeCount / richiCount : 0,
    立直多面: richiCount > 0 ? multiWaitCount / richiCount : 0,
    立直好型2: richiCount > 0 ? goodShape2Count / richiCount : 0,
    役满: yakumanCount,
    最大累计番数: maxFanCount,
    W立直: wrichiCount,
    打点效率: count > 0 ? Math.round(winCount / count * (winCount > 0 ? winPointSum / winCount : 0)) : 0,
    铳点损失: count > 0 ? Math.round(ronCount / count * (ronCount > 0 ? ronPointSum / ronCount : 0)) : 0,
    净打点效率: count > 0 ? Math.round(winCount / count * (winCount > 0 ? winPointSum / winCount : 0) - ronCount / count * (ronCount > 0 ? ronPointSum / ronCount : 0)) : 0,
    局収支: gameCount > 0 ? Math.round(gameScoreSum / count) : 0,
    平均起手向听: shantenOyaCount + shantenKoCount > 0 ? shantenSum / (shantenOyaCount + shantenKoCount) : 0,
    平均起手向听亲: shantenOyaCount > 0 ? shantenOyaSum / shantenOyaCount : 0,
    平均起手向听子: shantenKoCount > 0 ? shantenKoSum / shantenKoCount : 0,
    account_id: playerId,
    played_modes: playedModes,
  });
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
