"use strict";

const fs = require("fs");
const path = require("path");
const { buildRecordDataFromJson, isStandardDetailRule, getStoreForFriend, calcEffectiveUraDora, indicatedToActualDora, countHaipaiDora } = require("../importPaifu");
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

describe("importPaifu の targetFiles オプション", () => {
  let mockReadFileSync;
  let mockReaddirSync;

  function setupMocksWithFs() {
    jest.resetModules();
    mockDestroyDatabases = jest.fn().mockResolvedValue(undefined);
    mockReadFileSync = jest.fn();
    mockReaddirSync = jest.fn();
    jest.mock("../couchStorage", () => {
      const MockCouchStorage = jest.fn().mockImplementation(() => ({
        destroyDatabases: mockDestroyDatabases,
        ensureIndexes: jest.fn().mockResolvedValue(undefined),
        findNonExistentRecordsFast: jest.fn().mockResolvedValue([{ uuid: "dummy" }]),
        saveGame: jest.fn().mockResolvedValue(undefined),
        saveRoundData: jest.fn().mockResolvedValue(undefined),
        triggerViewRefresh: jest.fn().mockResolvedValue(undefined),
      }));
      MockCouchStorage.DEFAULT_MODE = "GAME";
      return { CouchStorage: MockCouchStorage, MODE_GAME: "GAME" };
    });
    jest.mock("fs", () => ({
      ...jest.requireActual("fs"),
      readdirSync: mockReaddirSync,
      readFileSync: mockReadFileSync,
    }));
    return require("../importPaifu");
  }

  let mockDestroyDatabases;

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test.each([
    {
      name: "targetFiles 未指定のとき、ディレクトリ内の全ファイルを対象にする",
      // Given
      targetFiles: null,
      readdirFiles: ["220101-aaa.json", "220102-bbb.json"],
      // Then
      expectedReadCount: 2,
    },
    {
      name: "targetFiles に1件指定したとき、そのファイルのみを対象にする",
      // Given
      targetFiles: ["220101-aaa.json"],
      readdirFiles: ["220101-aaa.json", "220102-bbb.json"],
      // Then
      expectedReadCount: 1,
    },
    {
      name: "targetFiles に .json なしで指定したとき、自動で拡張子が補完される",
      // Given
      targetFiles: ["220101-aaa"],
      readdirFiles: ["220101-aaa.json", "220102-bbb.json"],
      // Then
      expectedReadCount: 1,
    },
    {
      name: "targetFiles に複数ファイルを指定したとき、指定したファイルのみを対象にする",
      // Given
      targetFiles: ["220101-aaa.json", "220102-bbb.json"],
      readdirFiles: ["220101-aaa.json", "220102-bbb.json", "220103-ccc.json"],
      // Then
      expectedReadCount: 2,
    },
  ])("$name", async ({ targetFiles, readdirFiles, expectedReadCount }) => {
    // Given: fs をモックし、readdirSync が readdirFiles を返すようにする
    const { importPaifu } = setupMocksWithFs();
    mockReaddirSync.mockReturnValue(readdirFiles);
    // readFileSync は category !== 1 のデータを返す（インポート処理をスキップさせる）
    mockReadFileSync.mockImplementation((filePath, _opts) => {
      if (typeof filePath === "string" && filePath.endsWith(".json")) {
        return JSON.stringify({ head: { uuid: "dummy", accounts: [], config: { category: 2 }, result: { players: [] } }, data: { name: ".lq.GameDetailRecords", data: { records: [] } } });
      }
      return jest.requireActual("fs").readFileSync(filePath, _opts);
    });

    // When: importPaifu を実行
    await importPaifu({ targetFiles });

    // Then: 指定件数分だけ readFileSync が呼ばれる
    const jsonReadCount = mockReadFileSync.mock.calls.filter(([p]) => typeof p === "string" && p.endsWith(".json")).length;
    expect(jsonReadCount).toBe(expectedReadCount);
  });

  test("存在しないファイルを指定したとき、エラーログを出力してスキップする", async () => {
    // Given: readFileSync が ENOENT エラーを投げる
    const { importPaifu } = setupMocksWithFs();
    mockReaddirSync.mockReturnValue([]);
    const enoentError = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mockReadFileSync.mockImplementation((filePath, _opts) => {
      if (typeof filePath === "string" && filePath.endsWith(".json")) throw enoentError;
      return jest.requireActual("fs").readFileSync(filePath, _opts);
    });
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    // When: 存在しないファイルを targetFiles に指定して実行
    await importPaifu({ targetFiles: ["nonexistent.json"] });

    // Then: "File not found" のエラーログが出力される
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/File not found.*nonexistent\.json/));
  });
});

