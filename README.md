# ZeroShift

ZeroShift は、分割キーボードの拡張モジュールを ZMK Studio RPC 経由で切り替える ZMK モジュールです。左右それぞれに UF2 を一度書き込むと、モジュール構成を変更するたびにファームウェアを書き直す必要がありません。

現在の対応機種は **CaGiMe AAA R01（XIAO nRF52840 Plus・左 J5 配線修正版）** です。このリポジトリにはモジュール本体、対応シールドとキーマップ、Web UI、Renode テストを収録しています。

| 装着位置 | 選択できるモジュール |
| --- | --- |
| 下側（左 J4 / 右 J7） | オフ、PMW3610 トラックボール、エンコーダ、アナログスティック、1u キー |
| 中央（左 J5 / 右 J8） | オフ、PMW3610 トラックボール、LPPS（ADS1220）、エンコーダ、1u キー |

## 設定する

1. 左右にそれぞれの UF2 を書き込みます。FPC の着脱時には USB と電池を外します。
2. 下記の手順で Web UI を起動し、Chrome または Edge で開きます。USB 接続なら左側のポートを、Bluetooth 接続なら PC とペアリングした左側の **CaGiMe** を選びます。無線で設定するときは、USB ケーブルを抜いて PC に無線入力できることを確認します。候補に出ない場合、標準キーマップでは A の左の Esc を押したまま U を押すと Studio の広告を再開できます。
3. 設定対象の側、下側・中央側のモジュールを選んで保存します。右側への要求と応答は左側で中継します。
4. 設定した側をリセットします。左側なら再接続、右側なら左右の接続後に再読込し、画面の「起動時のドライバー」を確認します。

### Web UI

Node.js 22 と npm を使用します。リポジトリのルートから実行して http://localhost:8767/ を開きます。

~~~sh
cd studio-web
npm ci
npm run build
python3 -m http.server 8767 --bind 127.0.0.1 --directory dist
~~~

### ファームウェア

[依存コミット](config/west.yml) には custom Studio RPC と分割イベント中継に対応する cormoran/zmk を指定しています。[実機用ビルドマトリクス](build-aaa-r01-studio.yaml) に左右の board、shield、snippet が定義されています。

開発用 zmk-workspace2 では、このリポジトリを config/zmk-feature-zeroshift に配置し、cagime-aaa-r01 プロファイルとワークスペース直下の just.sh を使います。

~~~sh
ZMK_CONFIG_ROOT=config/zmk-feature-zeroshift ZMK_BUILD_MATRIX=build-aaa-r01-studio.yaml ZMK_CONFIG_NAME=cagime ZMK_FIRMWARE_TEST_PURPOSE=zeroshift-aaa-r01 ./just.sh --profile cagime-aaa-r01 build-parallel cagime-aaa-r01-studio 2
~~~

成果物は firmware/testing/cagime/zeroshift-aaa-r01/ に収集されます。

### 自動検証

[Renode 用ビルドマトリクス](build-aaa-r01-studio-sim.yaml) は仮想 UART を使用します。テストでは Web UI と同じ RPC クライアントから左右各25通りを保存し、該当する側だけを再起動して適用値を照合します。CAGIME_TEST_WEB_BLUETOOTH=1 を指定すると Web Bluetooth のテストダブルを経由します。実機での電波通信とセンサー入力は未検証です。

~~~sh
ZMK_CONFIG_ROOT=config/zmk-feature-zeroshift ZMK_BUILD_MATRIX=build-aaa-r01-studio-sim.yaml ZMK_CONFIG_NAME=cagime ZMK_FIRMWARE_TEST_PURPOSE=zeroshift-sim ./just.sh --profile cagime-aaa-r01 build-parallel cagime-aaa-r01-studio-sim 2
CAGIME_TEST_WEB_BLUETOOTH=1 python3 config/zmk-feature-zeroshift/tests/renode/test_studio.py --renode .zmk-workspace/tools/renode-1.17.0/renode --firmware-dir firmware/testing/cagime/zeroshift-sim --log /tmp/zeroshift-renode.log
~~~

## ライセンス

MIT。Studio RPC の実装は [cormoran のテンプレート](https://github.com/cormoran/zmk-module-template-with-custom-studio-rpc) を基にしています。[ライセンス](LICENSE) · [テンプレートのライセンス](LICENSE.studio-template)
