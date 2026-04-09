"use strict";

const { MajsoulGameAnalyzer } = require("../gameAnalyzer");

// 4人打ちのダミー手牌（13枚・非聴牌形）
const DUMMY_HAND = ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p"];

/**
 * MajsoulGameAnalyzer を初期化するためのヘルパー（常に4人打ち）
 * @param {string[]} tiles0 - seat0 の初期手牌（13枚、子）
 * @param {string[]} [tiles1]
 * @param {string[]} [tiles2]
 * @param {string[]} [tiles3]
 */
function createAnalyzer(tiles0, tiles1 = DUMMY_HAND, tiles2 = DUMMY_HAND, tiles3 = DUMMY_HAND) {
  return new MajsoulGameAnalyzer({
    scores: [25000, 25000, 25000, 25000],
    tiles0,
    tiles1,
    tiles2,
    tiles3,
    doras: ["1z"],
  });
}

/** seat0 が dealTile をドロー → discardTile を切る */
function dealAndDiscard(analyzer, dealTile, discardTile) {
  analyzer.processRecord(".lq.RecordDealTile", { seat: 0, tile: dealTile });
  analyzer.processRecord(".lq.RecordDiscardTile", {
    seat: 0,
    tile: discardTile,
    is_liqi: false,
    is_wliqi: false,
    zhenting: [false, false, false, false],
    tingpais: [],
  });
}

// ── 門前プレイヤーの聴牌判定 ────────────────────────────────────

describe("門前プレイヤーの聴牌判定", () => {
  test.each([
    {
      name: "面子4つと雀頭候補の13枚は聴牌と判定される",
      // 123m 456p 789s 123s + 1z（雀頭候補）: 面子4 + 雀頭待ち = syanten 0
      tiles: ["1m","2m","3m","4p","5p","6p","7s","8s","9s","1s","2s","3s","1z"],
      expected: true,
    },
    {
      name: "バラバラの13枚は非聴牌と判定される",
      // 孤立牌ばかりで向聴数が高い手
      tiles: ["1m","3m","5m","7m","9m","1p","3p","5p","7p","9p","1s","3s","5s"],
      expected: false,
    },
    {
      name: "七対子の聴牌形（対子6つ＋単騎）は聴牌と判定される",
      // 11 22 33 44 55 66 + 単騎7m待ち（7mが1枚）
      tiles: ["1m","1m","2m","2m","3m","3m","4m","4m","5m","5m","6m","6m","7m"],
      expected: true,
    },
    {
      name: "国士無双の13種1枚は聴牌と判定される",
      // 1m9m1p9p1s9s1z2z3z4z5z6z7z（13種揃い）
      tiles: ["1m","9m","1p","9p","1s","9s","1z","2z","3z","4z","5z","6z","7z"],
      expected: true,
    },
  ])("$name", ({ tiles, expected }) => {
    // Given: seat0 が 13枚の子手牌
    const analyzer = createAnalyzer(tiles);

    // When: 牌をドロー→切りを経て 13枚の状態にする
    dealAndDiscard(analyzer, "7z", "7z"); // 不要牌を1枚引いて捨てる（13枚を維持）

    // Then
    expect(analyzer.getPlayerTenpai(0)).toBe(expected);
  });
});

// ── 副露プレイヤーの聴牌判定 ────────────────────────────────────