describe("importPaifu の除外ファイル移動処理", () => {
  let mockReadFileSync;
  let mockReaddirSync;
  let mockRenameSync;
  let mockMkdirSync;

  function setupMocksWithFs() {
    jest.resetModules();
    mockReadFileSync = jest.fn();
    mockReaddirSync = jest.fn().mockReturnValue([]);
    mockRenameSync = jest.fn();
    mockMkdirSync = jest.fn();
    jest.mock("../couchStorage", () => {
      const MockCouchStorage = jest.fn().mockImplementation(() => ({
        destroyDatabases: jest.fn().mockResolvedValue(undefined),
        ensureIndexes: jest.fn().mockResolvedValue(undefined),
        findNonExistentRecordsFast: jest.fn().mockResolvedValue([{ uuid: "dummy" }]),
        saveGame: jest.fn().mockResolvedValue(undefined),
        saveRoundData: jest.fn().mockResolvedValue(undefined),
        triggerViewRefresh: jest.fn().mockResolvedValue(undefined),
      }));
      MockCouchStorage.DEFAULT_MODE = "GAME";
      return { CouchStorage: MockCouchStorage, MODE_GAME: "GAME" };
    });
    jest.mock("fs", () => ({
      ...jest.requireActual("fs"),
      readdirSync: mockReaddirSync,
      readFileSync: mockReadFileSync,
      renameSync: mockRenameSync,
      mkdirSync: mockMkdirSync,
    }));
    process.env.PAIFU_EXCLUDE_DIR = "/tmp/paifu_exclude_test";
    return require("../importPaifu");
  }

  afterEach(() => {
    delete process.env.PAIFU_EXCLUDE_DIR;
    delete process.env.TARGET_ACCOUNT_IDS;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  function makeFileContent(category, accountIds) {
    return JSON.stringify({
      head: {
        uuid: "dummy-uuid",
        accounts: accountIds.map((id, i) => ({ account_id: id, seat: i })),
        config: { category },
        result: { players: [] },
      },
      data: { name: ".lq.GameDetailRecords", data: { records: [] } },
    });
  }

  test("TARGET_ACCOUNT_IDSに含まれないアカウントのゲームファイルがpaifu_excludeに移動される", async () => {
    // Given: TARGET_ACCOUNT_IDS=10,20 で、account_id=99 が含まれるゲームファイル
    process.env.TARGET_ACCOUNT_IDS = "10,20";
    const { importPaifu } = setupMocksWithFs();
    mockReaddirSync.mockReturnValue(["220101-aaa.json"]);
    mockReadFileSync.mockImplementation((filePath, _opts) => {
      if (typeof filePath === "string" && filePath.endsWith(".json")) {
        return makeFileContent(1, [99, 10]);
      }
      return jest.requireActual("fs").readFileSync(filePath, _opts);
    });

    // When: importPaifu を実行
    await importPaifu();

    // Then: ファイルが paifu_exclude ディレクトリに移動される
    expect(mockRenameSync).toHaveBeenCalledWith(
      expect.stringContaining("220101-aaa.json"),
      expect.stringContaining("220101-aaa.json")
    );
    expect(mockRenameSync.mock.calls[0][1]).toContain("paifu_exclude_test");
  });

  test("フレンドルーム戦以外（category !== 1）のゲームファイルがpaifu_excludeに移動される", async () => {
    // Given: category=2（フレンドルーム戦以外）のゲームファイル
    const { importPaifu } = setupMocksWithFs();
    mockReaddirSync.mockReturnValue(["220101-aaa.json"]);
    mockReadFileSync.mockImplementation((filePath, _opts) => {
      if (typeof filePath === "string" && filePath.endsWith(".json")) {
        return makeFileContent(2, [10, 20]);
      }
      return jest.requireActual("fs").readFileSync(filePath, _opts);
    });

    // When: importPaifu を実行
    await importPaifu();

    // Then: ファイルが paifu_exclude ディレクトリに移動される
    expect(mockRenameSync).toHaveBeenCalledWith(
      expect.stringContaining("220101-aaa.json"),
      expect.stringContaining("220101-aaa.json")
    );
    expect(mockRenameSync.mock.calls[0][1]).toContain("paifu_exclude_test");
  });

  test("targetFiles 指定時は除外対象でもファイルが移動されない", async () => {
    // Given: category=2 のファイルを targetFiles で指定
    const { importPaifu } = setupMocksWithFs();
    mockReadFileSync.mockImplementation((filePath, _opts) => {
      if (typeof filePath === "string" && filePath.endsWith(".json")) {
        return makeFileContent(2, [10, 20]);
      }
      return jest.requireActual("fs").readFileSync(filePath, _opts);
    });

    // When: targetFiles を指定して importPaifu を実行
    await importPaifu({ targetFiles: ["220101-aaa.json"] });

    // Then: renameSync は呼ばれない
    expect(mockRenameSync).not.toHaveBeenCalled();
  });

  test("paifu_excludeディレクトリが存在しない場合でも自動作成されて正常動作する", async () => {
    // Given: mkdirSync をモック（実際には作成しない）
    const { importPaifu } = setupMocksWithFs();
    mockReaddirSync.mockReturnValue([]);

    // When: importPaifu を実行
    await importPaifu();

    // Then: mkdirSync が recursive: true で呼ばれる
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("paifu_exclude_test"),
      { recursive: true }
    );
  });
});

// fan ID 定数（importPaifu.js と対応）
const FAN_URA = 33;    // 裏ドラ
const FAN_TSUMO = 29;  // 門前清自摸和
const FAN_PINFU = 3;   // 平和
const FAN_RIICHI = 1;  // 立直（例示用）

// fans 配列ビルダー: {id, count} の配列から id を count 枚展開した配列を生成
function buildFanIds(specs) {
  return specs.flatMap(({ id, count }) => Array(count).fill(id));
}

describe("calcEffectiveUraDora: 有効裏ドラ枚数の計算", () => {
  describe("条件1: 裏ドラ除外fansが5以下/7/10/12のとき、6/8/11/13に達する裏ドラが有効", () => {
    test.each([
      {
        name: "仕様例1: base=5, ura=2 → 閾値6まで1枚有効",
        // Given
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 5 }, { id: FAN_URA, count: 2 }]),
        fu: 30,
        // Then
        expected: 1,
      },
      {
        name: "仕様例2: base=3, ura=5 → 最大到達閾値8まで5枚全て有効",
        // Given
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 3 }, { id: FAN_URA, count: 5 }]),
        fu: 30,
        // Then
        expected: 5,
      },
      {
        name: "仕様例3: base=5, ura=5 → 閾値8まで3枚有効（10は到達するが8が最大有効閾値）",
        // Given
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 5 }, { id: FAN_URA, count: 5 }]),
        fu: 30,
        // Then
        expected: 3,
      },
      {
        name: "base=7, ura=1 → 閾値8まで1枚有効",
        // Given
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 7 }, { id: FAN_URA, count: 1 }]),
        fu: 30,
        // Then
        expected: 1,
      },
      {
        name: "base=10, ura=1 → 閾値11まで1枚有効",
        // Given
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 10 }, { id: FAN_URA, count: 1 }]),
        fu: 30,
        // Then
        expected: 1,
      },
      {
        name: "base=12, ura=1 → 閾値13まで1枚有効",
        // Given
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 12 }, { id: FAN_URA, count: 1 }]),
        fu: 30,
        // Then
        expected: 1,
      },
      {
        name: "裏ドラを加えても閾値に届かない場合は0",
        // Given: base=5, ura=0 → 裏ドラなし
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 5 }]),
        fu: 30,
        // Then
        expected: 0,
      },
    ])("$name", ({ fanIds, fu, expected }) => {
      // When
      const result = calcEffectiveUraDora(fanIds, fu);

      // Then
      expect(result).toBe(expected);
    });
  });

  describe("条件2: 合計fansが3以下のとき裏ドラ全て有効", () => {
    test.each([
      {
        name: "合計fans=2のとき裏ドラ全て(2枚)が有効",
        // Given: base=1, ura=1, total=2
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 1 }, { id: FAN_URA, count: 1 }]),
        fu: 30,
        // Then
        expected: 1,
      },
      {
        name: "合計fans=3のとき裏ドラ全て(2枚)が有効",
        // Given: base=1, ura=2, total=3
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 1 }, { id: FAN_URA, count: 2 }]),
        fu: 30,
        // Then
        expected: 2,
      },
      {
        name: "合計fans=4のとき条件2は適用されない（fu>=60で条件3も不適用）",
        // Given: base=3, ura=1, total=4, fu=60 → 条件2・3・4いずれも不適用、条件1: total=4<6
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 3 }, { id: FAN_URA, count: 1 }]),
        fu: 60,
        // Then
        expected: 0,
      },
    ])("$name", ({ fanIds, fu, expected }) => {
      // When
      const result = calcEffectiveUraDora(fanIds, fu);

      // Then
      expect(result).toBe(expected);
    });
  });

  describe("条件3: fu<60のとき、fans4以下に上がる全裏ドラが有効", () => {
    test.each([
      {
        name: "fu=50, base=2, ura=2 → fans4以下まで2枚全て有効",
        // Given: base=2, ura=2, fu=50 → min(2, 4-2)=2
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 2 }, { id: FAN_URA, count: 2 }]),
        fu: 50,
        // Then
        expected: 2,
      },
      {
        name: "fu=50, base=1, ura=3 → fans4以下まで3枚全て有効",
        // Given: base=1, ura=3, total=4, fu=50 → 条件3: min(3, 4-1)=3, 条件1: total=4<threshold6→0, max(0,3)=3
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 1 }, { id: FAN_URA, count: 3 }]),
        fu: 50,
        // Then
        expected: 3,
      },
      {
        name: "fu<60でもbaseFans>=4のとき条件3は適用されない",
        // Given: base=4, ura=1, fu=30 → すでに4fans以上なので条件3不適用
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 4 }, { id: FAN_URA, count: 1 }]),
        fu: 30,
        // Then
        expected: 0,
      },
    ])("$name", ({ fanIds, fu, expected }) => {
      // When
      const result = calcEffectiveUraDora(fanIds, fu);

      // Then
      expect(result).toBe(expected);
    });
  });

  describe("条件3': fu>=60のとき、fans3以下に上がる全裏ドラが有効", () => {
    test.each([
      {
        name: "fu=60, base=2, ura=2, total=4 → 条件3'適用: min(2, 3-2)=1",
        // Given: base=2, ura=2, fu=60 → 条件3': min(2, 3-2)=1, 条件1: total=4<threshold6→0, max(0,1)=1
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 2 }, { id: FAN_URA, count: 2 }]),
        fu: 60,
        // Then
        expected: 1,
      },
      {
        name: "仕様例: fu=60, base=2, ura=5, total=7 → 条件1(4)が条件3'(1)より大きい",
        // Given: base=2, ura=5, fu=60 → 条件3': min(5,3-2)=1, 条件1: total=7→threshold[6]→min(5,6-2)=4, max(4,1)=4
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 2 }, { id: FAN_URA, count: 5 }]),
        fu: 60,
        // Then
        expected: 4,
      },
      {
        name: "fu=60でもbaseFans>=3のとき条件3'は適用されない",
        // Given: base=3, ura=1, fu=60 → 条件3'不適用、条件1: total=4<6→0
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 3 }, { id: FAN_URA, count: 1 }]),
        fu: 60,
        // Then
        expected: 0,
      },
    ])("$name", ({ fanIds, fu, expected }) => {
      // When
      const result = calcEffectiveUraDora(fanIds, fu);

      // Then
      expect(result).toBe(expected);
    });
  });

  describe("条件4: ツモ+平和役あり、fans5以下に上がる裏ドラが有効", () => {
    test.each([
      {
        name: "ツモ+平和あり、base=4, ura=1 → fans5以下まで1枚有効",
        // Given: base=4(riichi*2+tsumo+pinfu), ura=1, fu=60 → 条件3'不適用(base>=3), 条件4: min(1,5-4)=1
        fanIds: buildFanIds([
          { id: FAN_RIICHI, count: 2 },
          { id: FAN_TSUMO, count: 1 },
          { id: FAN_PINFU, count: 1 },
          { id: FAN_URA, count: 1 },
        ]),
        fu: 60,
        // Then
        expected: 1,
      },
      {
        name: "ツモ+平和あり、base=2, ura=3 → fans5以下まで3枚有効",
        // Given: base=2(tsumo+pinfu), ura=3, fu=60 → 条件3': min(3,3-2)=1, 条件4: min(3,5-2)=3, max(1,3)=3
        fanIds: buildFanIds([
          { id: FAN_TSUMO, count: 1 },
          { id: FAN_PINFU, count: 1 },
          { id: FAN_URA, count: 3 },
        ]),
        fu: 60,
        // Then
        expected: 3,
      },
      {
        name: "ツモのみ（平和なし）のとき条件4は適用されない",
        // Given: base=4(riichi*3+tsumo), ura=1, fu=60 → 条件3'不適用(base>=3)、条件4不適用(平和なし)
        fanIds: buildFanIds([
          { id: FAN_RIICHI, count: 3 },
          { id: FAN_TSUMO, count: 1 },
          { id: FAN_URA, count: 1 },
        ]),
        fu: 60,
        // Then
        expected: 0,
      },
      {
        name: "平和のみ（ツモなし）のとき条件4は適用されない",
        // Given: base=4(riichi*3+pinfu), ura=1, fu=60 → 条件3'不適用(base>=3)、条件4不適用(ツモなし)
        fanIds: buildFanIds([
          { id: FAN_RIICHI, count: 3 },
          { id: FAN_PINFU, count: 1 },
          { id: FAN_URA, count: 1 },
        ]),
        fu: 60,
        // Then
        expected: 0,
      },
    ])("$name", ({ fanIds, fu, expected }) => {
      // When
      const result = calcEffectiveUraDora(fanIds, fu);

      // Then
      expect(result).toBe(expected);
    });
  });

  describe("条件の組み合わせと優先順位", () => {
    test.each([
      {
        name: "裏ドラが0枚のとき常に0を返す",
        // Given: 裏ドラなし
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 5 }]),
        fu: 30,
        // Then
        expected: 0,
      },
      {
        name: "条件1と条件3が両立するとき大きい方を返す",
        // Given: base=2, ura=4, fu=50 → 条件3: min(4,4-2)=2, 条件1: total=6→threshold6達成→min(4,6-2)=4
        fanIds: buildFanIds([{ id: FAN_RIICHI, count: 2 }, { id: FAN_URA, count: 4 }]),
        fu: 50,
        // Then
        expected: 4,
      },
    ])("$name", ({ fanIds, fu, expected }) => {
      // When
      const result = calcEffectiveUraDora(fanIds, fu);

      // Then
      expect(result).toBe(expected);
    });
  });
});

