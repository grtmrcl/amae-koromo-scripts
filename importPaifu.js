"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const _ = require("lodash");

const { CouchStorage, MODE_GAME } = require("./couchStorage");
const { calcShanten } = require("./shanten");
const { MajsoulGameAnalyzer } = require("./gameAnalyzer");
const { RonStatsCollector, RonStatsAccumulator } = require("./ronStats");

CouchStorage.DEFAULT_MODE = MODE_GAME;

const PAIFU_DIR = process.env.PAIFU_DIR || path.join(__dirname, "paifu");
const PAIFU_EXCLUDE_DIR = process.env.PAIFU_EXCLUDE_DIR || path.join(__dirname, "paifu_exclude");

// TARGET_ACCOUNT_IDS が設定されている場合、全参加者がその中に含まれるゲームのみ登録する
const TARGET_ACCOUNT_IDS = process.env.TARGET_ACCOUNT_IDS
  ? new Set(process.env.TARGET_ACCOUNT_IDS.split(",").map((id) => Number(id.trim())))
  : null;

function isTargetGame(gameData) {
  if (!TARGET_ACCOUNT_IDS) return true;
  return gameData.accounts.every((account) => TARGET_ACCOUNT_IDS.has(account.account_id));
}

// fan ID 定数
const FAN_ID_URA = 33;    // 裏ドラ
const FAN_ID_TSUMO = 29;  // 門前清自摸和
const FAN_ID_PINFU = 3;   // 平和

/**
 * 有効裏ドラ枚数を計算する。
 * 立直和了に対し、点数が上昇する区切りに寄与する裏ドラの枚数を返す。
 * 呼び出し元で立直和了（liqi === true）を確認してから呼ぶこと。
 *
 * @param {number[]} fanIds - 和了役IDの配列（id を val 枚展開済み）
 * @param {number} fu - 符
 * @returns {number} 有効裏ドラ枚数
 */
function calcEffectiveUraDora(fanIds, fu) {
  const uraCount = fanIds.filter((id) => id === FAN_ID_URA).length;
  if (uraCount === 0) return 0;

  const baseFans = fanIds.length - uraCount;
  const totalFans = fanIds.length;

  // 条件2: 合計fans が 3 以下のとき、裏ドラ全て有効
  if (totalFans <= 3) return uraCount;

  // 条件3: fu < 60 のとき fans が 4 以下に上がる全裏ドラ
  // 条件3': fu >= 60 のとき fans が 3 以下に上がる全裏ドラ
  // 条件4: 役にツモと平和があるとき、fans が 5 以下に上がる裏ドラ
  const hasTsumo = fanIds.includes(FAN_ID_TSUMO);
  const hasPinfu = fanIds.includes(FAN_ID_PINFU);
  let extraEffective = 0;

  if (fu < 60 && baseFans < 4) {
    // fans が 4 以下に上がる全裏ドラ
    extraEffective = Math.min(uraCount, 4 - baseFans);
  } else if (fu >= 60 && baseFans < 3) {
    // fans が 3 以下に上がる全裏ドラ
    extraEffective = Math.min(uraCount, 3 - baseFans);
  }

  if (hasTsumo && hasPinfu && baseFans < 5) {
    // fans が 5 以下に上がる裏ドラ
    const neededFor5 = Math.min(uraCount, 5 - baseFans);
    extraEffective = Math.max(extraEffective, neededFor5);
  }

  // 条件1: 裏ドラ除外fansが5以下/7/10/12のとき、裏ドラを加えると6/8/11/13に達する裏ドラ
  // 到達できる最大の点数区切り閾値までに必要な枚数を有効とする
  const THRESHOLDS = [6, 8, 11, 13];
  const reachableThresholds = THRESHOLDS.filter((t) => t > baseFans && t <= totalFans);
  let condition1Effective = 0;
  if (reachableThresholds.length > 0) {
    const maxT = reachableThresholds[reachableThresholds.length - 1];
    condition1Effective = Math.min(uraCount, maxT - baseFans);
  }

  return Math.max(condition1Effective, extraEffective);
}

