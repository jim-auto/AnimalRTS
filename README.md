# AnimalRTS

AnimalRTS は、動物たちが陸・海・空・深海で戦うブラウザ RTS プロトタイプです。現時点では GitHub Pages でそのまま公開できる最小プレイ可能版として、陸上勢力を操作して海洋勢力の拠点を破壊する構成です。

## 現在の内容

- Vite + TypeScript + Phaser 3
- 1 マップ
- 2 陣営: 陸上勢力 / 海洋勢力
- ユニット選択、移動、攻撃、資源回収、ユニット生産、前線拠点建築
- 拠点ごとの生産キューと生産時間
- 建築中の拠点、作業進捗、完成後の生産/納品解禁
- 簡易敵 AI
- Fog of War
- 地形と移動レイヤー: ground / air / surface / deepsea
- GitHub Actions による GitHub Pages デプロイ

## 操作

- 左クリック: ユニット選択
- 左ドラッグ: 範囲選択
- 右クリック: 移動、敵への攻撃、資源採集
- W/A/S/D または画面端: カメラ移動
- 右側 UI: 食料を使って選択中または近くの拠点に生産キューを追加
- Ant Swarm 選択中に `Build Field Den`: 前線拠点を建築
- 建築現場は Ant Swarm が近くで作業すると完成
- 建築モード中の右クリック: 建築キャンセル

## ローカル起動

```bash
npm install
npm run dev
```

ビルド確認:

```bash
npm run build
```

静的ファイルは `dist/` に出力されます。

## GitHub Pages へのデプロイ

1. このリポジトリを GitHub に push します。
2. GitHub のリポジトリ設定で `Settings > Pages` を開きます。
3. `Build and deployment` の source を `GitHub Actions` にします。
4. `main` ブランチへ push すると `.github/workflows/deploy.yml` が実行され、`dist/` が GitHub Pages に公開されます。

`vite.config.ts` は `base: './'` にしているため、`https://ユーザー名.github.io/リポジトリ名/` のような Pages URL でも動作します。

## ディレクトリ構成

```text
.
├── .github/workflows/deploy.yml
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src
    ├── main.ts
    ├── styles.css
    └── game
        ├── AnimalRTSScene.ts
        ├── types.ts
        └── unitCatalog.ts
```

## ユニット追加

新しい動物ユニットは `src/game/unitCatalog.ts` の `UNIT_DEFS` に追加します。

主な項目:

- `moveLayer`: `ground`, `air`, `surface`, `deepsea`
- `role`: `worker`, `scout`, `soldier`, `siege`, `base`
- `sight`: Fog of War に影響する視界
- `gatherRate`: 資源採集可能ユニットのみ設定
- `buildTime`: 拠点キューでの生産時間
- `constructionTime`: 建物が完成するまでの作業時間
- `attackRange`, `attackDamage`, `attackCooldown`: 戦闘性能

プレイヤーが UI から生産できるユニットは `PLAYER_PRODUCTION` に、AI が生産できるユニットは `AI_PRODUCTION` に追加します。

## 次に拡張しやすい箇所

- グリッド A* 経路探索
- ユニットごとの特殊能力
- 建築予約、複数ワーカーによる建築速度ボーナス
- 群れ AI、フォーメーション、優先ターゲット
- 陸海空深海の相互攻撃ルール
- ECS 化による大量ユニット最適化