describe("副露プレイヤーの聴牌判定", () => {
  test("ポン後に残り手牌が面子3つ＋単騎待ちの形は聴牌と判定される", () => {
    // Given: seat0 の初期手牌（13枚）
    // 1z1z（ポン用）+ 123m 456p 789s 1s（面子3つ＋単騎待ち候補）
    const initTiles = ["1z","1z","1m","2m","3m","4p","5p","6p","7s","8s","9s","1s","9p"];
    // seat1 が 1z を持つ手牌
    const seat1Tiles = ["1z","2p","3p","4p","5p","6p","7p","8p","9p","1s","2s","3s","4s"];
    const analyzer = createAnalyzer(initTiles, seat1Tiles);

    // seat0 が 9p を切る（初期14枚→13枚、子なのでまずドロー不要）
    // ※ 子は13枚スタートなので先にドローが必要
    analyzer.processRecord(".lq.RecordDealTile", { seat: 0, tile: "4z" });
    analyzer.processRecord(".lq.RecordDiscardTile", { seat: 0, tile: "9p", is_liqi: false, is_wliqi: false, zhenting: [false,false,false,false], tingpais: [] });

    // seat1 が 1z をドロー → 切る（seat0 がポン）
    analyzer.processRecord(".lq.RecordDealTile", { seat: 1, tile: "1z" });
    analyzer.processRecord(".lq.RecordDiscardTile", { seat: 1, tile: "1z", is_liqi: false, is_wliqi: false, zhenting: [false,false,false,false], tingpais: [] });

    // seat0 がポン（1z1z1z 完成、残り手牌: 123m456p789s1s4z = 10枚）
    analyzer.processRecord(".lq.RecordChiPengGang", { seat: 0, tiles: ["1z","1z","1z"] });

    // ポン後に seat0 が 4z を切る（10枚 → 9枚）
    // 残り手牌: 123m 456p 789s 1s = 9枚 → 面子3つ + 単騎待ち = syanten 0
    analyzer.processRecord(".lq.RecordDiscardTile", { seat: 0, tile: "4z", is_liqi: false, is_wliqi: false, zhenting: [false,false,false,false], tingpais: [] });

    // When
    const result = analyzer.getPlayerTenpai(0);

    // Then
    expect(result).toBe(true);
  });

  test("副露後に残り手牌がバラバラの場合は非聴牌と判定される", () => {
    // Given: ポン後も残り手牌がまとまっていない
    const initTiles = ["1z","1z","1m","9m","1p","9p","1s","9s","2z","3z","4z","5z","6z"];
    const seat1Tiles = ["1z","2p","3p","4p","5p","6p","7p","8p","9p","1s","2s","3s","4s"];
    const analyzer = createAnalyzer(initTiles, seat1Tiles);

    analyzer.processRecord(".lq.RecordDealTile", { seat: 0, tile: "4z" });
    analyzer.processRecord(".lq.RecordDiscardTile", { seat: 0, tile: "6z", is_liqi: false, is_wliqi: false, zhenting: [false,false,false,false], tingpais: [] });
    analyzer.processRecord(".lq.RecordDealTile", { seat: 1, tile: "1z" });
    analyzer.processRecord(".lq.RecordDiscardTile", { seat: 1, tile: "1z", is_liqi: false, is_wliqi: false, zhenting: [false,false,false,false], tingpais: [] });
    analyzer.processRecord(".lq.RecordChiPengGang", { seat: 0, tiles: ["1z","1z","1z"] });
    // ポン後 4z 切り、残り: 1m9m1p9p1s9s2z3z4z5z = バラバラ
    analyzer.processRecord(".lq.RecordDiscardTile", { seat: 0, tile: "4z", is_liqi: false, is_wliqi: false, zhenting: [false,false,false,false], tingpais: [] });

    // When
    const result = analyzer.getPlayerTenpai(0);

    // Then
    expect(result).toBe(false);
  });
});

// ── 北抜き（kita）後の聴牌判定 ──────────────────────────────────

describe("北抜き後の聴牌判定", () => {
  test("北抜き後に門前で聴牌形が揃っている場合は聴牌と判定される", () => {
    // Given: 4z（北）を1枚含む手牌 + 残りで聴牌できる構成
    // 初期手牌: 4z + 123m456p789s123s（14枚、親として扱う）
    const initTiles = ["4z","1m","2m","3m","4p","5p","6p","7s","8s","9s","1s","2s","3s","1z"];
    const analyzer = new MajsoulGameAnalyzer({
      scores: [25000, 25000, 25000, 25000],
      tiles0: initTiles, // 14枚（親）
      tiles1: DUMMY_HAND,
      tiles2: DUMMY_HAND,
      tiles3: DUMMY_HAND,
      doras: ["5z"],
    });

    // 北抜き（4z を除く）→ 残り13枚: 123m456p789s123s1z
    analyzer.processRecord(".lq.RecordBaBei", { seat: 0, tile: "4z" });
    // ドロー後に不要牌を切って13枚に: 9z をドローして9z を捨てる
    analyzer.processRecord(".lq.RecordDealTile", { seat: 0, tile: "7z" });
    analyzer.processRecord(".lq.RecordDiscardTile", { seat: 0, tile: "7z", is_liqi: false, is_wliqi: false, zhenting: [false,false,false,false], tingpais: [] });
    // 残り手牌: 123m456p789s123s1z = 13枚 → 面子4 + 単騎1z待ち = 聴牌

    // When
    const result = analyzer.getPlayerTenpai(0);

    // Then
    expect(result).toBe(true);
  });
});
