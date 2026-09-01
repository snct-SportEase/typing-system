# typing-system

[![CI](https://github.com/Saku0512/typing-system/actions/workflows/ci.yml/badge.svg)](https://github.com/Saku0512/typing-system/actions/workflows/ci.yml)

秋季スポーツ大会で使用する独自タイピングシステムの開発コンペティション用リポジトリです。

参加者はこのリポジトリをForkし、自分のFork上でシステムを実装してください。競技の公平性とSportEaseとの互換性を保つため、`docs/`にあるコア仕様、JSON Schema、問題プリセットは共通仕様として扱います。

## 参加方法

1. GitHubの「Fork」から、このリポジトリを自分のアカウントへForkする。
2. ForkしたリポジトリをローカルへCloneする。
3. `main`ブランチを基に、アプリケーション本体と必要なドキュメントを実装する。
4. 提出期限までに、実装済みのForkリポジトリURLを提出する。

このリポジトリへ直接Pushする必要はありません。提出期限や審査日程、必須機能は[RFP](./docs/独自タイピングシステム開発コンペティション%20RFP.md)を確認してください。

## 主要資料

- [提案依頼書（RFP）](./docs/独自タイピングシステム開発コンペティション%20RFP.md)
- [提案依頼書（PDF）](./docs/独自タイピングシステム開発コンペティション%20RFP.pdf)
- [共通仕様の範囲](./docs/typing_system_core_scope.md)
- [運営・試合状況機能仕様](./docs/typing_system_operations_spec.md)
- [入力判定仕様](./docs/typing_system_input_spec.md)
- [スコア計算仕様](./docs/typing_system_scoring_spec.md)
- [問題・問題セット仕様](./docs/typing_system_problem_spec.md)
- [確定結果JSON仕様](./docs/typing_system_results_json_spec.md)
- [共通入力適合テスト](./docs/typing-input-tests-v1.json)
- [本戦・予備問題プリセット](./docs/typing-problem-presets-v1.json)

## SportEaseとの連携

独自タイピングシステムは単体で大会準備、競技進行、結果確定までを行います。3試合終了後、仕様に従った確定結果JSONを出力し、SportEaseへ取り込みます。

## 開発環境

Node.js 24とDocker Composeに対応しています。

```bash
npm install
npm run dev
```

ローカル開発サーバーは`http://localhost:5173`で起動します。

大会名などの環境設定は`.env`から読み込みます。初回は`.env.example`を基に設定してください。

```dotenv
TOURNAMENT_NAME="秋季スポーツ大会 タイピング競技"
ADMIN_USERNAME=admin
ADMIN_PASSWORD=
```

`ADMIN_PASSWORD`にはサンプル値を使わず、環境ごとに固有の長い値を設定してください。本番環境では未設定または旧サンプル値のまま起動できません。

出場クラスは`docs/typing-team-structure-v1.json`を正本とし、個人名は登録しません。出場者は代表選出元（例: `IS2`、`専教`）で識別します。

レーンはチームごとに固定し、1年生から専攻科・教員まで順にレーン1〜6を割り当てます。

管理画面は`/admin`です。Basic認証を使用するため、本番では推測されにくいパスワードへ変更し、HTTPS経由で公開してください。

競技画面は`/competition`、6レーンのモニタリング画面は`/monitoring`です。各競技端末で同じ試合と異なるレーンを選択し、6台すべてを準備完了にすると、サーバー時刻を基準に3秒後から180秒間の競技が始まります。入力は1キーずつサーバーで判定され、モニタリング画面へリアルタイムに反映されます。

現在の競技セッションはサーバーメモリ上で管理されるため、サーバーを再起動すると待機・競技中の状態はリセットされます。

Dockerを使う場合は次のコマンドで起動します。

```bash
docker compose -f docker-compose.dev.yml up --build
```

## 本番環境

```bash
docker compose -f docker-compose.production.yml up -d --build
```

本番サーバーは既定でホストの`127.0.0.1:3000`だけに公開されます。Basic認証の資格情報を保護するため、外部端末から利用する場合はHTTPS対応のリバースプロキシを前段に置いてください。SQLiteデータはComposeの`production_data`ボリュームへ保存されます。

主な確認コマンドは次のとおりです。

```bash
npm run check
npm run lint
npm run test:unit -- --run
npm run test:e2e
```

同じ検証とproductionイメージのビルドは、`main`へのpushとPull RequestでGitHub Actionsから自動実行されます。

## License

[MIT License](./LICENSE)
