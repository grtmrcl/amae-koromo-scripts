"use strict";

const assert = require("assert");

/**
 * 放銃確率算出のための牌別統計データ収集モジュール
 *
 * データ構造:
 *   RonStats[seat][junme][state][tileCategory] = { discarded: number, won: number }
 *
 * - seat: 0-3 (プレイヤー座席)
 * - junme: 1-18 (巡目、整数に丸める)
 * - state: "riichi" | "open" | "other"
 *     - riichi: 立直中（振聴立直含む）
 *     - open: 副露中（聴牌・非聴牌を問わない）
 *     - other: 門前（副露なし・立直なし・聴牌の有無を問わない）
 * - tileCategory: "honor" | "terminals" | "near-terminals" | "middle" | "inner" | "five"
 *
 * 注意:
 * - 副露中プレイヤーは聴牌の有無によらず "open" として扱う。
 *   副露+聴牌を別ステートに分けることは現状の牌譜データからは困難なため。
 * - 門前（other）は聴牌・非聴牌を区別せず全ての門前プレイヤーを対象とする。
 */

const TILE_CATEGORIES = ["honor", "terminals", "near-terminals", "middle", "inner", "five"];
const PLAYER_STATES = ["riichi", "open", "other"];

/**
 * 牌カテゴリを分類する
 * gameAnalyzer.js の validateTile を通過した牌文字列のみを想定する。
 * @param {string} tile - 牌文字列 (例: "1m", "5p", "0s", "3z")
 * @returns {string} tileCategory
 */
function classifyTile(tile) {
  const suit = tile.charAt(1);
  const num = tile.charAt(0);

  // 字牌
  if (suit === "z") {
    return "honor";
  }

  // 数字（0は赤5として扱う）
  const n = num === "0" ? 5 : parseInt(num, 10);

  if (n === 1 || n === 9) return "terminals";
  if (n === 2 || n === 8) return "near-terminals";
  if (n === 3 || n === 7) return "middle";
  if (n === 4 || n === 6) return "inner";
  if (n === 5) return "five"; // 赤5含む

  throw new Error(`Invalid tile: ${tile}`);
}

/**
 * 空のカテゴリ統計オブジェクトを作成する
 * @returns {{ [category: string]: { discarded: number, won: number } }}
 */
function createCategoryStats() {
  const stats = {};
  for (const cat of TILE_CATEGORIES) {
    stats[cat] = { discarded: 0, won: 0 };
  }
  return stats;
}

/**
 * 空の状態統計オブジェクトを作成する
 * @returns {{ [state: string]: { [category: string]: { discarded: number, won: number } } }}
 */
function createStateStats() {
  const stats = {};
  for (const state of PLAYER_STATES) {
    stats[state] = createCategoryStats();
  }
  return stats;
}

/**
 * プレイヤーの手牌状態を判定する
 *
 * 優先順位: 立直 > 副露 > 門前（other）
 * 副露中は聴牌・非聴牌を区別せず "open" として扱う。
 * 門前プレイヤーは聴牌・非聴牌を問わず "other" として扱う。
 *
 * @param {{ 立直?: number, 副露?: number }} playerRound - プレイヤーの現在のラウンドデータ
 * @returns {"riichi" | "open" | "other"} 状態
 */
function classifyPlayerState(playerRound) {
  if (playerRound.立直) return "riichi";
  if (playerRound.副露) return "open";
  return "other";
}

/**
 * 放銃統計コレクター
 * 1局分の処理を追跡し、統計データを収集する
 */
class RonStatsCollector {
  /**
   * @param {number} numPlayers - プレイヤー数 (3 or 4)
   */
  constructor(numPlayers) {
    assert([3, 4].includes(numPlayers), `numPlayers must be 3 or 4, got ${numPlayers}`);
    this._numPlayers = numPlayers;
    // seat → junme → state → category → { discarded, won }
    this._runningStats = Array.from({ length: numPlayers }, () => ({}));
  }

  /**
   * 指定した seat/junme/state/category のエントリを取得（なければ初期化）
   * @private
   */
  _getEntry(seat, junme, state, category) {
    const seatStats = this._runningStats[seat];
    if (!seatStats[junme]) seatStats[junme] = createStateStats();
    return seatStats[junme][state][category];
  }

