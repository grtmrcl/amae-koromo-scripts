"use strict";

const {
  classifyTile,
  classifyPlayerState,
  RonStatsCollector,
  RonStatsAccumulator,
} = require("../ronStats");

// ── classifyTile ────────────────────────────────────────────────

describe("牌カテゴリの分類", () => {
  test.each([
    { name: "東（字牌）", tile: "1z", expected: "honor" },
    { name: "中（字牌）", tile: "7z", expected: "honor" },
    { name: "1m（老頭牌）", tile: "1m", expected: "terminals" },
    { name: "9p（老頭牌）", tile: "9p", expected: "terminals" },
    { name: "2s", tile: "2s", expected: "near-terminals" },
    { name: "8m", tile: "8m", expected: "near-terminals" },
    { name: "3p", tile: "3p", expected: "middle" },
    { name: "7s", tile: "7s", expected: "middle" },
    { name: "4m", tile: "4m", expected: "inner" },
    { name: "6p", tile: "6p", expected: "inner" },
    { name: "5s（通常）", tile: "5s", expected: "five" },
    { name: "0m（赤5）", tile: "0m", expected: "five" },
    { name: "0p（赤5）", tile: "0p", expected: "five" },
    { name: "0s（赤5）", tile: "0s", expected: "five" },
  ])("$name は $expected に分類される", ({ tile, expected }) => {
    expect(classifyTile(tile)).toBe(expected);
  });
});

// ── classifyPlayerState ─────────────────────────────────────────

describe("プレイヤー状態の判定", () => {
  test.each([
    {
      name: "立直中は riichi",
      playerRound: { 立直: 3 },
      expected: "riichi",
    },
    {
      name: "副露中は open（立直なし）",
      playerRound: { 副露: 1 },
      expected: "open",
    },
    {
      name: "立直かつ副露があっても riichi が優先",
      playerRound: { 立直: 1, 副露: 1 },
      expected: "riichi",
    },
    {
      name: "立直なし・副露なしは other（聴牌の有無を問わない）",
      playerRound: {},
      expected: "other",
    },
    {
      name: "非聴牌の門前プレイヤーも other として扱われる",
      playerRound: {},
      expected: "other",
    },
  ])("$name", ({ playerRound, expected }) => {
    expect(classifyPlayerState(playerRound)).toBe(expected);
  });
});

// ── RonStatsCollector ───────────────────────────────────────────

