"use strict";

const fs = require("fs");
const path = require("path");
const { buildRecordDataFromJson, isStandardDetailRule, getStoreForFriend } = require("../importPaifu");
const { CouchStorage, MODE_GAME } = require("../couchStorage");
const { RonStatsAccumulator, PLAYER_STATES, TILE_CATEGORIES } = require("../ronStats");

const PAIFU_DIR = path.join(__dirname, "../paifu");

const NEW_FORMAT_FILE = path.join(PAIFU_DIR, "230520-ae4fa20c-b7a0-4c77-a79d-905b2f5eb9ef.json");
const OLD_FORMAT_FILE = path.join(PAIFU_DIR, "200411-bfad3680-829e-4cd9-8d7d-a6882c0850e4.json");
// RecordNewRound より前に RecordNewCard が出現するファイル
const RECORD_NEW_CARD_FIRST_FILE = path.join(PAIFU_DIR, "220428-58e776a0-8c17-483e-a75a-4607c1375ac2.json");

function loadPaifu(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, { encoding: "utf-8" }));
  return { game: parsed.head, data: parsed.data };
}

describe("buildRecordDataFromJson", () => {
  describe("新形式（version >= 210715, actionsあり）のpaifu JSONからラウンドデータを生成できる", () => {
    test("ラウンド数が正しく生成される", () => {
      // Given: version=210715 の新形式 paifu（8局分のアクションを含む）
      const { game, data } = loadPaifu(NEW_FORMAT_FILE);

      // When: ラウンドデータを生成する
      const result = buildRecordDataFromJson({ data, game });

      // Then: null でなく、14局分のラウンドデータが返る
      expect(result).not.toBeNull();
      expect(result.rounds).toHaveLength(14);
    });

    test("各ラウンドに4人分のシートデータが含まれる", () => {
      // Given: 4人打ちの新形式 paifu
      const { game, data } = loadPaifu(NEW_FORMAT_FILE);

      // When: ラウンドデータを生成する
      const { rounds } = buildRecordDataFromJson({ data, game });

      // Then: 各ラウンドに4人分のデータが含まれる
      for (const round of rounds) {
        expect(round).toHaveLength(4);
      }
    });

    test("各ラウンドに親（亲）が1人いる", () => {
      // Given: 新形式 paifu
      const { game, data } = loadPaifu(NEW_FORMAT_FILE);

      // When: ラウンドデータを生成する
      const { rounds } = buildRecordDataFromJson({ data, game });

      // Then: 各ラウンドで親が1人だけ
      for (const round of rounds) {
        const dealers = round.filter((seat) => seat.亲 === true);
        expect(dealers).toHaveLength(1);
      }
    });

    test("各シートに手牌と起手向聴数が含まれる", () => {
      // Given: 新形式 paifu
      const { game, data } = loadPaifu(NEW_FORMAT_FILE);

      // When: ラウンドデータを生成する
      const { rounds } = buildRecordDataFromJson({ data, game });

      // Then: 各シートに手牌と起手向聴が設定されている
      for (const round of rounds) {
        for (const seat of round) {
          expect(seat.手牌).toBeDefined();
          expect(Array.isArray(seat.手牌)).toBe(true);
          expect(typeof seat.起手向听).toBe("number");
        }
      }
    });

    test("局数分のronStatsCollectorが返る", () => {
      // Given: 新形式 paifu
      const { game, data } = loadPaifu(NEW_FORMAT_FILE);

      // When: ラウンドデータを生成する
      const { rounds, ronStatsCollectors } = buildRecordDataFromJson({ data, game });

      // Then: ラウンド数と同数のコレクターが返る
      expect(ronStatsCollectors).toHaveLength(rounds.length);
    });

    test("ronStatsCollectorに捨て牌の統計が記録されている", () => {
      // Given: 新形式 paifu（複数局・捨て牌あり）
      const { game, data } = loadPaifu(NEW_FORMAT_FILE);

      // When: ラウンドデータを生成する
      const { ronStatsCollectors } = buildRecordDataFromJson({ data, game });

      // Then: 少なくとも1つのコレクターに捨て牌統計が記録されている
      const allStats = ronStatsCollectors.map((c) => c.getStats());
      const hasAnyDiscard = allStats.some((seatStatsArr) =>
        seatStatsArr.some((seatStats) =>
          Object.values(seatStats).some((junmeData) =>
            PLAYER_STATES.some((state) =>
              TILE_CATEGORIES.some((cat) => junmeData[state][cat].discarded > 0)
            )
          )
        )
      );
      expect(hasAnyDiscard).toBe(true);
    });

    test("RonStatsAccumulatorでplayerId単位の統計に集約できる", () => {
      // Given: 新形式 paifu
      const { game, data } = loadPaifu(NEW_FORMAT_FILE);
      const { ronStatsCollectors } = buildRecordDataFromJson({ data, game });
      const accountIds = game.accounts.map((a) => a.account_id);

      // When: Accumulatorで全局を集約する
      const accumulator = new RonStatsAccumulator();
      for (const collector of ronStatsCollectors) {
        accumulator.accumulate(collector, accountIds);
      }
      const stats = accumulator.getStats();

      // Then: 各アカウントIDのキーで統計が返る
      for (const accountId of accountIds) {
        expect(stats).toHaveProperty(String(accountId));
      }
    });
  });

  describe("旧形式（records配列）のpaifu JSONからラウンドデータを生成できる", () => {
    test("ラウンド数が正しく生成される", () => {
      // Given: records配列を持つ旧形式 paifu（11局分を含む）
      const { game, data } = loadPaifu(OLD_FORMAT_FILE);

      // When: ラウンドデータを生成する
      const result = buildRecordDataFromJson({ data, game });

      // Then: null でなく、11局分のラウンドデータが返る
      expect(result).not.toBeNull();
      expect(result.rounds).toHaveLength(11);
    });

    test("各ラウンドに4人分のシートデータが含まれる", () => {
      // Given: 4人打ちの旧形式 paifu
      const { game, data } = loadPaifu(OLD_FORMAT_FILE);

      // When: ラウンドデータを生成する
      const { rounds } = buildRecordDataFromJson({ data, game });

      // Then: 各ラウンドに4人分のデータが含まれる
      for (const round of rounds) {
        expect(round).toHaveLength(4);
      }
    });

    test("各ラウンドに親（亲）が1人いる", () => {
      // Given: 旧形式 paifu
      const { game, data } = loadPaifu(OLD_FORMAT_FILE);

      // When: ラウンドデータを生成する
      const { rounds } = buildRecordDataFromJson({ data, game });

      // Then: 各ラウンドで親が1人だけ
      for (const round of rounds) {
        const dealers = round.filter((seat) => seat.亲 === true);
        expect(dealers).toHaveLength(1);
      }
    });
  });

  describe("RecordNewRound より前に RecordNewCard が出現する場合でも正常に処理できる", () => {
    test("ラウンドデータが正しく生成される", () => {
      // Given: RecordNewCard が RecordNewRound より前に出現する paifu（5局分）
      const { game, data } = loadPaifu(RECORD_NEW_CARD_FIRST_FILE);

      // When: ラウンドデータを生成する
      const result = buildRecordDataFromJson({ data, game });

      // Then: null でなく、5局分のラウンドデータが返る
      expect(result).not.toBeNull();
      expect(result.rounds).toHaveLength(5);
    });
  });

  describe("actionsにresultがない場合はスキップされる", () => {
    test("resultのないactionsのみの場合はnullを返す", () => {
      // Given: result を持たない actions だけの data
      const game = { uuid: "test-no-result" };
      const data = {
        name: ".lq.GameDetailRecords",
        data: {
          version: 210715,
          actions: [
            { passed: 100, type: 3, user_event: { seat: 0, type: 1 } },
            { passed: 200, type: 3, user_event: { seat: 1, type: 1 } },
          ],
        },
      };

      // When: ラウンドデータを生成する
      const result = buildRecordDataFromJson({ data, game });

      // Then: レコードが空なので null が返る
      expect(result).toBeNull();
    });

    test("resultがnullのactionsはスキップされる", () => {
      // Given: result=null のactionを含む（有効なレコードは0件）
      const game = { uuid: "test-null-result" };
      const data = {
        name: ".lq.GameDetailRecords",
        data: {
          version: 210715,
          actions: [
            { passed: 100, result: null },
            { passed: 200, result: undefined },
          ],
        },
      };

      // When: ラウンドデータを生成する
      const result = buildRecordDataFromJson({ data, game });

      // Then: 有効なレコードがないので null が返る
      expect(result).toBeNull();
    });
  });

  describe("不正なデータの場合はnullを返す", () => {
    test("recordsが空の旧形式データはnullを返す", () => {
      // Given: 空の records 配列を持つ旧形式 data（version なし）
      const game = { uuid: "test-empty-records" };
      const data = {
        name: ".lq.GameDetailRecords",
        data: {
          records: [],
        },
      };

      // When: ラウンドデータを生成する
      const result = buildRecordDataFromJson({ data, game });

      // Then: レコードが空なので null が返る
      expect(result).toBeNull();
    });

    test("actionsが空の新形式データはnullを返す", () => {
      // Given: 空の actions 配列を持つ新形式 data
      const game = { uuid: "test-empty-actions" };
      const data = {
        name: ".lq.GameDetailRecords",
        data: {
          version: 210715,
          actions: [],
        },
      };

      // When: ラウンドデータを生成する
      const result = buildRecordDataFromJson({ data, game });

      // Then: レコードが空なので null が返る
      expect(result).toBeNull();
    });
  });
});

