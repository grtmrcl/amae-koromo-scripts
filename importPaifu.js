"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const _ = require("lodash");

const { CouchStorage, MODE_GAME } = require("./couchStorage");
const { calcShanten } = require("./shanten");
const { MajsoulGameAnalyzer } = require("./gameAnalyzer");

CouchStorage.DEFAULT_MODE = MODE_GAME;

const PAIFU_DIR = process.env.PAIFU_DIR || path.join(__dirname, "paifu");

// TARGET_ACCOUNT_IDS が設定されている場合、全参加者がその中に含まれるゲームのみ登録する
const TARGET_ACCOUNT_IDS = process.env.TARGET_ACCOUNT_IDS
  ? new Set(process.env.TARGET_ACCOUNT_IDS.split(",").map((id) => Number(id.trim())))
  : null;

function isTargetGame(gameData) {
  if (!TARGET_ACCOUNT_IDS) return true;
  return gameData.accounts.every((account) => TARGET_ACCOUNT_IDS.has(account.account_id));
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
  let 振听 = null;
  let numDiscarded = null;
  let lastDiscardSeat = null;
  let analyzer = null;

  for (const item of records) {
    // item = { name: ".lq.RecordXxx", data: { ... } }
    const itemName = item.name;
    const itemPayload = item.data;

    if (itemName !== ".lq.RecordNewRound") {
      assert(analyzer);
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
        }))
      );
      振听 = Array(rounds[rounds.length - 1].length).fill(false);
      numDiscarded = 0;
      lastDiscardSeat = null;
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
          curRound[x.seat].和 = [
            itemPayload.delta_scores[x.seat] - (x.liqi ? 1000 : 0),
            _.flatten(x.fans.map((x) => Array(x.val).fill(x.id))),
            numDiscarded / numPlayers + 1,
          ];
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

  return rounds;
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
  const detailRule = gameData.config.mode && gameData.config.mode.detail_rule;
  if (!isStandardDetailRule(detailRule)) {
    return groups.friendSpecial.store;
  }
  return groups.friend.store;
}

function getStoreForModeId(groups, modeId) {
  if ([12, 16].includes(modeId)) return groups.normal.store;
  if ([9].includes(modeId)) return groups.gold.store;
  if ([22, 24, 26].includes(modeId)) return groups.sanma.store;
  if ([15, 11, 8].includes(modeId)) return groups.e4.store;
  if ([25, 23, 21].includes(modeId)) return groups.e3.store;
  return null;
}

async function importPaifu() {
  const groups = {
    normal: { store: new CouchStorage({ skipSetup: false }) },
    gold: { store: new CouchStorage({ suffix: "_gold", skipSetup: false }) },
    sanma: { store: new CouchStorage({ suffix: "_sanma", skipSetup: false }) },
    e4: { store: new CouchStorage({ suffix: "_e4", skipSetup: false }) },
    e3: { store: new CouchStorage({ suffix: "_e3", skipSetup: false }) },
    friend: { store: new CouchStorage({ suffix: "_friend", skipSetup: false }) },
    friend3: { store: new CouchStorage({ suffix: "_friend3", skipSetup: false }) },
    friendSpecial: { store: new CouchStorage({ suffix: "_friend_special", skipSetup: false }) },
  };

  const files = fs.readdirSync(PAIFU_DIR).filter((f) => /^\d{6}-.*\.json$/.test(f));
  console.log(`Found ${files.length} paifu files in ${PAIFU_DIR}`);

  const allStores = Object.values(groups).map((g) => g.store);

  for (const file of files) {
    const filePath = path.join(PAIFU_DIR, file);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, { encoding: "utf-8" }));
    } catch (e) {
      console.error(`Failed to parse ${file}:`, e);
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
      continue;
    }

    // category === 1（フレンドルーム戦）または category === 2（公式段位戦）以外はスキップ
    const category = gameData.config.category;
    if (category !== 1 && category !== 2) {
      continue;
    }

    let itemStore;
    if (category === 1) {
      // フレンドルーム戦: accounts数とdetail_ruleで細分化
      itemStore = getStoreForFriend(groups, gameData);
    } else {
      const modeId = gameData.config.meta.mode_id;
      itemStore = getStoreForModeId(groups, modeId);
      if (!itemStore) {
        console.log(`Unknown mode ${modeId}, skipping ${file}`);
        continue;
      }
    }

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

    const rounds = buildRecordDataFromJson({ data: recordData, game: gameData });
    if (!rounds) {
      console.error(`Failed to build record data: ${uuid}`);
      continue;
    }

    await withRetry(() => itemStore.saveGame(gameData, "paifu-json", true));
    await withRetry(() => itemStore.saveRoundData(gameData, rounds, true));
  }

  for (const store of allStores) {
    await store.triggerViewRefresh();
  }

  console.log("importPaifu completed");
}

module.exports = { importPaifu, buildRecordDataFromJson, isStandardDetailRule, getStoreForFriend, isTargetGame };

if (require.main === module) {
  importPaifu().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
