# news-to-x

ニュース RSS を集約し、OpenAI で日本語コメントを生成・カード画像を合成して GitHub Issue で承認 → X（Twitter）へ自動投稿する仕組みです。リポジトリに配置して GitHub Actions を走らせれば運用できます。

## 仕組み概要

1. `feeds.json` に定義した日本のニュース RSS から最新記事を取得します。
2. metascraper で OGP メタデータを抽出し、記事タイトル等を整理します。
3. OpenAI Responses API で安全な短文コメント（最大文字数は `config.yml` で調整可能）を生成し、omni-moderation でチェックします。
4. OGP 画像をライセンスホワイトリストに基づいて取得し、暗幕＋太字テキストを重ねたカードを sharp で合成（条件を満たさない場合は安全カードにフォールバック）。
5. 生成候補を GitHub Issue に画像付きで一覧化。`approve: 1,3` のようなコメントで承認。
6. 承認番号を検出すると X API に画像付きポスト。投稿済み URL は `data/posted.json` で管理し、GitHub Actions がコミットします。
7. X の Refresh Token は毎回更新し、GH_PAT があれば Secrets も自動更新します。

## ディレクトリ構成

```
.
├─ feeds.json              # ユーザーが用意する RSS リスト
├─ config.yml              # 動作設定
├─ data/posted.json        # 投稿履歴（Actions が更新）
├─ src/…                   # TypeScript 実装
├─ scripts/init-x-refresh-token.ts  # X OAuth2 (PKCE) 初期化
└─ .github/workflows/…     # GitHub Actions 定義
```

## 前提

- Node.js 20 以上
- GitHub Actions で `OPENAI_API_KEY`, `X_CLIENT_ID`, `X_CLIENT_SECRET` を Secrets に設定済み
- `GH_PAT` を設定すると X_REFRESH_TOKEN ローテーション時に Secrets を自動更新
- Ubuntu ランナーが Noto CJK フォントを apt で導入可能

## feeds.json のフォーマット

```json
[
  {
    "title": "NHKニュース",
    "url": "https://www3.nhk.or.jp/rss/news/cat0.xml",
    "category": "national"
  },
  {
    "title": "日経テクノロジー",
    "url": "https://www.nikkei.com/tech/rss/",
    "category": "technology"
  }
]
```

- `title`: 表示名
- `url`: RSS フィード URL
- `category`: バランス調整用カテゴリ名（config.yml の `maxPerCategory` に使用）
- JSON 配列で記述します。必要に応じてカテゴリを増やしてください。
- `feeds.json` は `.gitignore` に含めており、リポジトリにコミットしない運用を想定しています。

## config.yml の主な項目

| キー | 説明 |
| --- | --- |
| `maxCandidates` | 1 回の候補数上限 |
| `maxPerCategory` | カテゴリごとの最大件数 |
| `comment.maxChars` | コメント文字数上限（OpenAI 出力後にも丸め） |
| `image.mode` | `publisher_overlay`（OG画像にテキストを重ねる） / `safe`（無地カード） |
| `image.width/height` | カード画像サイズ |
| `image.footer` | 画像右下に描画するテキスト |
| `image.overlay.*` | オーバーレイの暗幕・余白・フォント設定 |
| `image.license.*` | OG画像の許可ドメインや最小サイズなどの安全設定 |
| `filters.blockDomains` | 投稿除外ドメイン（`example.com` など） |
| `filters.blockWords` | タイトル/概要に含まれると除外する語句 |

## Secrets / 環境変数

| 名称 | 必須 | 用途 |
| --- | --- | --- |
| `OPENAI_API_KEY` | ○ | コメント生成・モデレーション |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | ○ | OAuth2 (PKCE) 用 |
| `X_REFRESH_TOKEN` | △ | 投稿時に利用。初回は後述スクリプトで取得 |
| `GH_PAT` | 任意 | X Refresh Token ローテーション時に `gh secret set` を実行 |
| `X_MEDIA_STRATEGY` (env/vars) | 任意 | `v2` / `v1_1` を切替。未設定は `v2` |
| `X_API_KEY` 等 OAuth1.0a | 任意 | v1.1 アップロードに必要（fallback 用） |
| `OPENAI_MODEL` (env/vars) | 任意 | 使用するモデル（既定: `gpt-4o-mini`） |

