"use strict";

jest.mock("../env", () => ({
  COUCHDB_USER: "admin",
  COUCHDB_PASSWORD: "password",
  COUCHDB_PROTO: "http",
  COUCHDB_SERVER: "localhost:5984",
  COUCHDB_URL: "http://admin:password@localhost:5984/majsoul",
}));

const { buildRonStatsOutput } = require("../devServer");

describe("放銃統計の集計と放銃率への変換", () => {
  test.each([
    {
      name: "ドキュメントが空の場合、全カテゴリ・状態で空オブジェクトを返す",
      // Given
      extDocs: [],
      playerIdStr: "100",
      // Then
      expected: {
        riichi: { honor: {}, terminals: {}, "near-terminals": {}, middle: {}, inner: {}, five: {} },
        open:   { honor: {}, terminals: {}, "near-terminals": {}, middle: {}, inner: {}, five: {} },
        tenpai: { honor: {}, terminals: {}, "near-terminals": {}, middle: {}, inner: {}, five: {} },
      },
    },
    {
      name: "ronStats を持たないドキュメントはスキップされる",
      // Given
      extDocs: [{ ronStats: {} }, {}],
      playerIdStr: "100",
      // Then
      expected: {
        riichi: { honor: {}, terminals: {}, "near-terminals": {}, middle: {}, inner: {}, five: {} },
        open:   { honor: {}, terminals: {}, "near-terminals": {}, middle: {}, inner: {}, five: {} },
        tenpai: { honor: {}, terminals: {}, "near-terminals": {}, middle: {}, inner: {}, five: {} },
      },
    },
    {
      name: "1件放銃があった巡目のカテゴリで正しい放銃率を返す",
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
                tenpai: { honor: { discarded: 0, won: 0 }, terminals: { discarded: 0, won: 0 }, "near-terminals": { discarded: 0, won: 0 }, middle: { discarded: 0, won: 0 }, inner: { discarded: 0, won: 0 }, five: { discarded: 0, won: 0 } },
              },
            },
          },
        },
      ],
      playerIdStr: "200",
      // Then: riichi/honor/巡目3 = 2/10 = 0.2、同巡目で discarded=0 のカテゴリは rate=0 で出力される
      expected: {
        riichi: {
          honor:           { "3": 0.2 },
          terminals:       { "3": 0 },
          "near-terminals":{ "3": 0 },
          middle:          { "3": 0 },
          inner:           { "3": 0 },
          five:            { "3": 0 },
        },
        open:   { honor: { "3": 0 }, terminals: { "3": 0 }, "near-terminals": { "3": 0 }, middle: { "3": 0 }, inner: { "3": 0 }, five: { "3": 0 } },
        tenpai: { honor: { "3": 0 }, terminals: { "3": 0 }, "near-terminals": { "3": 0 }, middle: { "3": 0 }, inner: { "3": 0 }, five: { "3": 0 } },
      },
    },
    {
      name: "複数ドキュメントの同じ巡目・カテゴリは加算して集計される",
      // Given
      extDocs: [
        {
          ronStats: {
            "300": {
              "5": {
                tenpai: {
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
                tenpai: {
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
      // Then: tenpai/honor/巡目5 = (1+3)/(4+6) = 0.4、同巡目の他カテゴリは rate=0 で出力
      expected: {
        riichi: { honor: { "5": 0 }, terminals: { "5": 0 }, "near-terminals": { "5": 0 }, middle: { "5": 0 }, inner: { "5": 0 }, five: { "5": 0 } },
        open:   { honor: { "5": 0 }, terminals: { "5": 0 }, "near-terminals": { "5": 0 }, middle: { "5": 0 }, inner: { "5": 0 }, five: { "5": 0 } },
        tenpai: {
          honor:           { "5": 0.4 },
          terminals:       { "5": 0 },
          "near-terminals":{ "5": 0 },
          middle:          { "5": 0 },
          inner:           { "5": 0 },
          five:            { "5": 0 },
        },
      },
    },
    {
      name: "discarded が 0 の巡目は rate=0 として出力される",
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
                tenpai: { honor: { discarded: 0, won: 0 }, terminals: { discarded: 0, won: 0 }, "near-terminals": { discarded: 0, won: 0 }, middle: { discarded: 0, won: 0 }, inner: { discarded: 0, won: 0 }, five: { discarded: 0, won: 0 } },
              },
            },
          },
        },
      ],
      playerIdStr: "400",
      // Then: 全 discarded=0 なので全巡目が rate=0 として出力される
      expected: {
        riichi: { honor: { "2": 0 }, terminals: { "2": 0 }, "near-terminals": { "2": 0 }, middle: { "2": 0 }, inner: { "2": 0 }, five: { "2": 0 } },
        open:   { honor: { "2": 0 }, terminals: { "2": 0 }, "near-terminals": { "2": 0 }, middle: { "2": 0 }, inner: { "2": 0 }, five: { "2": 0 } },
        tenpai: { honor: { "2": 0 }, terminals: { "2": 0 }, "near-terminals": { "2": 0 }, middle: { "2": 0 }, inner: { "2": 0 }, five: { "2": 0 } },
      },
    },
  ])("$name", ({ extDocs, playerIdStr, expected }) => {
    // When
    const result = buildRonStatsOutput(extDocs, playerIdStr);

    // Then
    expect(result).toEqual(expected);
  });
});