// ── indicatedToActualDora ────────────────────────────────────────

describe("ドラ表示牌から実際のドラ牌への変換", () => {
  test.each([
    { name: "数牌: 通常の次の数字", indicator: "5s", expected: "6s" },
    { name: "数牌: 9の次は1に戻る", indicator: "9s", expected: "1s" },
    { name: "数牌: 9m の次は 1m", indicator: "9m", expected: "1m" },
    { name: "数牌: 赤牌(0)は5として扱い次は6", indicator: "0m", expected: "6m" },
    { name: "字牌・風牌: 4z(北)の次は 1z(東)", indicator: "4z", expected: "1z" },
    { name: "字牌・風牌: 1z(東)の次は 2z(南)", indicator: "1z", expected: "2z" },
    { name: "字牌・三元牌: 7z(中)の次は 5z(白)", indicator: "7z", expected: "5z" },
    { name: "字牌・三元牌: 5z(白)の次は 6z(発)", indicator: "5z", expected: "6z" },
  ])("$name", ({ indicator, expected }) => {
    // When
    const result = indicatedToActualDora(indicator);

    // Then
    expect(result).toBe(expected);
  });
});

// ── countHaipaiDora ──────────────────────────────────────────────

describe("配牌中のドラ枚数カウント", () => {
  test.each([
    {
      name: "ドラ表示牌なしのとき0を返す",
      // Given
      tiles: ["1m", "2m", "3m"],
      doraIndicators: [],
      // Then
      expected: 0,
    },
    {
      name: "手牌にドラが含まれないとき0を返す",
      // Given: ドラ表示牌5s→ドラ6s、手牌に6sなし
      tiles: ["1m", "2m", "3p"],
      doraIndicators: ["5s"],
      // Then
      expected: 0,
    },
    {
      name: "手牌に通常ドラが1枚含まれるとき1を返す",
      // Given: ドラ表示牌5s→ドラ6s、手牌に6s1枚
      tiles: ["6s", "1m", "2p"],
      doraIndicators: ["5s"],
      // Then
      expected: 1,
    },
    {
      name: "赤牌(0s)はドラ判定1枚+赤ドラ1枚で2枚カウントする",
      // Given: ドラ表示牌4s→ドラ5s、手牌に赤五索(0s)のみ
      tiles: ["0s", "1m", "2p"],
      doraIndicators: ["4s"],
      // Then: 通常ドラ1枚 + 赤1枚 = 2
      expected: 2,
    },
    {
      name: "赤牌(0s)と5sがあるとき通常ドラ2枚+赤1枚で3枚カウントする",
      // Given: ドラ表示牌4s→ドラ5s、手牌に0sと5s
      tiles: ["0s", "5s", "1m"],
      doraIndicators: ["4s"],
      // Then: 通常ドラ2枚 + 赤1枚 = 3
      expected: 3,
    },
    {
      name: "赤牌(0s)・5s・5sがあるとき通常ドラ3枚+赤1枚で4枚カウントする",
      // Given: ドラ表示牌4s→ドラ5s、手牌に0sと5s2枚
      tiles: ["0s", "5s", "5s"],
      doraIndicators: ["4s"],
      // Then: 通常ドラ3枚 + 赤1枚 = 4
      expected: 4,
    },
    {
      name: "複数のドラ表示牌に対して正しくカウントする",
      // Given: ドラ表示牌2種、手牌に各1枚
      tiles: ["6s", "2z", "1m"],
      doraIndicators: ["5s", "1z"],
      // Then
      expected: 2,
    },
  ])("$name", ({ tiles, doraIndicators, expected }) => {
    // When
    const result = countHaipaiDora(tiles, doraIndicators);

    // Then
    expect(result).toBe(expected);
  });
});