const STANDARD_RULE = {
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

describe("isStandardDetailRule", () => {
  test("標準ルールと完全一致する場合はtrueを返す", () => {
    expect(isStandardDetailRule({ ...STANDARD_RULE })).toBe(true);
  });

  test("余分なキーがあってもtrueを返す", () => {
    // 実際のpaifuには標準キー以外のフィールドが追加されている場合がある
    expect(isStandardDetailRule({ ...STANDARD_RULE, extra_key: 99 })).toBe(true);
  });

  test("標準ルールのいずれかのキーが異なる場合はfalseを返す", () => {
    expect(isStandardDetailRule({ ...STANDARD_RULE, dora_count: 4 })).toBe(false);
  });

  test("キーが不足している場合はfalseを返す", () => {
    const { open_hand, ...noOpenHand } = STANDARD_RULE;
    expect(isStandardDetailRule(noOpenHand)).toBe(false);
  });

  test("nullの場合はfalseを返す", () => {
    expect(isStandardDetailRule(null)).toBe(false);
  });
});

describe("getStoreForFriend", () => {
  function makeGroups() {
    return {
      friend: { store: "friend_store" },
      friend3: { store: "friend3_store" },
      friendSpecial: { store: "friendSpecial_store" },
    };
  }

  test("accounts.length===3のゲームはfriend3ストアに振り分けられる", () => {
    // Given: 3人打ちフレンドルーム
    const gameData = {
      accounts: [{}, {}, {}],
      config: { mode: { detail_rule: { ...STANDARD_RULE } } },
    };

    // When
    const store = getStoreForFriend(makeGroups(), gameData);

    // Then
    expect(store).toBe("friend3_store");
  });

  test("accounts.length===3はdetail_ruleに関わらずfriend3になる", () => {
    // Given: 3人打ちで非標準ルール
    const gameData = {
      accounts: [{}, {}, {}],
      config: { mode: { detail_rule: { ...STANDARD_RULE, dora_count: 4 } } },
    };

    const store = getStoreForFriend(makeGroups(), gameData);

    expect(store).toBe("friend3_store");
  });

  test("4人打ちでstandard_rule=0のゲームはfriendSpecialストアに振り分けられる", () => {
    // Given: 4人打ちで非標準ルール（standard_rule=0）
    const gameData = {
      accounts: [{}, {}, {}, {}],
      standard_rule: 0,
      config: {},
    };

    const store = getStoreForFriend(makeGroups(), gameData);

    expect(store).toBe("friendSpecial_store");
  });

  test("4人打ちでstandard_rule=1のゲームはfriendストアに振り分けられる", () => {
    // Given: 4人打ちで標準ルール（standard_rule=1）
    const gameData = {
      accounts: [{}, {}, {}, {}],
      standard_rule: 1,
      config: {},
    };

    const store = getStoreForFriend(makeGroups(), gameData);

    expect(store).toBe("friend_store");
  });
});

describe("isTargetGame", () => {
  const accounts = (ids) => ids.map((id) => ({ account_id: id }));

  describe("TARGET_ACCOUNT_IDSが未設定の場合", () => {
    let isTargetGame;
    beforeAll(() => {
      delete process.env.TARGET_ACCOUNT_IDS;
      jest.resetModules();
      ({ isTargetGame } = require("../importPaifu"));
    });

    test("全てのゲームがtrueを返す", () => {
      expect(isTargetGame({ accounts: accounts([1, 2, 3, 4]) })).toBe(true);
    });
  });

  describe("TARGET_ACCOUNT_IDSが設定されている場合", () => {
    let isTargetGame;
    beforeAll(() => {
      process.env.TARGET_ACCOUNT_IDS = "10,20,30,40";
      jest.resetModules();
      ({ isTargetGame } = require("../importPaifu"));
    });
    afterAll(() => {
      delete process.env.TARGET_ACCOUNT_IDS;
    });

    test("全参加者がTARGET_ACCOUNT_IDSに含まれる場合はtrueを返す", () => {
      expect(isTargetGame({ accounts: accounts([10, 20, 30, 40]) })).toBe(true);
    });

    test("参加者の一部がTARGET_ACCOUNT_IDSに含まれない場合はfalseを返す", () => {
      expect(isTargetGame({ accounts: accounts([10, 20, 30, 99]) })).toBe(false);
    });

    test("全参加者がTARGET_ACCOUNT_IDSに含まれない場合はfalseを返す", () => {
      expect(isTargetGame({ accounts: accounts([91, 92, 93, 94]) })).toBe(false);
    });

    test("TARGET_ACCOUNT_IDSの部分集合でもtrueを返す", () => {
      // Given: 3人打ちで全員がTARGET_ACCOUNT_IDSに含まれる
      expect(isTargetGame({ accounts: accounts([10, 20, 30]) })).toBe(true);
    });
  });
});

describe("CouchStorage.destroyDatabases", () => {
  test("MODE_GAMEのとき_basicと_extendedの両DBにDELETEリクエストを送る", async () => {
    // Given: HTTP DELETE を受け付けるフェッチをモックしたストア
    const storage = new CouchStorage({ uri: "http://couchdb:5984/majsoul", suffix: "_friend", mode: MODE_GAME });
    const mockFetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ ok: true }),
    });
    storage._fetch = mockFetch;

    // When: destroyDatabases を呼ぶ
    await storage.destroyDatabases();

    // Then: _basic と _extended の両方に DELETE リクエストが送られる
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith("http://couchdb:5984/majsoul_friend_basic", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    expect(mockFetch).toHaveBeenCalledWith("http://couchdb:5984/majsoul_friend_extended", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
  });
});

