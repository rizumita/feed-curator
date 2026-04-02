# Feed Curator Web UI Guide

## Overview

Feed Curator は AI を活用した RSS フィード キュレーション ツール。Web UI は `bun src/cli.ts serve` で起動し、ブラウザで記事の閲覧・管理ができる。

## Layout

### Sidebar (左側)

| Section | Description |
|---------|-------------|
| **Header** | "Feed Curator" ロゴ + ダークモードトグル + 日付 |
| **Stats Grid** | UNREAD / CURATED / PENDING / FEEDS / ARCHIVED のカウント |
| **Actions** | "Update" ボタン (Fetch → Curate → Briefing の一括実行) |
| **Discover** | トピック入力 + Search ボタンでAIフィード発見 |
| **View** | Briefing / All / Archive / Feeds の切り替え |
| **Category** | フィードカテゴリでフィルター (記事がある場合のみ表示) |
| **Sort** | Newest first / Score first |
| **Filter** | All / Unread only / Read only |
| **Tags** | タグでフィルター (タグがある場合のみ表示) |
| **Sections** | Tier別TOCリンク (Must Read / Recommended / Worth a Look / Low Priority) |

### Main Content (右側)

ビューに応じて以下を表示:

- **Briefing**: AIが生成した今日のブリーフィング (トピック別クラスター)
- **All**: キュレート済み記事をTier別に表示
- **Archive**: dismiss/archive済み記事
- **Feeds**: 登録フィード一覧 (カテゴリ別、削除ボタン付き)

## Views

### Briefing View (デフォルト)
- ブリーフィングが未生成の場合は自動的にAllビューにフォールバック
- フィード未登録時: Welcome画面 + フィード検索UI
- フィード登録済み・キュレート未実施時: "Feeds Ready" + "Update Now" ボタン

### All View
- 記事をスコアに基づく4段階のTierに分類して表示
  - **Must Read** (85-100): 緑
  - **Recommended** (70-85): 青
  - **Worth a Look** (50-70): 黄
  - **Low Priority** (0-50): グレー
- 各記事カード: 既読チェック / スキップ(✕) / タイトルリンク / サマリ / メタ情報 / スコアリング

### Feeds View
- カテゴリ別にフィードを表示
- 各フィードに削除ボタン(×)

## Article Card

```
[☐] [✕]  Article Title (リンク)          [Score Ring]
          Summary text                         90
          Feed Name · Date · tag1 · tag2
```

- **☐**: 既読トグル (クリックで ✓ に変化)
- **✕**: 記事をdismiss (非表示にしてarchiveへ)
- **Score Ring**: 0-100のスコアをリング状に表示、Tierに応じた色

## Theme

3段階テーマ切り替え: auto → light → dark
- LocalStorageに保存 (`theme` key)
- auto: OSの設定に従う

## Server API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | メインページ (HTML) |
| GET | `/api/articles` | キュレート済み記事一覧 (JSON) |
| GET | `/api/feeds` | フィード一覧 (JSON) |
| GET | `/api/briefing` | 今日のブリーフィング (JSON) |
| POST | `/api/update` | Fetch→Curate→Briefing一括実行 (SSE) |
| POST | `/api/fetch` | フィード取得のみ (SSE) |
| POST | `/api/curate` | AIキュレーションのみ (SSE) |
| POST | `/api/briefing/generate` | ブリーフィング生成 (SSE) |
| POST | `/api/discover` | AIフィード発見 (SSE) |
| POST | `/api/discover/register` | 発見したフィードを登録 |
| POST | `/api/read/:id` | 既読トグル |
| POST | `/api/read-batch` | 一括既読 |
| POST | `/api/dismiss/:id` | 記事dismiss |
| POST | `/api/dismiss-batch` | 一括dismiss |
| POST | `/api/config/language` | 言語設定 |
| DELETE | `/api/feeds/:id` | フィード削除 |

## URL Parameters

| Param | Values | Description |
|-------|--------|-------------|
| `view` | `all`, `archive`, `feeds` | ビュー切り替え (未指定=briefing) |
| `sort` | `score` | ソート順 (未指定=newest) |
| `read` | `unread`, `read` | 既読フィルター (クライアント側) |
| `tag` | tag name | タグフィルター (クライアント側) |
| `category` | category name | カテゴリフィルター (クライアント側) |

## Data Flow

```
RSS Feed URLs → fetch → articles (uncurated)
                          ↓
                    AI curate → articles (scored, summarized, tagged)
                          ↓
                    AI briefing → daily briefing (clustered topics)
                          ↓
                    Web UI display
```

## Screenshots

- `tasks/screenshot-all-view-dark.png` - All view (dark mode)
- `tasks/screenshot-all-view-light.png` - All view (light mode)  
- `tasks/screenshot-feeds-view.png` - Feeds view
- `tasks/screenshot-briefing-view.png` - Briefing/onboarding view
