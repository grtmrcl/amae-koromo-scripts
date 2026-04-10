"use strict";

jest.mock("../env", () => ({
  COUCHDB_USER: "admin",
  COUCHDB_PASSWORD: "password",
  COUCHDB_PROTO: "http",
  COUCHDB_SERVER: "localhost:5984",
  COUCHDB_URL: "http://admin:password@localhost:5984/majsoul",
}));

const { buildRonStatsOutput, buildRonStatsSelector } = require("../devServer");

// テスト用ヘルパー: 空の state オブジェクト（全巡目空）
const emptyCats = { honor: {}, terminals: {}, "near-terminals": {}, middle: {}, inner: {}, five: {} };
const emptyAllStates = { total: emptyCats, riichi: emptyCats, open: emptyCats, other: emptyCats };

// テスト用ヘルパー: 全カテゴリ同一値の state オブジェクト
function allCats(junme, rate) {
  return Object.fromEntries(["honor", "terminals", "near-terminals", "middle", "inner", "five"].map((c) => [c, { [junme]: rate }]));
}

describe("放銃統計の集計と放銃率への変換", () => {
  test.each([
    {
      name: "ドキュメントが空の場合、全カテゴリ・状態（total含む）で空オブジェクトを返す",
      // Given
      extDocs: [],
      playerIdStr: "100",
      // Then
      expected: emptyAllStates,
    },
    {
      name: "ronStats を持たないドキュメントはスキップされる",
      // Given
      extDocs: [{ ronStats: {} }, {}],
      playerIdStr: "100",
      // Then
      expected: emptyAllStates,
    },
    {
      name: "1件放銃があった巡目で riichi の放銃率と total が正しく計算される",
      // Given
      extDocs: [
        {
          ronStats: {
            "200": {
              "3": {
                riichi: {
                  honor:           { discarded: 10, won: 2 },
                  terminals:       { discarded: 0,  won: 0 },
                  "near-terminals":{ discarded: 0,  won: 0 },
                  middle:          { discarded: 0,  won: 0 },
                  inner:           { discarded: 0,  won: 0 },
                  five:            { discarded: 0,  won: 0 },
                },
                open:   { honor: { discarded: 0, won: 0 }, terminals: { discarded: 0, won: 0 }, "near-terminals": { discarded: 0, won: 0 }, middle: { discarded: 0, won: 0 }, inner: { discarded: 0, won: 0 }, five: { discarded: 0, won: 0 } },
                other: { honor: { discarded: 0, won: 0 }, terminals: { discarded: 0, won: 0 }, "near-terminals": { discarded: 0, won: 0 }, middle: { discarded: 0, won: 0 }, inner: { discarded: 0, won: 0 }, five: { discarded: 0, won: 0 } },
              },
            },
          },
        },
      ],
      playerIdStr: "200",
      // Then: riichi/honor/巡目3 = 2/10 = 0.2、total も同値になる
      expected: {
        total:  { honor: { "3": 0.2 }, terminals: { "3": 0 }, "near-terminals": { "3": 0 }, middle: { "3": 0 }, inner: { "3": 0 }, five: { "3": 0 } },
        riichi: { honor: { "3": 0.2 }, terminals: { "3": 0 }, "near-terminals": { "3": 0 }, middle: { "3": 0 }, inner: { "3": 0 }, five: { "3": 0 } },
        open:   { honor: { "3": 0 }, terminals: { "3": 0 }, "near-terminals": { "3": 0 }, middle: { "3": 0 }, inner: { "3": 0 }, five: { "3": 0 } },
        other: { honor: { "3": 0 }, terminals: { "3": 0 }, "near-terminals": { "3": 0 }, middle: { "3": 0 }, inner: { "3": 0 }, five: { "3": 0 } },
      },
    },
    {
      name: "複数ドキュメントの同じ巡目・カテゴリは加算して集計され total にも反映される",
      // Given
      extDocs: [
        {
          ronStats: {
            "300": {
              "5": {
                other: {
                  honor: { discarded: 4, won: 1 },
                  terminals: { discarded: 0, won: 0 }, "near-terminals": { discarded: 0, won: 0 }, middle: { discarded: 0, won: 0 }, inner: { discarded: 0, won: 0 }, five: { discarded: 0, won: 0 },
                },
                riichi: { honor: { discarded: 0, won: 0 }, terminals: { discarded: 0, won: 0 }, "near-terminals": { discarded: 0, won: 0 }, middle: { discarded: 0, won: 0 }, inner: { discarded: 0, won: 0 }, five: { discarded: 0, won: 0 } },
                open:   { honor: { discarded: 0, won: 0 }, terminals: { discarded: 0, won: 0 }, "near-terminals": { discarded: 0, won: 0 }, middle: { discarded: 0, won: 0 }, inner: { discarded: 0, won: 0 }, five: { discarded: 0, won: 0 } },
              },
            },
          },
        },
        {
          ronStats: {
            "300": {
              "5": {
                other: {
                  honor: { discarded: 6, won: 3 },
                  terminals: { discarded: 0, won: 0 }, "near-terminals": { discarded: 0, won: 0 }, middle: { discarded: 0, won: 0 }, inner: { discarded: 0, won: 0 }, five: { discarded: 0, won: 0 },
                },
                riichi: { honor: { discarded: 0, won: 0 }, terminals: { discarded: 0, won: 0 }, "near-terminals": { discarded: 0, won: 0 }, middle: { discarded: 0, won: 0 }, inner: { discarded: 0, won: 0 }, five: { discarded: 0, won: 0 } },
                open:   { honor: { discarded: 0, won: 0 }, terminals: { discarded: 0, won: 0 }, "near-terminals": { discarded: 0, won: 0 }, middle: { discarded: 0, won: 0 }, inner: { discarded: 0, won: 0 }, five: { discarded: 0, won: 0 } },
              },
            },
          },
        },
      ],
      playerIdStr: "300",
      // Then: other/honor/巡目5 = (1+3)/(4+6) = 0.4、total も同値
      expected: {
        total:  { honor: { "5": 0.4 }, terminals: { "5": 0 }, "near-terminals": { "5": 0 }, middle: { "5": 0 }, inner: { "5": 0 }, five: { "5": 0 } },
        riichi: { honor: { "5": 0 }, terminals: { "5": 0 }, "near-terminals": { "5": 0 }, middle: { "5": 0 }, inner: { "5": 0 }, five: { "5": 0 } },
        open:   { honor: { "5": 0 }, terminals: { "5": 0 }, "near-terminals": { "5": 0 }, middle: { "5": 0 }, inner: { "5": 0 }, five: { "5": 0 } },
        other: { honor: { "5": 0.4 }, terminals: { "5": 0 }, "near-terminals": { "5": 0 }, middle: { "5": 0 }, inner: { "5": 0 }, five: { "5": 0 } },
      },
    },
    {
      name: "discarded が 0 の巡目は rate=0 として出力され total にも反映される",
      // Given
      extDocs: [
        {
          ronStats: {
            "400": {
              "2": {
                riichi: {
                  honor: { discarded: 0, won: 0 },
                  terminals: { discarded: 0, won: 0 }, "near-terminals": { discarded: 0, won: 0 }, middle: { discarded: 0, won: 0 }, inner: { discarded: 0, won: 0 }, five: { discarded: 0, won: 0 },
                },
                open:   { honor: { discarded: 0, won: 0 }, terminals: { discarded: 0, won: 0 }, "near-terminals": { discarded: 0, won: 0 }, middle: { discarded: 0, won: 0 }, inner: { discarded: 0, won: 0 }, five: { discarded: 0, won: 0 } },
                other: { honor: { discarded: 0, won: 0 }, terminals: { discarded: 0, won: 0 }, "near-terminals": { discarded: 0, won: 0 }, middle: { discarded: 0, won: 0 }, inner: { discarded: 0, won: 0 }, five: { discarded: 0, won: 0 } },
              },
            },
          },
        },
      ],
      playerIdStr: "400",
      // Then: 全 discarded=0 なので rate=0 で出力
      expected: {
        total:  allCats("2", 0),
        riichi: allCats("2", 0),
        open:   allCats("2", 0),
        other: allCats("2", 0),
      },
    },
    {
      name: "riichi と other に両方データがある場合、total は両者を合算して計算される",
      // Given
      extDocs: [
        {
          ronStats: {
            "500": {
              "4": {
                riichi: {
                  honor: { discarded: 10, won: 1 },
                  terminals: { discarded: 0, won: 0 }, "near-terminals": { discarded: 0, won: 0 }, middle: { discarded: 0, won: 0 }, inner: { discarded: 0, won: 0 }, five: { discarded: 0, won: 0 },
                },
                other: {
                  honor: { discarded: 20, won: 4 },
                  terminals: { discarded: 0, won: 0 }, "near-terminals": { discarded: 0, won: 0 }, middle: { discarded: 0, won: 0 }, inner: { discarded: 0, won: 0 }, five: { discarded: 0, won: 0 },
                },
                open: { honor: { discarded: 0, won: 0 }, terminals: { discarded: 0, won: 0 }, "near-terminals": { discarded: 0, won: 0 }, middle: { discarded: 0, won: 0 }, inner: { discarded: 0, won: 0 }, five: { discarded: 0, won: 0 } },
              },
            },
          },
        },
      ],
      playerIdStr: "500",
      // Then: total/honor/巡目4 = (1+4)/(10+20) = 5/30 ≈ 0.1667
      expected: {
        total:  { honor: { "4": 5 / 30 }, terminals: { "4": 0 }, "near-terminals": { "4": 0 }, middle: { "4": 0 }, inner: { "4": 0 }, five: { "4": 0 } },
        riichi: { honor: { "4": 0.1 },   terminals: { "4": 0 }, "near-terminals": { "4": 0 }, middle: { "4": 0 }, inner: { "4": 0 }, five: { "4": 0 } },
        open:   { honor: { "4": 0 },     terminals: { "4": 0 }, "near-terminals": { "4": 0 }, middle: { "4": 0 }, inner: { "4": 0 }, five: { "4": 0 } },
        other: { honor: { "4": 0.2 },   terminals: { "4": 0 }, "near-terminals": { "4": 0 }, middle: { "4": 0 }, inner: { "4": 0 }, five: { "4": 0 } },
      },
    },
  ])("$name", ({ extDocs, playerIdStr, expected }) => {
    // When
    const result = buildRonStatsOutput(extDocs, playerIdStr);

    // Then
    expect(result).toEqual(expected);
  });
});

