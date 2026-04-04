"use strict";

// extApi.js が依存する外部モジュールをモック
jest.mock("newrelic", () => ({}), { virtual: true });
jest.mock("@sentry/node", () => ({ init: () => {}, Handlers: { requestHandler: () => (req, res, next) => next() } }), { virtual: true });
jest.mock("../dbExtension", () => ({ createFinalReducer: async () => () => {}, createRenderer: async () => () => ({}) }), { virtual: true });
jest.mock("../couchStorage", () => ({ generateCompressedId: () => "" }), { virtual: true });
jest.mock("../env", () => ({
  COUCHDB_USER: "test",
  COUCHDB_PASSWORD: "test",
  COUCHDB_PROTO: "http",
  COUCHDB_SERVER: "localhost:5984",
  PLAYER_SERVERS: {},
}), { virtual: true });

const { getDbModeKey } = require("../extApi");

describe("DBモードキーの抽出", () => {
  test.each([
    {
      name: "基本DB名からデフォルトキーを取得できる",
      // Given
      dbName: "majsoul_basic",
      // Then
      expected: "_",
    },
    {
      name: "金ルームDBからgoldキーを取得できる",
      // Given
      dbName: "majsoul_gold_basic",
      // Then
      expected: "_gold",
    },
    {
      name: "三麻DBからsanmaキーを取得できる",
      // Given
      dbName: "majsoul_sanma_basic",
      // Then
      expected: "_sanma",
    },
    {
      name: "4人友人戦DBからfriendキーを取得できる",
      // Given
      dbName: "majsoul_friend_basic",
      // Then
      expected: "_friend",
    },
    {
      name: "3人友人戦DBからfriend3キーを取得できる",
      // Given
      dbName: "majsoul_friend3_basic",
      // Then
      expected: "_friend3",
    },
    {
      name: "特殊ルール友人戦DBからfriend_specialキーを取得できる（アンダースコアが複数あっても正しく抽出できる）",
      // Given
      dbName: "majsoul_friend_special_basic",
      // Then
      expected: "_friend_special",
    },
    {
      name: "不正なDB名の場合はnullを返す",
      // Given
      dbName: "invalid_db_name",
      // Then
      expected: null,
    },
    {
      name: "basicサフィックスがないDB名の場合はnullを返す",
      // Given
      dbName: "majsoul_friend",
      // Then
      expected: null,
    },
  ])('$name', ({ dbName, expected }) => {
    // When
    const result = getDbModeKey(dbName);

    // Then
    expect(result).toBe(expected);
  });
});