  /**
   * 牌を切った時のイベントを記録する
   *
   * RecordDiscardTile の処理中（立直フラグ設定後、numDiscarded++ 前）に呼ぶ。
   * 「他のプレイヤーがその牌を切った」を、残りのプレイヤー（手番以外）の視点で記録する。
   *
   * @param {number} discardSeat - 切ったプレイヤーの座席
   * @param {string} tile - 切られた牌
   * @param {number} junme - 現在の巡目（小数の場合は切り上げて整数巡目に丸める）
   * @param {{ 立直?: number, 副露?: number }[]} curRound - 全プレイヤーの現在のラウンドデータ
   */
  recordDiscard(discardSeat, tile, junme, curRound) {
    const category = classifyTile(tile);
    const roundedJunme = Math.ceil(junme);

    for (let seat = 0; seat < this._numPlayers; seat++) {
      if (seat === discardSeat) continue;

      const state = classifyPlayerState(curRound[seat]);
      const entry = this._getEntry(seat, roundedJunme, state, category);
      entry.discarded++;
    }
  }

  /**
   * 和了（ロン）イベントを記録する
   *
   * RecordHule の処理中（放銃確定後）に呼ぶ。
   * junme は放銃牌の RecordDiscardTile 時と同じ巡目を渡すこと
   * （RecordHule 時点では numDiscarded がインクリメント済みのため呼び出し側で調整が必要）。
   *
   * @param {number} huleSeat - 和了したプレイヤーの座席
   * @param {string} tile - 放銃牌
   * @param {number} junme - 放銃牌を切った時点の巡目
   * @param {{ 立直?: number, 副露?: number }[]} curRound - 全プレイヤーの現在のラウンドデータ
   */
  recordRon(huleSeat, tile, junme, curRound) {
    const category = classifyTile(tile);
    const roundedJunme = Math.ceil(junme);

    const state = classifyPlayerState(curRound[huleSeat]);
    const entry = this._getEntry(huleSeat, roundedJunme, state, category);
    entry.won++;
  }

  /**
   * 収集したデータを返す（内部状態への参照を返すため呼び出し後に変更しないこと）
   * @returns {{ [seat: number]: { [junme: number]: { [state: string]: { [category: string]: { discarded: number, won: number } } } } }}
   */
  getStats() {
    return this._runningStats;
  }
}

/**
 * 複数局の統計を集約するためのアキュムレータ
 * ゲーム全体の統計を蓄積し、累積結果を保持する
 */
class RonStatsAccumulator {
  constructor() {
    // { playerId: { junme: { state: { category: { discarded, won } } } } }
    this._stats = {};
  }

  /**
   * 1局分の統計を累積する
   * @param {RonStatsCollector} collector - 局の収集器
   * @param {number[]} accountIds - 座席順のアカウントIDリスト（collector の numPlayers と一致すること）
   */
  accumulate(collector, accountIds) {
    const roundStats = collector.getStats();
    assert(
      roundStats.length === accountIds.length,
      `roundStats.length (${roundStats.length}) !== accountIds.length (${accountIds.length}) — accountIds must have one entry per seat (use null for empty seats)`
    );

    for (let seat = 0; seat < accountIds.length; seat++) {
      const playerId = accountIds[seat];
      if (playerId == null) continue; // 空席はスキップ
      if (!this._stats[playerId]) this._stats[playerId] = {};
      const playerStats = this._stats[playerId];
      const seatStats = roundStats[seat];

      for (const junme of Object.keys(seatStats)) {
        if (!playerStats[junme]) playerStats[junme] = createStateStats();
        const destJunme = playerStats[junme];
        const srcJunme = seatStats[junme];

        for (const state of PLAYER_STATES) {
          for (const category of TILE_CATEGORIES) {
            destJunme[state][category].discarded += srcJunme[state][category].discarded;
            destJunme[state][category].won += srcJunme[state][category].won;
          }
        }
      }
    }
  }

  /**
   * 集約済み統計を返す（内部状態への参照を返すため呼び出し後に変更しないこと）
   * @returns {{ [playerId: number]: { [junme: number]: { [state: string]: { [category: string]: { discarded: number, won: number } } } } }}
   */
  getStats() {
    return this._stats;
  }
}

module.exports = {
  classifyTile,
  classifyPlayerState,
  createCategoryStats,
  createStateStats,
  RonStatsCollector,
  RonStatsAccumulator,
  TILE_CATEGORIES,
  PLAYER_STATES,
};
