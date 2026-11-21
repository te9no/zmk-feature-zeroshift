# 1スロットで試す ZeroShift

XIAO nRF52840（ボード名 `xiao_ble//zmk`）用の小さなキーボード設定です。2個の設定キーで、3個目のボタンをマウスの左クリックとして使うかを保存します。保存した直後と再起動した後の違いを手元で確認できます。

| 入力 | 配線 | 役割 |
|---|---|---|
| D0 | スイッチを介して GND | モード 0（オフ）を保存 |
| D1 | スイッチを介して GND | モード 1（クリック）を保存 |
| D2 | スイッチを介して GND | モード 1 で左クリック |

USB を外して各スイッチを配線します。入力には内蔵プルアップを使います。このサンプルは独立したシールド `zeroshift_demo` としてビルドしてください。

## ビルド

このディレクトリがサンプルの config リポジトリのルートです。[west マニフェスト](config/west.yml)に ZMK と ZeroShift のリビジョン、[build.yaml](build.yaml) に対象ボードとシールドを記載しています。既存の ZMK config 用ビルド環境に持ち込むときは、このディレクトリの中身をサンプル用リポジトリのルートに置きます。Zephyr モジュールとしてこのルートをビルドに含めると、シールドと C ソースが登録されます。

`zmk-workspace2` でのビルド例です。ワークスペースのルートで実行し、最初の行を自分のチェックアウト先に合わせてください。

~~~sh
sample=config/zmk-feature-zeroshift/examples/one-slot
./just.sh --profile zeroshift-demo init "$sample"
ZMK_CONFIG_ROOT="$sample" ZMK_CONFIG_NAME=ZeroShift-Demo \
  ZMK_FIRMWARE_TEST_PURPOSE=one-slot-r01 \
  ./just.sh --profile zeroshift-demo build ZeroShift-Demo
~~~

生成先は `firmware/testing/ZeroShift-Demo/one-slot-r01/ZeroShift-Demo.uf2` です。サンプル用の XIAO に書き込み、USB で操作端末につなぎます。

## 動かす

1. 既存の保存値がなければオフで起動します。D1 を押して離すとモード 1 が保存されます。この時点の D2 はオフです。
2. リセットし、D2 を押して離します。端末に左クリックが届きます。
3. D0 を押して離してモード 0 を保存します。次のリセットまでは D2 でクリックでき、リセット後は D2 がオフになります。

## 自分のキーボードへ移す

- [slot.c](src/slot.c) の `save_mode()` が設定キーから1スロット分を保存します。読み出しだけ行う場合は `zeroshift_profile(NULL, &state)` を使います。
- 同じファイルの `zeroshift_mode_supported()` が許可する組み合わせを返し、`zeroshift_start_mode()` が選択済みデバイスを起動します。モード 0 はコアが処理します。
- [シールド定義](boards/shields/zeroshift_demo/zeroshift_demo.overlay) の `zephyr,deferred-init` により、クリック用デバイスは選択されるまで初期化を待ちます。D0・D1 は常時使える独立した設定キーです。
- この例の設定手段は D0・D1 です。Web UI 対応機を作る場合は、実機 config 側に Studio RPC と左右間の中継も実装します。[Polaris の RPC 実装](https://github.com/te9no/zmk-config-GeaconPolaris/blob/ca3f2bc82185642470253e10c450e2f1c5b29d3e/src/zeroshift/modules_rpc.c)と[AI向け実装手順](../../AGENTS.md)を参照してください。
