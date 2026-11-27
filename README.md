# ZeroShift

ZeroShift は、ZMK キーボードで拡張スロットのモードを保存し、次回起動時に適用する Zephyr モジュールです。各スロットに対する選択を 1 バイトのモード ID として扱います。キーボード側で ID の意味、使用可能な組み合わせ、ドライバーの起動処理を定義します。

## 実装例

MeKaBu の左に PMW3610 トラックボール、右に PAT9125 光学エンコーダを装着する例です。左右各1本の UF2 を使い、Web UI で選んだドライバーが次回起動時に有効になるまでを実際の config で追えます。[MeKaBu の使用例](examples/mekabu/README.md) · [AI向け実装手順](AGENTS.md)

新しく対応するキーボードは、機種名、親機の側、スロット名、選択肢を config に定義できます。共通 Web UI が接続時に読み取って設定画面を生成します。[キーボード側の定義と実装手順](docs/studio-descriptor.md)

## config から使う

1. config の west マニフェストに依存を追加し、動作確認したコミットに固定します。

~~~yaml
manifest:
  projects:
    - name: zmk-feature-zeroshift
      url: https://github.com/te9no/zmk-feature-zeroshift
      revision: main
~~~

2. Zephyr settings を使える構成で、キーボードの .conf に以下を設定します。この例はローカルに 2 スロットある場合です。

~~~ini
CONFIG_SETTINGS=y
CONFIG_ZMK_ZEROSHIFT=y
CONFIG_ZMK_ZEROSHIFT_SLOT_COUNT=2
~~~

3. config 側の C ソースで次の 2 関数を実装し、キーボードのビルドに含めます。スロット番号は 0 始まりです。モード 0 は無効を表し、モジュールが処理します。

~~~c
#include <zeroshift/profile.h>

bool zeroshift_mode_supported(size_t slot, uint8_t mode);
int zeroshift_start_mode(size_t slot, uint8_t mode);
~~~

4. config 側の設定 UI や RPC ハンドラーから下記の API を呼びます。

~~~c
struct zeroshift_state state;
int err = zeroshift_profile(NULL, &state);      // 現在値を読み取る
// uint8_t modes[ZEROSHIFT_SLOT_COUNT] に各スロットの選択を格納して保存
// err = zeroshift_profile(modes, &state);
~~~

保存時は全スロットを検証してから 1 件の設定として書き込みます。state.saved は保存値、state.active は起動時に初期化に成功した値です。settings のロード完了前は -EAGAIN を返します。分割キーボードでは各側にローカルの設定があり、対象側に要求を届けるのは呼び出し側の役割です。

保存先の既定値は zeroshift/profile-v1 です。既存のバイト配列形式を引き継ぐ場合は CONFIG_ZMK_ZEROSHIFT_SETTINGS_SUBTREE と CONFIG_ZMK_ZEROSHIFT_SETTINGS_KEY を指定し、スロット順・個数と ID の割り当てを維持してください。

## Web UI

接続した親機から設定を読み取ります。[CaGiMe](https://github.com/te9no/zmk-config-CaGiMe#初回の書き込み) は左右各2スロット、[MeKaBu の ZeroShift 対応版](https://github.com/te9no/zmk-config-MKB2/tree/feat/zeroshift-common-modules) は左右各1スロットを設定できます。

Chrome または Edge で [ZeroShift 設定画面](https://te9no.github.io/zmk-feature-zeroshift/) を開きます。**左右どちらを設定する場合も、PC の接続先はそのキーボードの親機です。**

- **USB** — 親機を PC につなぎ、「USB 接続」から親機の Studio 用ポートを選びます。
- **無線** — 親機を PC とペアリングし、USB ケーブルを抜いて無線入力できることを確認します。「無線接続」からキーボード名を選びます。CaGiMe が候補に出ないときは、標準キーマップの左側で A の左にある Esc を押したまま U を押してください。

1. 「設定する側」で左または右を選びます。右を選ぶときは、左右の電源を入れ、両側が通信できる状態にします。
2. CaGiMe は「下側」「中央側」、MeKaBu は「拡張ソケット」で装着するモジュールを選び、「設定を保存」を押します。選択は対象側のフラッシュに保存されます。保存前の選択は「変更を破棄」で元に戻せます。
3. **設定した側をリセット**します。保存したモジュールには「リセット後に有効」と表示されます。親機なら Web UI に再接続し、子機なら左右がつながってから「再読込」を押します。適用されたモジュールには「起動中」と表示されます。

キーボードをつながずに画面を試すには「デモモード」を押します。

### ローカルで起動する

Node.js 22、npm、Python 3 を用意し、このリポジトリのルートから実行します。

~~~sh
cd studio-web
npm ci
npm run build
python3 -m http.server 8767 --bind 127.0.0.1 --directory dist
~~~

[ローカルの設定画面](http://localhost:8767/) を開きます。スロットを自分で定義するキーボード（`zeroshift__v1`）の表示は、[`?demo=described`](http://localhost:8767/?demo=described) を付けて開き、デモモードで確認できます。
