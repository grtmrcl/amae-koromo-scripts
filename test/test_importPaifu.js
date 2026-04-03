"use strict";

const fs = require("fs");
const path = require("path");
const { buildRecordDataFromJson } = require("../importPaifu");

const PAIFU_DIR = path.join(__dirname, "../paifu");

const NEW_FORMAT_FILE = path.join(PAIFU_DIR, "231119-3df5594f-7191-4d77-a67e-134204cc0b57.json");
const OLD_FORMAT_FILE = path.join(PAIFU_DIR, "200410-392f14ec-7894-4f9c-9461-442347b61771.json");

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

      // Then: null でなく、8局分のラウンドデータが返る
      expect(rounds).not.toBeNull();
      expect(rounds).toHaveLength(8);
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
      // Given: records配列を持つ旧形式 paifu（12局分を含む）
      const { game, data } = loadPaifu(OLD_FORMAT_FILE);

      // When: ラウンドデータを生成する
      const rounds = buildRecordDataFromJson({ data, game });

      // Then: null でなく、12局分のラウンドデータが返る
      expect(rounds).not.toBeNull();
      expect(rounds).toHaveLength(12);
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
