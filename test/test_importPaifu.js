"use strict";

const fs = require("fs");
const path = require("path");
const { buildRecordDataFromJson, isStandardDetailRule, getStoreForFriend } = require("../importPaifu");

const PAIFU_DIR = path.join(__dirname, "../paifu");

const NEW_FORMAT_FILE = path.join(PAIFU_DIR, "230520-ae4fa20c-b7a0-4c77-a79d-905b2f5eb9ef.json");
const OLD_FORMAT_FILE = path.join(PAIFU_DIR, "200411-bfad3680-829e-4cd9-8d7d-a6882c0850e4.json");

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
      const rounds = buildRecordDataFromJson({ data, game });

      // Then: null でなく、14局分のラウンドデータが返る
      expect(rounds).not.toBeNull();
      expect(rounds).toHaveLength(14);
    });

    test("各ラウンドに4人分のシートデータが含まれる", () => {
      // Given: 4人打ちの新形式 paifu
      const { game, data } = loadPaifu(NEW_FORMAT_FILE);

      // When: ラウンドデータを生成する
      const rounds = buildRecordDataFromJson({ data, game });

      // Then: 各ラウンドに4人分のデータが含まれる
      for (const round of rounds) {
        expect(round).toHaveLength(4);
      }
    });

    test("各ラウンドに親（亲）が1人いる", () => {
      // Given: 新形式 paifu
      const { game, data } = loadPaifu(NEW_FORMAT_FILE);

      // When: ラウンドデータを生成する
      const rounds = buildRecordDataFromJson({ data, game });

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
      const rounds = buildRecordDataFromJson({ data, game });

      // Then: 各シートに手牌と起手向聴が設定されている
      for (const round of rounds) {
        for (const seat of round) {
          expect(seat.手牌).toBeDefined();
          expect(Array.isArray(seat.手牌)).toBe(true);
          expect(typeof seat.起手向听).toBe("number");
        }
      }
    });
  });

  describe("旧形式（records配列）のpaifu JSONからラウンドデータを生成できる", () => {
    test("ラウンド数が正しく生成される", () => {
      // Given: records配列を持つ旧形式 paifu（11局分を含む）
      const { game, data } = loadPaifu(OLD_FORMAT_FILE);

      // When: ラウンドデータを生成する
      const rounds = buildRecordDataFromJson({ data, game });

      // Then: null でなく、11局分のラウンドデータが返る
      expect(rounds).not.toBeNull();
      expect(rounds).toHaveLength(11);
    });

    test("各ラウンドに4人分のシートデータが含まれる", () => {
      // Given: 4人打ちの旧形式 paifu
      const { game, data } = loadPaifu(OLD_FORMAT_FILE);

      // When: ラウンドデータを生成する
      const rounds = buildRecordDataFromJson({ data, game });

      // Then: 各ラウンドに4人分のデータが含まれる
      for (const round of rounds) {
        expect(round).toHaveLength(4);
      }
    });

    test("各ラウンドに親（亲）が1人いる", () => {
      // Given: 旧形式 paifu
      const { game, data } = loadPaifu(OLD_FORMAT_FILE);

      // When: ラウンドデータを生成する
      const rounds = buildRecordDataFromJson({ data, game });

      // Then: 各ラウンドで親が1人だけ
      for (const round of rounds) {
        const dealers = round.filter((seat) => seat.亲 === true);
        expect(dealers).toHaveLength(1);
      }
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
      const rounds = buildRecordDataFromJson({ data, game });

      // Then: レコードが空なので null が返る
      expect(rounds).toBeNull();
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
      const rounds = buildRecordDataFromJson({ data, game });

      // Then: 有効なレコードがないので null が返る
      expect(rounds).toBeNull();
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
      const rounds = buildRecordDataFromJson({ data, game });

      // Then: レコードが空なので null が返る
      expect(rounds).toBeNull();
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
      const rounds = buildRecordDataFromJson({ data, game });

      // Then: レコードが空なので null が返る
      expect(rounds).toBeNull();
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

  test("4人打ちで非標準ルールのゲームはfriendSpecialストアに振り分けられる", () => {
    // Given: 4人打ちでdora_countが異なる非標準ルール
    const gameData = {
      accounts: [{}, {}, {}, {}],
      config: { mode: { detail_rule: { ...STANDARD_RULE, dora_count: 4 } } },
    };

    const store = getStoreForFriend(makeGroups(), gameData);

    expect(store).toBe("friendSpecial_store");
  });

  test("4人打ちで標準ルールのゲームはfriendストアに振り分けられる", () => {
    // Given: 4人打ちで標準ルール
    const gameData = {
      accounts: [{}, {}, {}, {}],
      config: { mode: { detail_rule: { ...STANDARD_RULE } } },
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