describe("放銃統計クエリの日付条件構築", () => {
  test.each([
    {
      name: "日付指定なしの場合、start_time 条件なしで全期間を対象とする",
      // Given
      playerIdStr: "100",
      startDateStr: undefined,
      endDateStr: undefined,
      // Then
      expected: { selector: { "ronStats.100": { $exists: true } } },
    },
    {
      name: "開始・終了日付を指定した場合、秒単位の start_time 範囲条件が付与される",
      // Given
      playerIdStr: "200",
      startDateStr: "1000000000000", // 1000000000 秒
      endDateStr: "2000000000000",   // 2000000000 秒
      // Then
      expected: {
        selector: {
          "ronStats.200": { $exists: true },
          start_time: { $gte: 1000000000, $lt: 2000000000 },
        },
      },
    },
    {
      name: "開始日付のみ指定した場合、終了は現在時刻として start_time 条件が付与される",
      // Given
      playerIdStr: "300",
      startDateStr: "1000000000000",
      endDateStr: undefined,
      // Then: start_time.$gte が設定され、$lt は現在時刻以上であること（動的なので存在確認のみ）
      expected: null, // 動的値のため個別検証
    },
    {
      name: "開始日付 > 終了日付の場合、自動的にスワップして正しい範囲になる",
      // Given
      playerIdStr: "400",
      startDateStr: "2000000000000",
      endDateStr: "1000000000000",
      // Then
      expected: {
        selector: {
          "ronStats.400": { $exists: true },
          start_time: { $gte: 1000000000, $lt: 2000000000 },
        },
      },
    },
    {
      name: "日付として解析できない文字列を指定した場合、エラーが返る",
      // Given
      playerIdStr: "500",
      startDateStr: "invalid",
      endDateStr: undefined,
      // Then
      expected: { error: "invalid_date" },
    },
  ])("$name", ({ playerIdStr, startDateStr, endDateStr, expected }) => {
    // When
    const result = buildRonStatsSelector(playerIdStr, startDateStr, endDateStr);

    // Then
    if (expected === null) {
      // 開始日付のみ指定のケース: $gte が startDateStr 由来の値、$lt が現在時刻以上であることを確認
      expect(result.selector["ronStats.300"]).toEqual({ $exists: true });
      expect(result.selector.start_time.$gte).toBe(1000000000);
      expect(result.selector.start_time.$lt).toBeGreaterThanOrEqual(Math.ceil(Date.now() / 1000) - 5);
    } else {
      expect(result).toEqual(expected);
    }
  });
});