`.env` などローカル環境で読みたい場合は必要に応じて設定してください。

## X Refresh Token の取得手順

1. `X_CLIENT_ID`, `X_CLIENT_SECRET` を環境変数に設定。
2. `npm install`
3. `npm run init:x`
4. スクリプトが表示する URL をブラウザで開き、許可後に `refresh_token` が出力されます。
5. 得た `X_REFRESH_TOKEN` を GitHub Secrets に登録。（以降 Actions が更新）

## ローカル CLI

- `npm run collect`  
  RSS 取得 → コメント生成 → 画像出力 → `out/latest-metadata.json` を生成。`GITHUB_TOKEN` が無ければ Issue 作成はスキップします。
- `npm run post -- 1`  
  `out/latest-metadata.json` を参照し、番号 1 の候補のみ投稿テストを行います。実際に X へ投稿するため、テスト時は別アカウントやダミー環境で実行してください。
- `npm run build` / `npm run lint` でビルド・静的解析が可能です。

## GitHub Actions ワークフロー

| ファイル | 内容 |
| --- | --- |
| `collect.yml` | 毎日 JST 8:00 (UTC 23:00) に候補を生成し Issue 作成。`workflow_dispatch` で手動起動も可能。 |
| `post.yml` | Issue コメントに `approve:` が含まれると承認番号を解析して自動投稿。投稿成功でチェックボックスを更新し、結果コメントを追記。 |
| `bootstrap.yml` | 初期設定向け。Secrets チェックと `news-proposal` ラベル作成を実施。 |

すべて `concurrency` で同時実行を抑止しています。

## data/posted.json について

- 投稿済み URL の SHA-256 ハッシュと日付、Issue 番号、Tweet ID を保存します。
- GitHub Actions 実行時は自動コミットされるため、ブランチ保護ルールを設定する際はご注意ください。

## トラブルシューティング

- **OpenAI API エラー**: `OPENAI_API_KEY` の権限やモデル指定を再確認。レート制限時はローカルで `npm run collect` を再実行。
- **OG 画像が使われない**: `image.license.allowDomains` に含まれていない場合や、サイズ判定に落ちた場合は安全カードが生成されます。ログにフォールバック理由が出力されるので確認してください。
- **X 投稿失敗**: `X_REFRESH_TOKEN` の有効期限切れ、メディアサイズ超過、テキストのポリシー違反が考えられます。ログ出力を確認してください。
- **GitHub Secrets 更新失敗**: `GH_PAT` に `repo` 権限があるか、Actions ランナーで `gh` CLI が利用可能かを確認。

## セキュリティ・著作権への配慮

- OGP 画像を使う場合でも `image.license.allowDomains` によるホワイトリストと最小サイズ判定で安全側にフォールバックします。利用する際は各媒体の利用規約を確認してください。
- コメント生成はモデレーション済みとはいえ、最終確認者が Issue 上で内容をチェックすることを前提に設計しています。
- 投稿履歴はリポジトリに記録されるため、公開リポジトリの場合は個人情報や非公開記事を扱わないでください。
- OpenAI, Twitter/X API の利用規約・料金プランに従って運用してください。

## 今後の拡張ヒント

- `filters.blockWords` を充実させることでブランドセーフティを向上。
- `maxPerCategory` を調整してバランス良く候補を抽出。
- `X_MEDIA_STRATEGY=v1_1` を設定すると既存の OAuth1.0a 資格情報で投稿可能（環境に応じて切替）。
- `config.yml` の `image.footer` でクレジット表記を変更可能。

セットアップが完了したら `bootstrap` ワークフローを手動実行 → `collect` ワークフローを起動 → Issue で内容確認後 `approve: 1,3` のようにコメントして運用を開始してください。
