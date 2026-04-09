#!./node_modules/.bin/ts-node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
exports.MajsoulGameAnalyzer = void 0;
var assert_1 = require("assert");
assert_1["default"] = assert_1["default"] || assert_1;
var protobufjs_1 = require("protobufjs");
var fs_1 = require("fs");
var majsoulPb_1 = require("./majsoulPb");
var shanten_1 = require("./shanten");
var entryPoint_1 = require("./entryPoint");
var TILE_RE = /^([0-9][mps]|[1-7]z)$/;
var KITA = "4z";
function isValidTile(tile) {
    return TILE_RE.test(tile);
}
function validateTile(tile) {
    if (!isValidTile(tile)) {
        throw new Error("Invalid tile: ".concat(tile));
    }
    return tile;
}
function isEquivantTile(a, b) {
    if (a === b) {
        return true;
    }
    if (a.charAt(1) !== b.charAt(1)) {
        return false;
    }
    return ["0", "5"].includes(a.charAt(0)) && ["0", "5"].includes(b.charAt(0));
}
function tilesToHaiArr(tiles) {
    var ret = [
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
    ];
    var INDEXER = "mpsz";
    for (var _i = 0, tiles_1 = tiles; _i < tiles_1.length; _i++) {
        var tile = tiles_1[_i];
        var n = parseInt(tile.charAt(0), 10);
        var type = tile.charAt(1);
        if (type === "z") {
            (0, assert_1["default"])(n >= 1 && n <= 7);
        }
        else {
            if (n === 0) {
                n = 5;
            }
            (0, assert_1["default"])(n >= 1 && n <= 9);
        }
        var typeIndex = INDEXER.indexOf(type);
        (0, assert_1["default"])(typeIndex >= 0);
        ret[typeIndex][n - 1]++;
        (0, assert_1["default"])(ret[typeIndex][n - 1] <= 4);
    }
    return ret;
}
var TileBin = /** @class */ (function () {
    function TileBin() {
        this._tiles = {};
    }
    TileBin.prototype.put = function (tile) {
        if (/^0[mps]$/.test(tile)) {
            tile = ("5" + tile.charAt(1));
        }
        this._tiles[tile] = (this._tiles[tile] || 0) + 1;
        (0, assert_1["default"])(this._tiles[tile] <= 4);
    };
    TileBin.prototype.getNum = function (tile) {
        if (/^0[mps]$/.test(tile)) {
            tile = ("5" + tile.charAt(1));
        }
        return this._tiles[tile] || 0;
    };
    return TileBin;
}());
var Player = /** @class */ (function () {
    function Player(hand) {
        (0, assert_1["default"])(hand.length === 13 || hand.length === 14);
        this._hand = hand;
        this._opened = [];
        this._discarded = [];
    }
    Player.prototype.deal = function (tile) {
        assert_1["default"].equal(this._hand.length % 3, 1);
        this._hand.push(tile);
    };
    Player.prototype.discard = function (tile) {
        assert_1["default"].equal(this._hand.length % 3, 2);
        var index = this._hand.indexOf(tile);
        if (index === -1) {
            throw new Error("Not in hand: ".concat(tile));
        }
        this._discarded.push(tile);
        this._hand.splice(index, 1);
    };
    Player.prototype.kita = function () {
        var tile = KITA;
        assert_1["default"].equal(this._hand.length % 3, 2);
        var index = this._hand.indexOf(tile);
        if (index === -1) {
            throw new Error("Not in hand: ".concat(tile));
        }
        this._opened.push({ hand: [tile] });
        this._hand.splice(index, 1);
    };
    Player.prototype.open = function (tile, handTiles) {
        assert_1["default"].equal(this._hand.length % 3, 1);
        (0, assert_1["default"])(handTiles.length === 2 || handTiles.length === 3);
        for (var _i = 0, handTiles_1 = handTiles; _i < handTiles_1.length; _i++) {
            var handTile = handTiles_1[_i];
            var index = this._hand.indexOf(handTile);
            if (index === -1) {
                throw new Error("Not in hand: ".concat(handTile));
            }
            this._hand.splice(index, 1);
        }
        this._opened.push({ hand: handTiles, discard: tile });
    };
    Player.prototype.kan = function (tile) {
        assert_1["default"].equal(this._hand.length % 3, 2);
        var meld = this._opened.find(function (x) {
            return x.hand.length === 2 &&
                x.discard &&
                isEquivantTile(x.discard, tile) &&
                x.hand.every(function (t) { return isEquivantTile(t, tile); });
        });
        if (meld) {
            var index = this._hand.indexOf(tile);
            if (index === -1) {
                throw new Error("Not in hand: ".concat(tile));
            }
            meld.hand.push(tile);
            this._hand.splice(index, 1);
        }
        else {
            var meld_1 = [];
            for (var i = 0; i < 4; i++) {
                var index = this._hand.findIndex(function (x) { return isEquivantTile(x, tile); });
                if (index === -1) {
                    throw new Error("Not in hand: ".concat(tile));
                }
                meld_1.push(this._hand[index]);
                this._hand.splice(index, 1);
            }
            this._opened.push({ hand: meld_1 });
        }
    };
    Player.prototype.syanten = function () {
        return (0, shanten_1.calcShanten)(this._hand);
    };
    Player.prototype.isKokushiTenpai = function () {
        if (this._hand.length !== 13) {
            return false;
        }
        var tiles = {};
        for (var _i = 0, _a = this._hand; _i < _a.length; _i++) {
            var tile = _a[_i];
            if (!/^([19][mps]|.z)$/.test(tile)) {
                return false;
            }
            tiles[tile] = (tiles[tile] || 0) + 1;
            if (tiles[tile] > 2) {
                return false;
            }
        }
        var entries = Object.entries(tiles);
        return entries.filter(function (_a) {
            var count = _a[1];
            return count === 2;
        }).length <= 1;
    };
    return Player;
}());
var ACCEPTED_RECORD_TYPES = {
    ".lq.RecordDealTile": new majsoulPb_1.lq.RecordDealTile(),
    ".lq.RecordChiPengGang": new majsoulPb_1.lq.RecordChiPengGang(),
    ".lq.RecordDiscardTile": new majsoulPb_1.lq.RecordDiscardTile(),
    ".lq.RecordNoTile": new majsoulPb_1.lq.RecordNoTile(),
    ".lq.RecordHule": new majsoulPb_1.lq.RecordHule(),
    ".lq.RecordBaBei": new majsoulPb_1.lq.RecordBaBei(),
    ".lq.RecordAnGangAddGang": new majsoulPb_1.lq.RecordAnGangAddGang(),
    ".lq.RecordLiuJu": new majsoulPb_1.lq.RecordLiuJu()
};
var MajsoulGameAnalyzer = /** @class */ (function () {
    function MajsoulGameAnalyzer(newRoundRecord) {
        var _a;
        this._latestDoras = [];
        (0, assert_1["default"])([3, 4].includes(newRoundRecord.scores.length));
        var tiles0 = newRoundRecord.tiles0, tiles1 = newRoundRecord.tiles1, tiles2 = newRoundRecord.tiles2, tiles3 = newRoundRecord.tiles3;
        var tiles = [tiles0, tiles1, tiles2, tiles3].slice(0, newRoundRecord.scores.length);
        this._players = tiles.map(function (t) { return new Player(t.map(validateTile)); });
        this._latestDoras = ((_a = newRoundRecord.doras) === null || _a === void 0 ? void 0 : _a.map(validateTile)) || [];
    }
    /**
     * 指定座席のプレイヤーが聴牌しているか判定する。
     * 副露プレイヤーは国士と両立しないため syanten() === 0 のみで判定し、
     * 門前プレイヤーは国士聴牌も考慮する。
     */
    MajsoulGameAnalyzer.prototype.getPlayerTenpai = function (seat) {
        var player = this._players[seat];
        if (player._opened.some(function (m) { return m.discard !== undefined; })) {
            // 副露あり（kita/暗槓を除くチー・ポン・明カン）→ 国士は不可
            return player.syanten() === 0;
        }
        // 門前: 通常聴牌 または 国士聴牌
        return player.syanten() === 0 || player.isKokushiTenpai();
    };
    MajsoulGameAnalyzer.prototype.getRemainingNumTiles = function (seat, tiles) {
        (0, assert_1["default"])(this._latestDoras.length && this._latestDoras.length <= 5);
        var bin = new TileBin();
        for (var _i = 0, _a = this._players; _i < _a.length; _i++) {
            var player = _a[_i];
            player._discarded.forEach(function (x) { return bin.put(x); });
            player._opened.forEach(function (x) { return x.hand.forEach(function (t) { return bin.put(t); }); });
        }
        this._players[seat]._hand.forEach(function (x) { return bin.put(x); });
        this._latestDoras.forEach(function (x) { return bin.put(x); });
        var ret = 0;
        for (var _b = 0, tiles_2 = tiles; _b < tiles_2.length; _b++) {
            var tile = tiles_2[_b];
            ret += 4 - bin.getNum(validateTile(tile));
        }
        return ret;
    };
    MajsoulGameAnalyzer.prototype.processRecord = function (recordName, record) {
        var _a;
        if (!(recordName in ACCEPTED_RECORD_TYPES)) {
            throw new Error("Unknown record: ".concat(recordName));
        }
        (0, assert_1["default"])(!record.dora, "Unexpected dora field, may be old data");
        var doras = record.doras;
        if (doras === null || doras === void 0 ? void 0 : doras.length) {
            this._latestDoras = doras.map(validateTile);
        }
        switch (recordName) {
            case ".lq.RecordDealTile": {
                var r = record;
                (0, assert_1["default"])(typeof r.seat === "number");
                this._players[r.seat].deal(validateTile(r.tile));
                this._pendingTile = undefined;
                break;
            }
            case ".lq.RecordDiscardTile": {
                var r_1 = record;
                (0, assert_1["default"])(typeof r_1.seat === "number");
                var tile = validateTile(r_1.tile);
                this._players[r_1.seat].discard(tile);
                this._pendingTile = tile;
                if ((_a = r_1.tingpais) === null || _a === void 0 ? void 0 : _a.length) {
                    (0, assert_1["default"])(this._players[r_1.seat].syanten() === 0 || this._players[r_1.seat].isKokushiTenpai());
                }
                if (r_1.is_liqi) {
                    (0, assert_1["default"])(r_1.zhenting.length === this._players.length);
                    (0, assert_1["default"])(r_1.zhenting[r_1.seat] ===
                        this._players[r_1.seat]._discarded.some(function (x) {
                            return r_1.tingpais.some(function (t) { return isEquivantTile(validateTile(t.tile), validateTile(x)); });
                        }));
                    this.getRemainingNumTiles(r_1.seat, r_1.tingpais.map(function (x) { return x.tile; }));
                }
                break;
            }
            case ".lq.RecordChiPengGang": {
                var r = record;
                (0, assert_1["default"])(typeof r.seat === "number");
                var tiles = r.tiles.map(validateTile);
                if (!this._pendingTile) {
                    throw new Error("No pending tile");
                }
                if (tiles.length < 3) {
                    throw new Error("Unexpected number of tiles: " + tiles.length);
                }
                var index = tiles.indexOf(this._pendingTile);
                (0, assert_1["default"])(index !== -1);
                tiles.splice(index, 1);
                this._players[r.seat].open(this._pendingTile, tiles);
                this._pendingTile = undefined;
                break;
            }
            case ".lq.RecordBaBei": {
                var r = record;
                (0, assert_1["default"])(typeof r.seat === "number");
                this._players[r.seat].kita();
                this._pendingTile = KITA;
                break;
            }
            case ".lq.RecordAnGangAddGang": {
                var r = record;
                (0, assert_1["default"])(typeof r.seat === "number");
                var tile = validateTile(r.tiles);
                this._players[r.seat].kan(tile);
                this._pendingTile = tile;
                break;
            }
        }
    };
    return MajsoulGameAnalyzer;
}());
exports.MajsoulGameAnalyzer = MajsoulGameAnalyzer;
if (require.main === module) {
    (0, entryPoint_1.wrappedRun)(function () { return __awaiter(void 0, void 0, void 0, function () {
        var root, _i, _a, file, wrappedData, type, msg, gameAnalyzer, _b, _c, actionData, wrappedResult, type_1, record;
        var _d;
        return __generator(this, function (_e) {
            console.log(process.argv[2]);
            root = protobufjs_1.Root.fromJSON(JSON.parse((0, fs_1.readFileSync)("majsoulPb.proto.json", "utf8")));
            for (_i = 0, _a = process.argv.slice(2); _i < _a.length; _i++) {
                file = _a[_i];
                wrappedData = majsoulPb_1.lq.Wrapper.decode((0, fs_1.readFileSync)(file));
                type = root.lookupType(wrappedData.name);
                msg = type.decode(wrappedData.data);
                gameAnalyzer = void 0;
                for (_b = 0, _c = (msg === null || msg === void 0 ? void 0 : msg.actions) || []; _b < _c.length; _b++) {
                    actionData = _c[_b];
                    if (!((_d = actionData.result) === null || _d === void 0 ? void 0 : _d.length)) {
                        continue;
                    }
                    wrappedResult = majsoulPb_1.lq.Wrapper.decode(actionData.result);
                    type_1 = root.lookupType(wrappedResult.name);
                    record = type_1.decode(wrappedResult.data);
                    if (wrappedResult.name === ".lq.RecordNewRound") {
                        gameAnalyzer = new MajsoulGameAnalyzer(record);
                    }
                    else {
                        (0, assert_1["default"])(gameAnalyzer);
                        gameAnalyzer.processRecord(wrappedResult.name, record);
                    }
                }
            }
            return [2 /*return*/];
        });
    }); });
}
//# sourceMappingURL=gameAnalyzer.js.map