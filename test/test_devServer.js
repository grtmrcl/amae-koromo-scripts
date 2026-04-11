"use strict";

jest.mock("../env", () => ({
  COUCHDB_USER: "admin",
  COUCHDB_PASSWORD: "password",
  COUCHDB_PROTO: "http",
  COUCHDB_SERVER: "localhost:5984",
  COUCHDB_URL: "http://admin:password@localhost:5984/majsoul",
}));

const {
  buildRonStatsOutput,
  buildRonStatsSelector,
  buildExtendedStats,
  getExtendedStatsWithCache,
  EXTENDED_STATS_CACHE,
  extendedStatsCacheKey,
} = require("../devServer");

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

// ── buildExtendedStats: riichi_tsumo_rate ───────────────────────

/**
 * テスト用の最小限の局データを生成するヘルパー
 * @param {object} playerData - seat 0 のプレイヤーデータ
 * @returns {object[]} 局データ（1局・2人分）
 */
function makeKyoku(playerData) {
  return [playerData, {}];
}

describe("立直ツモ率の計算", () => {
  test.each([
    {
      name: "立直和了がない場合は riichi_tsumo_rate が 0 になる",
      // Given: 和了なし
      extDoc: { accounts: [1001], data: [makeKyoku({})] },
      // Then
      expected: 0,
    },
    {
      name: "立直ツモあり: riichi_tsumo_rate = 立直ツモ回数 / 立直和了回数",
      // Given: 立直かつ自摸和了
      extDoc: {
        accounts: [1001],
        data: [makeKyoku({ 立直: 3, 和: [8000, [], 5], 自摸: true })],
      },
      // Then: 1 / 1 = 1.0
      expected: 1.0,
    },
    {
      name: "立直ロン和了のみ: riichi_tsumo_rate = 0",
      // Given: 立直だが自摸ではない（ロン和了）
      extDoc: {
        accounts: [1001],
        data: [makeKyoku({ 立直: 2, 和: [5800, [], 4] })],
      },
      // Then: 0 / 1 = 0
      expected: 0,
    },
    {
      name: "立直ツモ1回・立直ロン1回: riichi_tsumo_rate = 0.5",
      // Given: 立直ツモ1局 + 立直ロン1局
      extDoc: {
        accounts: [1001],
        data: [
          makeKyoku({ 立直: 3, 和: [8000, [], 5], 自摸: true }),
          makeKyoku({ 立直: 2, 和: [5800, [], 4] }),
        ],
      },
      // Then: 1 / 2 = 0.5
      expected: 0.5,
    },
    {
      name: "門前ツモ（立直なし）は riichi_tsumo_rate に含まれない",
      // Given: 立直なしのツモ和了
      extDoc: {
        accounts: [1001],
        data: [makeKyoku({ 和: [2000, [], 3], 自摸: true })],
      },
      // Then: 立直和了 0 回なので 0
      expected: 0,
    },
  ])("$name", ({ extDoc, expected }) => {
    // When
    const result = buildExtendedStats([], [extDoc], 1001, []);

    // Then
    expect(result.riichi_tsumo_rate).toBe(expected);
  });
});


// ── buildExtendedStats: effective_uradora_per_riichi_win ──────────