describe("放銃統計コレクター", () => {
  describe("切り牌の記録", () => {
    test.each([
      {
        name: "門前プレイヤー（非聴牌）にも字牌が切られた場合に記録される",
        discardSeat: 0,
        tile: "3z",
        junme: 1,
        curRound: [{}, {}, {}, {}], // 全員門前
        expectedSeat1: { discarded: 1, won: 0 },
        expectedState1: "other",
      },
      {
        name: "立直中のプレイヤーに字牌が切られた場合に記録される",
        discardSeat: 0,
        tile: "3z",
        junme: 1,
        curRound: [{}, { 立直: 1 }, {}, {}],
        expectedSeat1: { discarded: 1, won: 0 },
        expectedState1: "riichi",
      },
      {
        name: "副露中のプレイヤーに1,9牌が切られた場合に記録される",
        discardSeat: 2,
        tile: "1p",
        junme: 2,
        curRound: [{ 副露: 1 }, {}, {}, {}],
        expectedSeat0: { discarded: 1, won: 0 },
        expectedState0: "open",
      },
      {
        name: "門前プレイヤーに5牌（赤5）が切られた場合に記録される",
        discardSeat: 1,
        tile: "0m",
        junme: 3.5,
        curRound: [{}, {}, {}, {}],
        expectedSeat3: { discarded: 1, won: 0 },
        expectedState3: "other",
      },
      {
        name: "切ったプレイヤー自身は記録されない",
        discardSeat: 0,
        tile: "1z",
        junme: 1,
        curRound: [{ 立直: 1 }, { 立直: 2 }, {}, {}],
        expectedSeat0: { discarded: 0, won: 0 },
        expectedState0: "riichi",
        expectedSeat1: { discarded: 1, won: 0 },
        expectedState1: "riichi",
      },
    ])("$name", ({ discardSeat, tile, junme, curRound, expectedSeat0, expectedState0, expectedSeat1, expectedState1, expectedSeat3, expectedState3 }) => {
      // Given
      const collector = new RonStatsCollector(4);

      // When
      collector.recordDiscard(discardSeat, tile, junme, curRound);

      // Then
      const stats = collector.getStats();
      const category = classifyTile(tile);
      const junmeCeil = Math.ceil(junme);

      if (expectedSeat0 !== undefined) {
        expect(stats[0]?.[junmeCeil]?.[expectedState0]?.[category] ?? { discarded: 0, won: 0 }).toEqual(expectedSeat0);
      }
      if (expectedSeat1 !== undefined) {
        expect(stats[1]?.[junmeCeil]?.[expectedState1]?.[category] ?? { discarded: 0, won: 0 }).toEqual(expectedSeat1);
      }
      if (expectedSeat3 !== undefined) {
        expect(stats[3]?.[junmeCeil]?.[expectedState3]?.[category] ?? { discarded: 0, won: 0 }).toEqual(expectedSeat3);
      }
    });
  });

  describe("放銃の記録", () => {
    test.each([
      {
        name: "立直中に放銃した場合に won が記録される",
        ronSeat: 1,
        tile: "5p",
        junme: 2,
        curRound: [{}, { 立直: 1 }, {}, {}],
        expectedEntry: { discarded: 0, won: 1 },
        state: "riichi",
        category: "five",
      },
      {
        name: "副露中に放銃した場合に won が記録される",
        ronSeat: 0,
        tile: "9s",
        junme: 4,
        curRound: [{ 副露: 1 }, {}, {}, {}],
        expectedEntry: { discarded: 0, won: 1 },
        state: "open",
        category: "terminals",
      },
      {
        name: "門前で放銃した場合に won が other として記録される",
        ronSeat: 2,
        tile: "4m",
        junme: 3,
        curRound: [{}, {}, {}, {}],
        expectedEntry: { discarded: 0, won: 1 },
        state: "other",
        category: "inner",
      },
    ])("$name", ({ ronSeat, tile, junme, curRound, expectedEntry, state, category }) => {
      // Given
      const collector = new RonStatsCollector(4);

      // When
      collector.recordRon(ronSeat, tile, junme, curRound);

      // Then
      const stats = collector.getStats();
      expect(stats[ronSeat][junme][state][category]).toEqual(expectedEntry);
    });
  });

  describe("discarded と won の巡目一致", () => {
    test("同一巡目に切られた牌で放銃した場合、discarded と won が同じ巡目バケツに記録される", () => {
      // Given
      const collector = new RonStatsCollector(4);
      const curRound = [{}, { 立直: 1 }, {}, {}];
      const tile = "2z";
      // seat0 が巡目1.0 で切り、seat1（立直）が放銃
      const discardJunme = 1.0; // numDiscarded=0, numPlayers=4 → 0/4+1=1.0

      // When
      collector.recordDiscard(0, tile, discardJunme, curRound);
      // recordRon は numDiscarded++ 後なので (numDiscarded-1)/numPlayers+1 = (1-1)/4+1 = 1.0
      collector.recordRon(1, tile, discardJunme, curRound);

      // Then
      const stats = collector.getStats();
      const junme = Math.ceil(discardJunme);
      expect(stats[1][junme]["riichi"]["honor"]).toEqual({ discarded: 1, won: 1 });
    });
  });
});

// ── RonStatsAccumulator ─────────────────────────────────────────

describe("放銃統計アキュムレータ", () => {
  test("複数局の統計がプレイヤーIDで集約される", () => {
    // Given
    const accountIds = [1001, 1002, 1003, 1004];
    const accumulator = new RonStatsAccumulator();

    // 1局目
    const collector1 = new RonStatsCollector(4);
    const curRound1 = [{}, { 立直: 1 }, {}, {}];
    collector1.recordDiscard(0, "1z", 1, curRound1);
    accumulator.accumulate(collector1, accountIds);

    // 2局目（同じプレイヤーが同じ座席・同じ状態）
    const collector2 = new RonStatsCollector(4);
    const curRound2 = [{}, { 立直: 2 }, {}, {}];
    collector2.recordDiscard(0, "1z", 1, curRound2);
    accumulator.accumulate(collector2, accountIds);

    // Then: プレイヤー1002（seat1）の巡目1・立直・字牌の discarded が累積されている
    const stats = accumulator.getStats();
    expect(stats[1002][1]["riichi"]["honor"]).toEqual({ discarded: 2, won: 0 });
  });

  test("プレイヤー数と accountIds の長さが異なる場合にエラーになる", () => {
    // Given
    const collector = new RonStatsCollector(4);
    const accumulator = new RonStatsAccumulator();

    // When / Then
    expect(() => accumulator.accumulate(collector, [1001, 1002])).toThrow();
  });
});
