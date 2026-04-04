const { wrappedMain, wrappedRun } = require("./entryPoint");

const rp = require("request-promise");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const compareVersion = require("node-version-compare");

const { CouchStorage, MODE_GAME } = require("./couchStorage");
const { iterateLocalData, DEFAULT_BASE, iteratePendingData } = require("./localData");
const { calcShanten } = require("./shanten");
const { MajsoulGameAnalyzer } = require("./gameAnalyzer");

CouchStorage.DEFAULT_MODE = MODE_GAME;

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

function buildRecordData({ data, dataDefinition, game }) {
  const root = require("protobufjs").Root.fromJSON(dataDefinition);
  const wrapper = root.nested.lq.Wrapper;
  let msg, typeObj, payload;
  try {
    msg = wrapper.decode(data);
    typeObj = root.lookupType(msg.name);
    if (!typeObj || !typeObj.decode) {
      console.log(`No decoder: name=${msg.name} uuid=${game.uuid} !!typeObj=${!!typeObj}`);
      // console.log(game, msg, typeObj);
      return null;
    }
    payload = typeObj.decode(msg.data);
  } catch (e) {
    console.log(`Decode error: name=${msg.name} uuid=${game.uuid} !!typeObj=${!!typeObj}`);
    // console.log(game, msg, typeObj);
    console.error(e);
    return null;
  }
  const records = payload.version >= 210715 ? [] : payload.records;
  if (payload.version >= 210715) {
    for (const action of payload.actions) {
      if (!action.result || !action.result.length) {
        continue;
      }
      records.push(action.result);
    }
  }
  assert(records.length);
  const rounds = [];
  let 振听 = null;
  let numDiscarded = null;
  let lastDiscardSeat = null;
  let analyzer = null;
  for (const itemBuf of records) {
    let item;
    let itemType;
    let itemPayload;
    try {
      item = wrapper.decode(itemBuf);
      itemType = root.lookupType(item.name);
      itemPayload = itemType.decode(item.data);
    } catch (e) {
      console.log(game, item, !!itemType);
      console.error(e);
      return null;
    }
    if (item.name !== ".lq.RecordNewRound") {
      assert(analyzer);
      try {
        analyzer.processRecord(item.name, itemPayload);
      } catch (e) {
        console.log(game, item, !!itemType, itemPayload);
        console.error(e);
        return null;
      }
    }
    if ([".lq.RecordDealTile"].includes(item.name)) {
      continue;
    }
    if (item.name === ".lq.RecordNewRound") {
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
    switch (item.name) {
      case ".lq.RecordChiPengGang":
        assert(typeof itemPayload.seat === "number");
        curRound[itemPayload.seat].副露 = (curRound[itemPayload.seat].副露 || 0) + 1;
        break;
      case ".lq.RecordDiscardTile":
        assert(typeof itemPayload.seat === "number");
        // console.log(itemPayload);
        lastDiscardSeat = itemPayload.seat;
        振听 = itemPayload.zhenting; // Array of all players' status
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
            // 一炮多响 + 包牌
            // console.log(itemPayload, game.uuid);
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
        console.log(game.uuid);
        console.log(item.name);
        delete itemPayload.operation;
        console.log(itemPayload);
        assert(false, `Unknown record type: ${item.name}`);
    }
  }
  return rounds;
}
async function processRecordDataForGameId(store, uuid, recordData, gameData, batch) {
  const rawRecordInfo = {
    ...(gameData || (await withRetry(() => store.getRecordData(uuid)))),
    data: recordData,
  };
  const rounds = buildRecordData(rawRecordInfo);
  if (!rounds) {
    console.error(`Corrupted data: ${uuid}`);
    const e = new Error(`Corrupted data: ${uuid}`);
    e.noRetry = true;
    if (["240417-1fd14c94-32df-4ab6-a739-bb6454934796", "240417-a749e1dc-5725-4b64-a3f9-f4f09a3dd476"].includes(uuid)) {
      // Source data is corrupt, not fixable
      throw e;
    }
    fs.mkdirSync(path.join(DEFAULT_BASE, "210101"), { recursive: true });
    fs.writeFileSync(path.join(DEFAULT_BASE, "210101", uuid + ".json"), "");
    fs.utimesSync(path.join(DEFAULT_BASE, "210101", uuid + ".json"), 1, 1);
    throw e;
  }
  // console.log(rawRecordInfo.game.uuid);
  await withRetry(() => store.saveRoundData(rawRecordInfo.game, rounds, batch));
}

async function loadLocalData(withPendingDb) {
  const store = new CouchStorage();
  const dataDefs = await store._db.allDocs({
    include_docs: true,
    startkey: "dataDefinition-",
    endkey: "dataDefinition-\uffff",
  });
  const ver = dataDefs.rows
    .map((x) => x.doc.version)
    .sort(compareVersion)
    .reverse()[0];
  const dataDefinition = dataDefs.rows.filter((x) => x.doc.version === ver)[0].doc.defintion;
  const groups = {
    normal: {
      store,
      items: [],
    },
    gold: {
      store: new CouchStorage({ suffix: "_gold" }),
      items: [],
    },
    sanma: {
      store: new CouchStorage({ suffix: "_sanma" }),
      items: [],
    },
    e4: {
      store: new CouchStorage({ suffix: "_e4" }),
      items: [],
    },
    e3: {
      store: new CouchStorage({ suffix: "_e3" }),
      items: [],
    },
  };
  const processLoadedData = async function () {
    for (const group of Object.values(groups)) {
      let items = group.items;
      group.items = [];
      const itemStore = group.store;
      const filteredItems = [];
      while (items.length) {
        const chunk = items.slice(0, 100);
        items = items.slice(100);
        const filteredIds = process.env.FORCE_LOAD
          ? new Set(chunk.map((x) => x.data.uuid))
          : new Set((await itemStore.findNonExistentRecordsFast(chunk.map((x) => x.data))).map((x) => x.uuid));
        for (const item of chunk) {
          if (filteredIds.has(item.data.uuid)) {
            filteredItems.push(item);
          }
        }
      }
      if (!filteredItems.length) {
        continue;
      }
      for (const item of filteredItems) {
        if (item.id === "200207-56f99098-5bae-4d19-a8e6-0ce03246e02a") {
          // Skip buggy game
          continue;
        }
        console.log(`Saving ${item.id}`);
        const recordData = item.getRecordData();
        const accountWithoutSeat = item.data.accounts.filter((x) => x.seat === undefined);
        if (accountWithoutSeat.length > 1) {
          throw new Error("Unexpected empty seat values");
        }
        if (accountWithoutSeat.length === 1) {
          accountWithoutSeat[0].seat = 0;
        }
        item.data.accounts.sort((a, b) => a.seat - b.seat);
        item.data.result.players.sort((a, b) => a.seat - b.seat);
        await withRetry(() => itemStore.saveGame(item.data, ver, true));
        await withRetry(() =>
          processRecordDataForGameId(itemStore, item.id, recordData, { game: item.data, dataDefinition }, true)
        );
      }
      await itemStore.triggerViewRefresh();
    }
  };
  await (withPendingDb ? iteratePendingData : iterateLocalData)(async function (item) {
    try {
      item.data = item.getData();
    } catch (e) {
      console.error(`Failed to parse ${item.id}:`, e);
      return;
    }
    if (item.data.config.category !== 2) {
      return;
    }
    if ([12, 16].includes(item.data.config.meta.mode_id)) {
      groups.normal.items.push(item);
    } else if ([9].includes(item.data.config.meta.mode_id)) {
      groups.gold.items.push(item);
    } else if ([22, 24, 26].includes(item.data.config.meta.mode_id)) {
      groups.sanma.items.push(item);
    } else if ([15, 11, 8].includes(item.data.config.meta.mode_id)) {
      groups.e4.items.push(item);
    } else if ([25, 23, 21].includes(item.data.config.meta.mode_id)) {
      groups.e3.items.push(item);
    } else {
      console.log(`Unknown mode ${item.data.config.meta.mode_id}, skipping ${item.id}`);
    }

    if (Object.values(groups).some((x) => x.items.length > 1000)) {
      await processLoadedData();
    }
  });
  await new Promise((res) => setTimeout(res, 3000));
  await processLoadedData();
}

async function main() {
  if (process.env.EXTERNAL_AGGREGATION) {
    throw new Error("Moved to separate script");
  }
  if (process.env.SYNC_COUCHDB) {
    throw new Error("No longer supported");
  }
  if (process.env.IMPORT_PAIFU) {
    const { importPaifu } = require("./importPaifu");
    return await importPaifu();
  }
  if (process.env.LOAD_LOCAL_DATA) {
    return await loadLocalData(process.env.WITH_PENDING_DB?.toString() === "1");
  }
  if (process.env.UPDATE_AGV) {
    throw new Error("Moved to separate script");
  }
  throw new Error("No valid operation specified");
}

if (require.main === module) {
  wrappedRun(main);
} else {
  exports["amae-koromo"] = wrappedMain(main);
  exports.processRecordDataForGameId = processRecordDataForGameId;
}
// vim: sw=2:ts=2:expandtab:fdm=syntax