/**
 * ドラ表示牌からドラ牌を返す。
 * 牌表記: 数字 + スート (m/p/s/z)。0 は赤五牌 (5 扱い)。
 * 数牌: 9 の次は 1。字牌: 風牌 (1z-4z) は 4 の次 1、三元牌 (5z-7z) は 7 の次 5。
 *
 * @param {string} indicatedTile - ドラ表示牌 (例: "5s", "4z")
 * @returns {string} ドラ牌 (例: "6s", "1z")
 */
function indicatedToActualDora(indicatedTile) {
  const suit = indicatedTile[indicatedTile.length - 1];
  let num = parseInt(indicatedTile[0], 10);
  if (num === 0) num = 5; // 赤牌は5扱い
  if (suit === "z") {
    if (num <= 4) {
      num = num === 4 ? 1 : num + 1;
    } else {
      num = num === 7 ? 5 : num + 1;
    }
  } else {
    num = num === 9 ? 1 : num + 1;
  }
  return `${num}${suit}`;
}

/**
 * 配牌にドラが何枚含まれるかを返す。
 * ドラ表示牌リストから実際のドラ牌セットを求め、手牌と照合する。
 * 赤牌 (0m/0p/0s) は対応する5牌 (5m/5p/5s) と同じドラ判定をする。
 * 例: ドラ表示牌4sのとき、手牌に5sと0sと5sがあれば3枚とカウントする。
 *
 * @param {string[]} tiles - 手牌
 * @param {string[]} doraIndicators - ドラ表示牌リスト
 * @returns {number} 手牌中のドラ枚数
 */
function countHaipaiDora(tiles, doraIndicators) {
  const doraSet = doraIndicators.map(indicatedToActualDora);
  let count = 0;
  for (const tile of tiles) {
    const normalized = tile[0] === "0" ? `5${tile[1]}` : tile;
    if (doraSet.includes(normalized)) count++;
  }
  return count;
}

