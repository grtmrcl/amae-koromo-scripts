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
      isTenpai: false,
      expected: "riichi",
    },
    {
      name: "立直かつ黙聴フラグありでも riichi が優先",
      playerRound: { 立直: 1 },
      isTenpai: true,
      expected: "riichi",
    },
    {
      name: "副露中は open",
      playerRound: { 副露: 1 },
      isTenpai: false,
      expected: "open",
    },
    {
      name: "副露かつ黙聴フラグありでも open が優先",
      playerRound: { 副露: 2 },
      isTenpai: true,
      expected: "open",
    },
    {
      name: "立直なし・副露なし・黙聴フラグありは tenpai",
      playerRound: {},
      isTenpai: true,
      expected: "tenpai",
    },
    {
      name: "立直なし・副露なし・黙聴フラグなしは null（非聴牌）",
      playerRound: {},
      isTenpai: false,
      expected: null,
    },
    {
      name: "振聴中は isTenpai=false で渡すため null（カウント対象外）",
      playerRound: {},
      isTenpai: false,
      expected: null,
    },
  ])("$name", ({ playerRound, isTenpai, expected }) => {
    expect(classifyPlayerState(playerRound, isTenpai)).toBe(expected);
  });
});

// ── RonStatsCollector ───────────────────────────────────────────

describe("放銃統計コレクター", () => {
  describe("切り牌の記録", () => {
    test.each([
      {
        name: "非聴牌のプレイヤーは記録されない",
        discardSeat: 0,
        tile: "3z",
        junme: 1,
        curRound: [{}, {}, {}, {}], // 全員非聴牌
        tenpaiFlags: [false, false, false, false],
        expectedSeat1: { discarded: 0, won: 0 },
      },
      {
        name: "立直中のプレイヤーに字牌が切られた場合に記録される",
        discardSeat: 0,
        tile: "3z",
        junme: 1,
        curRound: [{}, { 立直: 1 }, {}, {}],
        tenpaiFlags: [false, false, false, false],
        expectedSeat1: { discarded: 1, won: 0 },
      },
      {
        name: "副露中のプレイヤーに1,9牌が切られた場合に記録される",
        discardSeat: 2,
        tile: "1p",
        junme: 2,
        curRound: [{ 副露: 1 }, {}, {}, {}],
        tenpaiFlags: [false, false, false, false],
        expectedSeat0: { discarded: 1, won: 0 },
      },
      {
        name: "黙聴中のプレイヤーに5牌（赤5）が切られた場合に記録される",
        discardSeat: 1,
        tile: "0m",
        junme: 3.5,
        curRound: [{}, {}, {}, {}],
        tenpaiFlags: [false, false, false, true], // seat3が黙聴
        expectedSeat3: { discarded: 1, won: 0 },
      },
      {
        name: "切ったプレイヤー自身は記録されない",
        discardSeat: 0,
        tile: "1z",
        junme: 1,
        curRound: [{ 立直: 1 }, { 立直: 2 }, {}, {}],
        tenpaiFlags: [false, false, false, false],
        expectedSeat0: { discarded: 0, won: 0 }, // seat0は切り手なので増えない
        expectedSeat1: { discarded: 1, won: 0 }, // seat1（立直）は増える
      },
    ])("$name", ({ discardSeat, tile, junme, curRound, tenpaiFlags, expectedSeat0, expectedSeat1, expectedSeat3 }) => {
      // Given
      const collector = new RonStatsCollector(4);

      // When
      collector.recordDiscard(discardSeat, tile, junme, curRound, tenpaiFlags);

      // Then
      const stats = collector.getStats();
      const category = classifyTile(tile);
      const junmeCeil = Math.ceil(junme);

      if (expectedSeat0 !== undefined) {
        const state = classifyPlayerState(curRound[0], tenpaiFlags[0]);
        if (state) {
          expect(stats[0]?.[junmeCeil]?.[state]?.[category] ?? { discarded: 0, won: 0 }).toEqual(expectedSeat0);
        } else {
          expect(stats[0]?.[junmeCeil]).toBeUndefined();
        }
      }
      if (expectedSeat1 !== undefined) {
        const state = classifyPlayerState(curRound[1], tenpaiFlags[1]);
        if (state) {
          expect(stats[1]?.[junmeCeil]?.[state]?.[category] ?? { discarded: 0, won: 0 }).toEqual(expectedSeat1);
        } else {
          expect(stats[1]?.[junmeCeil]).toBeUndefined();
        }
      }
      if (expectedSeat3 !== undefined) {
        const state = classifyPlayerState(curRound[3], tenpaiFlags[3]);
        if (state) {
          expect(stats[3]?.[junmeCeil]?.[state]?.[category] ?? { discarded: 0, won: 0 }).toEqual(expectedSeat3);
        } else {
          expect(stats[3]?.[junmeCeil]).toBeUndefined();
        }
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
        tenpaiFlags: [false, false, false, false],
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
        tenpaiFlags: [false, false, false, false],
        expectedEntry: { discarded: 0, won: 1 },
        state: "open",
        category: "terminals",
      },
      {
        name: "黙聴中に放銃した場合に won が記録される",
        ronSeat: 2,
        tile: "4m",
        junme: 3,
        curRound: [{}, {}, {}, {}],
        tenpaiFlags: [false, false, true, false],
        expectedEntry: { discarded: 0, won: 1 },
        state: "tenpai",
        category: "inner",
      },
    ])("$name", ({ ronSeat, tile, junme, curRound, tenpaiFlags, expectedEntry, state, category }) => {
      // Given
      const collector = new RonStatsCollector(4);

      // When
      collector.recordRon(ronSeat, tile, junme, curRound, tenpaiFlags);

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
      const tenpaiFlags = [false, false, false, false];
      const tile = "2z";
      // seat0 が巡目1.0 で切り、seat1（立直）が放銃
      const discardJunme = 1.0; // numDiscarded=0, numPlayers=4 → 0/4+1=1.0

      // When
      collector.recordDiscard(0, tile, discardJunme, curRound, tenpaiFlags);
      // recordRon は numDiscarded++ 後なので (numDiscarded-1)/numPlayers+1 = (1-1)/4+1 = 1.0
      collector.recordRon(1, tile, discardJunme, curRound, tenpaiFlags);

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
    collector1.recordDiscard(0, "1z", 1, curRound1, [false, false, false, false]);
    accumulator.accumulate(collector1, accountIds);

    // 2局目（同じプレイヤーが同じ座席・同じ状態）
    const collector2 = new RonStatsCollector(4);
    const curRound2 = [{}, { 立直: 2 }, {}, {}];
    collector2.recordDiscard(0, "1z", 1, curRound2, [false, false, false, false]);
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
