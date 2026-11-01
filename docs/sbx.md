# 開発用サンドボックス（sbx / Docker Sandboxes）

Muse Code と Playwright（Node）が使える sandbox の利用・構築手順。
AI が「dev サーバ起動 → headless Chromium で操作・スクショ →
エラー確認・修正」のループを自律実行できる。
見た目の検証が必要な作業（群衆描画・スタイル・POV 等）用。

注意: headless Chromium はソフトウェア GL 描画のため、見た目の正しさは
検証できるが動作の軽さの判断には使えない。

## 日常利用

```bash
# 対話セッションを開く（停止中なら自動起動する）
sbx run --name muse-code-mfsim

# 単発コマンドの実行例
sbx exec muse-code-mfsim bash -c 'muse --version; playwright --version'
```

sandbox 内の前提知識:

- プロジェクトはホストと同じパス（`/home/hisayan/projects/mfsim`）に
  マウントされる。`~/workspace` ではない。
- Playwright は Node 版（1.61.1）。スクリプト例は `~/pw-smoke/` にある。
- 単発の `sbx exec` は終了時に子プロセス（dev サーバ等）も道連れに
  終了する。dev サーバ＋検証は 1 回の `exec` にまとめるか、
  対話セッションの中で実行する。

dev サーバ起動から疎通確認までの一括実行例:

```bash
sbx exec muse-code-mfsim bash -c '
  cd /home/hisayan/projects/mfsim &&
  (npm run dev > /tmp/vp-dev.log 2>&1 &) &&
  for i in $(seq 1 30); do sleep 2;
    curl -sf -o /dev/null http://localhost:5173/ && break; done &&
  curl -s -o /dev/null -w "dev server HTTP %{http_code}\n" http://localhost:5173/'
```

## 作り直し（テンプレートから再作成）

muse + Playwright 導入済みのスナップショットを保存してある。
sandbox を壊した・消した場合はここから再作成する。

```bash
sbx create --name muse-pw --pull never \
  -t docker.io/library/muse-playwright-mfsim:v1 \
  docker.io/olegselajev241/muse-code-sbx-kit:latest .

# 認証の引き継ぎ（必須。テンプレート内のキーは無効）
sbx cp ~/.config/muse/auth.json muse-pw:/home/agent/.config/muse/auth.json
sbx exec muse-pw muse usage  # 認証確認（利用量が表示されれば OK）

sbx run --name muse-pw
```

注意: ホストの `muse login`（OAuth）は sandbox に引き継がれない。
`sbx secret` にも meta/muse 用サービスは無いため、上記のコピーが要る。
コピーせずに `sbx run` すると
`failed to fetch model catalog: authentication failed` で落ちる。
代替手段: `sbx exec -it muse-pw muse login` で中でログインし直すか、
`sbx run --name muse-pw -e META_API_KEY` で API キーを渡す。

## 初期構築（テンプレートが無い場合のみ）

通常は不要。テンプレートごと作り直す場合の手順。

```bash
# 1. muse-code sandbox を作成
sbx create --name muse-code-mfsim \
  docker.io/olegselajev241/muse-code-sbx-kit:latest .

# 2. npm prefix の修復（lib 欠落で npx が動かない）
sbx exec muse-code-mfsim bash -c \
  'mkdir -p /usr/local/share/npm-global/lib'

# 3. Playwright 本体と Chromium
sbx exec muse-code-mfsim bash -c \
  'npm i -g playwright@1.61.1 && playwright install chromium'

# 4. Chromium のシステム依存（root 権限が必要）
sbx exec -u root muse-code-mfsim bash -c \
  'export PATH=/usr/local/share/npm-global/bin:$PATH; playwright install-deps chromium'

# 5. スモークテスト
sbx exec muse-code-mfsim bash -c \
  'mkdir -p ~/pw-smoke && cd ~/pw-smoke &&
   npm init -y >/dev/null 2>&1 && npm i playwright@1.61.1 &&
   printf "import { chromium } from \"playwright\";\nconst b = await chromium.launch();\nconsole.log(\"chromium ok\");\nawait b.close();\n" > smoke.mjs &&
   node smoke.mjs'

# 6. 認証情報の除去（テンプレートに焼き込まない。v1 は古いキーが
#    混入して再作成直後に認証エラーになった）
sbx exec muse-code-mfsim bash -c 'rm -f ~/.config/muse/auth.json'

# 7. テンプレート保存（要 TTY 確認。非対話シェルでは下記の形を使う）
printf 'y\n' | script -qec \
  "sbx template save muse-code-mfsim muse-playwright-mfsim:v1" /dev/null
```

## 検証記録（2026-11-01）

- dev サーバ HTTP 200、Playwright がページを開いて canvas 1 件を検出、
  約1MB のスクショにアプリ画面（3D 建物・航空写真・再生 UI）が描画された。
- console に 404 が 5 件出るが描画に影響なし（内容の切り分けは都度行う）。
- テンプレートからの再作成でも muse・Playwright・Chromium が動作した。
- 再作成直後はテンプレート内の古いキーで認証エラーになる。
  ホストの `auth.json` をコピーする手順を追加し、`muse usage` で確認。
- 京都流入型（`/api/flow`・HUD・追従）実装時。`&` バックグラウンドは禁止の
  ため、サーバーを子プロセス起動→検証→停止する一体型 Node ランナー
  （`/tmp/w3d/run-all.mjs`＋`kyoto.mjs`/`swap.mjs`/`veil.mjs`/`max.mjs`）で
  検証。1 exec で dev 起動・API・スクショ・コンソール確認まで完結。

## 背景

- muse-code kit（v2）に `muse` 導入済み。`sbx/playwright` kit は
  v3 mixin のため `--kit` 合成できない
  （`cannot mix v3 kits with v1/v2 kits` で拒否される）。
  muse-code kit が v3 化されたら mixin 合成に切替可能。
- sbx の kit は Dockerfile ではなく YAML アーティファクトのため、
  `FROM sbx/playwright` する発想の Dockerfile は使えない。
