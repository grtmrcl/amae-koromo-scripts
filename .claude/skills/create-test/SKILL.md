---
name: create-test
description: テストコードを作成・追加するときに使用するスキル。テストファイルの配置、命名規則、テンプレート、実行コマンドを提供する。
---

# テスト作成スキル

## 概要

JavaScript言語でテストコードを作成する際の手順とテンプレートです。

## テストファイルの配置

テストファイルは `__tests__` ディレクトリ以下に `.test.js` サフィックスで作成します。
構造は維持します。
例：lib/handler.js のテストは __tests__/lib/handler.test.js

## テストの構成

**テーブルテスト + Given-When-Then パターン** を採用します。

- テーブルテストで複数のケースを効率的に記述
- 各ケースの構造を Given-When-Then で整理

## テストメソッドの命名

ビジネス上の意味が伝わる名前をつけます。`test.each` のテスト名にもビジネス上の意味が明確になるよう記述します。

| 観点 | ガイドライン |
|------|--------------|
| 対象読者 | 非開発者にも伝わる |
| 内容 | ビジネス上の意味を伝える |
| 禁止 | メソッド名をテスト名に含めない |

## テストコードのテンプレート

```js
const { targetFunction } = require('../../lib/target');

describe('対象機能の説明', () => {
  test.each([
    {
      name: 'ケースの説明（ビジネス上の意味）',
      // Given
      input: { /* テスト入力 */ },
      // Then
      expected: { /* 期待値 */ },
    },
  ])('$name', ({ input, expected }) => {
    // When
    const result = targetFunction(input);

    // Then
    expect(result).toEqual(expected);
  });
});
```

## テストコマンドの例

```bash
npx jest __tests__/lib/handler.test.js --verbose 2>&1
```