describe("importPaifu の RESET_DB オプション", () => {
  // jest.mock はホイストされるため、ファクトリ内では mock プレフィックスの変数のみ参照可能
  let mockDestroyDatabases;

  function setupMocks(resetDbValue) {
    jest.resetModules();
    mockDestroyDatabases = jest.fn().mockResolvedValue(undefined);
    jest.mock("../couchStorage", () => {
      const MockCouchStorage = jest.fn().mockImplementation(() => ({
        destroyDatabases: mockDestroyDatabases,
        ensureIndexes: jest.fn().mockResolvedValue(undefined),
        findNonExistentRecordsFast: jest.fn().mockResolvedValue([]),
        triggerViewRefresh: jest.fn().mockResolvedValue(undefined),
      }));
      MockCouchStorage.DEFAULT_MODE = "GAME";
      return { CouchStorage: MockCouchStorage, MODE_GAME: "GAME" };
    });
    jest.mock("fs", () => ({
      ...jest.requireActual("fs"),
      readdirSync: jest.fn().mockReturnValue([]),
    }));
    if (resetDbValue === undefined) {
      delete process.env.RESET_DB;
    } else {
      process.env.RESET_DB = resetDbValue;
    }
    return require("../importPaifu");
  }

  afterEach(() => {
    delete process.env.RESET_DB;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test("RESET_DB=1 のとき、3つのDBグループ全てがdestroyされる", async () => {
    // Given: RESET_DB=1 で importPaifu をロード
    const { importPaifu } = setupMocks("1");

    // When: importPaifu を実行
    await importPaifu();

    // Then: _friend, _friend3, _friend_special の3グループ分destroyが呼ばれる
    expect(mockDestroyDatabases).toHaveBeenCalledTimes(3);
  });

  test("RESET_DB が未設定のとき、DBのdestroyは実行されない", async () => {
    // Given: RESET_DB 未設定で importPaifu をロード
    const { importPaifu } = setupMocks(undefined);

    // When: importPaifu を実行
    await importPaifu();

    // Then: destroyDatabases は呼ばれない
    expect(mockDestroyDatabases).not.toHaveBeenCalled();
  });

  test("RESET_DB=0 のとき、DBのdestroyは実行されない", async () => {
    // Given: RESET_DB=0 で importPaifu をロード（文字列"0"はリセット無効）
    const { importPaifu } = setupMocks("0");

    // When: importPaifu を実行
    await importPaifu();

    // Then: destroyDatabases は呼ばれない
    expect(mockDestroyDatabases).not.toHaveBeenCalled();
  });
});