describe('立直和了あたり有効裏ドラ枚数の計算', () => {
  test.each([
    {
      name: '立直和了がない場合は effective_uradora_per_riichi_win が 0 になる',
      extDoc: { accounts: [1001], data: [makeKyoku({})] },
      expected: 0,
    },
    {
      name: '有効裏ドラが記録されていない立直和了の場合は 0 になる（旧データ互換）',
      extDoc: {
        accounts: [1001],
        data: [makeKyoku({ 立直: 2, 和: [8000, [33], 4] })],
      },
      expected: 0,
    },
    {
      name: '有効裏ドラ1枚の立直和了: 1.0 になる',
      extDoc: {
        accounts: [1001],
        data: [makeKyoku({ 立直: 2, 和: [8000, [33], 4], 有効裏ドラ: 1 })],
      },
      expected: 1,
    },
    {
      name: '2局・有効裏ドラ合計3枚: 1.5 になる',
      extDoc: {
        accounts: [1001],
        data: [
          makeKyoku({ 立直: 2, 和: [8000, [33, 33], 4], 有効裏ドラ: 2 }),
          makeKyoku({ 立直: 3, 和: [5800, [33], 5], 有効裏ドラ: 1 }),
        ],
      },
      expected: 1.5,
    },
    {
      name: '非立直和了の有効裏ドラは集計されない',
      extDoc: {
        accounts: [1001],
        data: [makeKyoku({ 和: [2000, [], 3], 自摸: true, 有効裏ドラ: 2 })],
      },
      expected: 0,
    },
  ])('$name', ({ extDoc, expected }) => {
    // When
    const result = buildExtendedStats([], [extDoc], 1001, []);

    // Then
    expect(result.effective_uradora_per_riichi_win).toBe(expected);
  });
});
// ── extended_stats キャッシュ ────────────────────────────��───────

// fetchExtendedStatsDocs（axios使用）をモックして純粋にキャッシュ動作をテスト
jest.mock("axios", () => ({
  default: {
    post: jest.fn().mockResolvedValue({ data: { docs: [] } }),
  },
}));

describe("extended_stats キャッシュ（stale-while-revalidate）", () => {
  beforeEach(() => {
    EXTENDED_STATS_CACHE.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("初回リクエストはキャッシュに保存され、同一キーの2回目は同じオブジェクトが返る", async () => {
    // Given: キャッシュ空
    const playerId = 9999;
    const modes = [1, 2];
    const startTimeSec = 1262304000;
    const endTimeSec = Math.ceil(Date.now() / 1000);

    // When: 2回リクエスト
    const first = await getExtendedStatsWithCache(playerId, modes, startTimeSec, endTimeSec);
    const second = await getExtendedStatsWithCache(playerId, modes, startTimeSec, endTimeSec);

    // Then: 同一オブジェクト（キャッシュから返された）
    expect(second).toBe(first);
    expect(EXTENDED_STATS_CACHE.has(extendedStatsCacheKey(playerId, modes, startTimeSec))).toBe(true);
  });

  test("TTL 内は axios を再呼び出しせずキャッシュを返す", async () => {
    const axios = require("axios").default;
    const playerId = 8888;
    const modes = [1];
    const startTimeSec = 1262304000;
    const endTimeSec = Math.ceil(Date.now() / 1000);

    // Given: 1回目でキャッシュに保存
    await getExtendedStatsWithCache(playerId, modes, startTimeSec, endTimeSec);
    const callCountAfterFirst = axios.post.mock.calls.length;

    // When: TTL 内に再リクエスト（時間を進めない）
    await getExtendedStatsWithCache(playerId, modes, startTimeSec, endTimeSec);

    // Then: axios は追加呼び出しされていない
    expect(axios.post.mock.calls.length).toBe(callCountAfterFirst);
  });

  test("TTL 経過後はキャッシュ値を即返し、バックグラウンドで更新を開始する", async () => {
    const axios = require("axios").default;
    const playerId = 7777;
    const modes = [1];
    const startTimeSec = 1262304000;
    const endTimeSec = Math.ceil(Date.now() / 1000);

    // Given: キャッシュを温める
    const first = await getExtendedStatsWithCache(playerId, modes, startTimeSec, endTimeSec);
    const callCountAfterWarmup = axios.post.mock.calls.length;

    // TTL を過ぎた時間に進める（5分 + 1ms）
    jest.advanceTimersByTime(5 * 60 * 1000 + 1);

    // When: TTL 切れ後にリクエスト
    const stale = await getExtendedStatsWithCache(playerId, modes, startTimeSec, endTimeSec);

    // Then: 即座に古いキャッシュを返す（同一オブジェクト）
    expect(stale).toBe(first);

    // バックグラウンド更新の Promise が解決されるまで待つ
    await Promise.resolve();
    await Promise.resolve();

    // バックグラウンドで axios が再呼び出しされている
    expect(axios.post.mock.calls.length).toBeGreaterThan(callCountAfterWarmup);
  });
});