// paifu/*.json の data フィールド（デコード済みJSON）からラウンドデータを生成する
// index.js の buildRecordData に相当するが、Protobuf バイナリではなく JSON オブジェクトを受け取る
function buildRecordDataFromJson({ data, game }) {
  // data = { name: ".lq.GameDetailRecords", data: { version?, records?, actions? } }
  const payload = data.data;

  const records = [];
  if (payload.version >= 210715) {
    // 新形式: actions 配列から result を取り出す
    for (const action of payload.actions || []) {
      if (!action.result || typeof action.result !== "object") {
        continue;
      }
      records.push(action.result);
    }
  } else {
    // 旧形式: records 配列を直接使用
    for (const record of payload.records || []) {
      records.push(record);
    }
  }

  if (!records.length) {
    console.error(`No records found: ${game.uuid}`);
    return null;
  }

  const rounds = [];
  const ronStatsCollectors = [];
  let 振听 = null;
  let numDiscarded = null;
  let lastDiscardSeat = null;
  let lastDiscardTile = null;
  let analyzer = null;

  for (const item of records) {
    // item = { name: ".lq.RecordXxx", data: { ... } }
    const itemName = item.name;
    const itemPayload = item.data;

    if (itemName !== ".lq.RecordNewRound") {
      // RecordNewRound より前に出現するレコード（RecordNewCard 等）は analyzer 未初期化のためスキップ
      if (!analyzer) continue;
      try {
        analyzer.processRecord(itemName, itemPayload);
      } catch (e) {
        console.log(game.uuid, item);
        console.error(e);
        return null;
      }
    }

    if (itemName === ".lq.RecordDealTile") {
      continue;
    }

    if (itemName === ".lq.RecordNewRound") {
      try {
        analyzer = new MajsoulGameAnalyzer(itemPayload);
      } catch (e) {
        console.error(e);
        return null;
      }
      assert([3, 4].includes(itemPayload.scores.length));
      rounds.push(
        [0, 1, 2, 3].slice(0, itemPayload.scores.length).map((seat) => ({
          ...(itemPayload[`tiles${seat}`].length === 14
            ? {
                亲: true,
                牌山: itemPayload.paishan,
              }
            : {}),
          手牌: itemPayload[`tiles${seat}`],
          起手向听: calcShanten(itemPayload[`tiles${seat}`]),
          手牌ドラ枚数: countHaipaiDora(itemPayload[`tiles${seat}`], itemPayload.doras || []),
        }))
      );
      振听 = Array(rounds[rounds.length - 1].length).fill(false);
      numDiscarded = 0;
      lastDiscardSeat = null;
      lastDiscardTile = null;
      ronStatsCollectors.push(new RonStatsCollector(rounds[rounds.length - 1].length));
      assert(rounds[rounds.length - 1].filter((x) => x.亲).length === 1);
      assert([3, 4].includes(rounds[rounds.length - 1].length));
      continue;
    }

    const curRound = rounds[rounds.length - 1];
    assert(curRound);
    const numPlayers = curRound.length;
    assert([3, 4].includes(numPlayers));

    switch (itemName) {
      case ".lq.RecordChiPengGang":
        assert(typeof itemPayload.seat === "number");
        curRound[itemPayload.seat].副露 = (curRound[itemPayload.seat].副露 || 0) + 1;
        break;
      case ".lq.RecordDiscardTile":
        assert(typeof itemPayload.seat === "number");
        lastDiscardSeat = itemPayload.seat;
        lastDiscardTile = itemPayload.tile;
        振听 = itemPayload.zhenting;
        if (!curRound[itemPayload.seat].立直 && (itemPayload.is_liqi || itemPayload.is_wliqi)) {
          curRound[itemPayload.seat].立直 = numDiscarded / numPlayers + 1;
          if (振听[itemPayload.seat]) {
            curRound[itemPayload.seat].振听立直 = true;
          }
          if (itemPayload.tingpais && itemPayload.tingpais.length) {
            curRound[itemPayload.seat].立直听牌 = itemPayload.tingpais.map((x) => x.tile);
            curRound[itemPayload.seat].立直听牌残枚 = analyzer.getRemainingNumTiles(
              itemPayload.seat,
              itemPayload.tingpais.map((x) => x.tile)
            );
          }
        }
        if (itemPayload.is_wliqi) {
          curRound[itemPayload.seat].W立直 = true;
        }
        {
          const discardJunme = numDiscarded / numPlayers + 1;
          ronStatsCollectors[ronStatsCollectors.length - 1].recordDiscard(
            itemPayload.seat,
            itemPayload.tile,
            discardJunme,
            curRound
          );
        }
        numDiscarded++;
        break;
      case ".lq.RecordNoTile":
        if (itemPayload.liujumanguan) {
          itemPayload.scores.forEach((x) => {
            assert(typeof x.seat === "number");
            return (curRound[x.seat].流满 = true);
          });
        }
        itemPayload.players.forEach((x, seat) => {
          curRound[seat].流听 = x.tingpai;
        });
        break;
      case ".lq.RecordHule":
        itemPayload.hules.forEach((x) => {
          assert(typeof x.seat === "number");
          const fanIds = _.flatten(x.fans.map((f) => Array(f.val).fill(f.id)));
          curRound[x.seat].和 = [
            itemPayload.delta_scores[x.seat] - (x.liqi ? 1000 : 0),
            fanIds,
            numDiscarded / numPlayers + 1,
          ];
          if (x.liqi) {
            curRound[x.seat].有効裏ドラ = calcEffectiveUraDora(fanIds, x.fu);
          }
          if (!x.zimo && curRound[x.seat].和[0] < Math.max(0, x.point_rong - 1500)) {
            assert(itemPayload.hules.length >= 2);
            const info = itemPayload.hules.filter((other) => other.yiman && other.seat !== x.seat)[0];
            assert(info);
            curRound[x.seat].和[0] += info.point_rong / 2;
            curRound[x.seat].包牌 = info.point_rong / 2;
          }
          const numLosingPlayers = itemPayload.delta_scores.filter((x) => x < 0).length;
          if (x.zimo) {
            assert(typeof x.seat === "number");
            assert(itemPayload.hules.length === 1);
            assert(numLosingPlayers === numPlayers - 1 || itemPayload.hules[0].yiman);
            curRound[x.seat].自摸 = true;
            if (振听[x.seat]) {
              curRound[x.seat].振听自摸 = true;
            }
            if (numLosingPlayers === 1) {
              itemPayload.delta_scores.forEach((score, seat) => {
                assert(typeof seat === "number");
                if (score < 0) {
                  curRound[seat].包牌 = Math.abs(score);
                }
              });
            }
          } else {
            assert([1, 2].includes(numLosingPlayers));
            itemPayload.delta_scores.forEach((score, seat) => {
              assert(typeof seat === "number");
              if (score < 0) {
                if (numLosingPlayers === 1) {
                  assert(seat === lastDiscardSeat);
                } else {
                  assert(itemPayload.hules.some((x) => x.yiman));
                }
                curRound[seat][seat === lastDiscardSeat ? "放铳" : "包牌"] = Math.abs(score);
                if (seat === lastDiscardSeat && numLosingPlayers === 1 && lastDiscardTile) {
                  const ronJunme = (numDiscarded - 1) / numPlayers + 1;
                  ronStatsCollectors[ronStatsCollectors.length - 1].recordRon(
                    x.seat,
                    lastDiscardTile,
                    ronJunme,
                    curRound
                  );
                }
              }
            });
          }
        });
        break;
      case ".lq.RecordBaBei":
      case ".lq.RecordAnGangAddGang":
        assert(typeof itemPayload.seat === "number");
        lastDiscardSeat = itemPayload.seat;
        break;
      case ".lq.RecordLiuJu":
        curRound.forEach((x) => (x.途中流局 = itemPayload.type));
        break;
      default:
        console.log(game.uuid, itemName, itemPayload);
        assert(false, `Unknown record type: ${itemName}`);
    }
  }

  return { rounds, ronStatsCollectors };
}

async function withRetry(func, num = 20, retryInterval = 30000) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await func();
    } catch (e) {
      if (num <= 0 || e.status === 403 || e.noRetry) {
        throw e;
      }
      console.log(e);
      console.log(`Retrying (${num})`);
      await new Promise((r) => setTimeout(r, Math.random() * retryInterval));
    }
    num--;
  }
}

const STANDARD_DETAIL_RULE = {
  time_fixed: 5,
  time_add: 20,
  dora_count: 3,
  shiduan: 1,
  init_point: 25000,
  fandian: 30000,
  bianjietishi: true,
  ai_level: 1,
  fanfu: 1,
  guyi_mode: 0,
  open_hand: 0,
};

function isStandardDetailRule(detailRule) {
  if (!detailRule) return false;
  return Object.keys(STANDARD_DETAIL_RULE).every(
    (k) => JSON.stringify(detailRule[k]) === JSON.stringify(STANDARD_DETAIL_RULE[k])
  );
}

function getStoreForFriend(groups, gameData) {
  if (gameData.accounts.length === 3) {
    return groups.friend3.store;
  }
  if (!gameData.standard_rule) {
    return groups.friendSpecial.store;
  }
  return groups.friend.store;
}

async function importPaifu({ targetFiles = null } = {}) {
  const groups = {
    friend: { store: new CouchStorage({ suffix: "_friend", skipSetup: false }) },
    friend3: { store: new CouchStorage({ suffix: "_friend3", skipSetup: false }) },
    friendSpecial: { store: new CouchStorage({ suffix: "_friend_special", skipSetup: false }) },
  };

  if (process.env.RESET_DB === "1") {
    console.log("RESET_DB is set. Destroying and recreating databases...");
    const groupSuffixes = { friend: "_friend", friend3: "_friend3", friendSpecial: "_friend_special" };
    for (const [key, suffix] of Object.entries(groupSuffixes)) {
      await groups[key].store.destroyDatabases();
      groups[key].store = new CouchStorage({ suffix, skipSetup: false });
    }
    console.log("Databases destroyed and recreated.");
  }

  // インデックスを作成（初回・RESET_DB後いずれも実行）
  console.log("Ensuring CouchDB indexes...");
  for (const store of Object.values(groups).map((g) => g.store)) {
    await store.ensureIndexes();
  }
  console.log("CouchDB indexes ensured.");

  fs.mkdirSync(PAIFU_EXCLUDE_DIR, { recursive: true });

  const files = targetFiles
    ? targetFiles.map((f) => (f.endsWith(".json") ? f : `${f}.json`))
    : fs.readdirSync(PAIFU_DIR).filter((f) => /^\d{6}-.*\.json$/.test(f));
  console.log(`Found ${files.length} paifu files in ${PAIFU_DIR}`);

  const allStores = Object.values(groups).map((g) => g.store);

  for (const file of files) {
    const filePath = path.join(PAIFU_DIR, file);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, { encoding: "utf-8" }));
    } catch (e) {
      if (e.code === "ENOENT") {
        console.error(`File not found: ${file}`);
      } else {
        console.error(`Failed to parse ${file}:`, e);
      }
      continue;
    }

    const gameData = parsed.head;
    const recordData = parsed.data;

    if (!gameData || !recordData) {
      console.log(`Skipping ${file}: missing head or data`);
      continue;
    }

    // 全参加者が TARGET_ACCOUNT_IDS に含まれないゲームはスキップ
    if (!isTargetGame(gameData)) {
      if (!targetFiles) {
        try {
          fs.renameSync(filePath, path.join(PAIFU_EXCLUDE_DIR, file));
          console.log(`Excluded (not target account): ${file}`);
        } catch (e) {
          console.error(`Failed to move ${file} to exclude dir:`, e);
        }
      }
      continue;
    }

    // category === 1（フレンドルーム戦）のみ取り込み対象
    const category = gameData.config.category;
    if (category !== 1) {
      if (!targetFiles) {
        try {
          fs.renameSync(filePath, path.join(PAIFU_EXCLUDE_DIR, file));
          console.log(`Excluded (category=${category}): ${file}`);
        } catch (e) {
          console.error(`Failed to move ${file} to exclude dir:`, e);
        }
      }
      continue;
    }

    const itemStore = getStoreForFriend(groups, gameData);

    const uuid = gameData.uuid;

    // すでにDBに存在するか確認
    const nonExistent = await itemStore.findNonExistentRecordsFast([gameData]);
    if (!nonExistent.length) {
      continue;
    }

    console.log(`Saving ${uuid}`);

    const accountWithoutSeat = gameData.accounts.filter((x) => x.seat === undefined);
    if (accountWithoutSeat.length > 1) {
      throw new Error("Unexpected empty seat values");
    }
    if (accountWithoutSeat.length === 1) {
      accountWithoutSeat[0].seat = 0;
    }
    gameData.accounts.sort((a, b) => a.seat - b.seat);
    gameData.result.players.sort((a, b) => a.seat - b.seat);

    const result = buildRecordDataFromJson({ data: recordData, game: gameData });
    if (!result) {
      console.error(`Failed to build record data: ${uuid}`);
      continue;
    }

    const { rounds, ronStatsCollectors } = result;
    // accounts は seat 順にソート済み。scores は常に numSeats（3 or 4）分あるが
    // accounts には実際の参加者しかいないため、席番号をキーにした配列を構築する
    const numSeats = rounds[0].length;
    const accountIdsBySeat = Array(numSeats).fill(null);
    for (const account of gameData.accounts) {
      if (account.seat < numSeats) accountIdsBySeat[account.seat] = account.account_id;
    }
    const accumulator = new RonStatsAccumulator();
    for (const collector of ronStatsCollectors) {
      accumulator.accumulate(collector, accountIdsBySeat);
    }

    await withRetry(() => itemStore.saveGame(gameData, "paifu-json", true));
    await withRetry(() => itemStore.saveRoundData(gameData, rounds, true, accumulator.getStats()));
  }

  for (const store of allStores) {
    await store.triggerViewRefresh();
  }

  console.log("importPaifu completed");
}

module.exports = { importPaifu, buildRecordDataFromJson, isStandardDetailRule, getStoreForFriend, isTargetGame, calcEffectiveUraDora, indicatedToActualDora, countHaipaiDora };

if (require.main === module) {
  importPaifu().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
