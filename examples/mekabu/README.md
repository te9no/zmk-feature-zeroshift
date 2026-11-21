# MeKaBu の拡張モジュールを切り替える

左の PMW3610 トラックボールでカーソルを動かし、右の PAT9125 光学エンコーダで縦スクロールする設定例です。MeKaBu は左右に拡張ソケットが1つずつあり、それぞれの手が自分の設定を保存します。初回に左右各1本の UF2 を書き込めば、次のモジュール交換からは Web UI で設定できます。

## 実機で試す

1. 電源を切って左に PMW3610、右に PAT9125 を装着します。初回はサンプルの ZIP を展開し、左に `MKB-ZeroShift-left.uf2`、右に `MKB-ZeroShift-right.uf2` を書き込みます。[この例に対応する左右の UF2 と検証記録（ZIP）](https://github.com/te9no/zmk-config-MKB2/raw/44d5f41473fa11c764b9f1cc9715b182feb52815/firmware/downloads/MeKaBu-ZeroShift-common-scroll-r06.zip)
2. 両手の電源を入れて、親機の左手を USB 接続します。設定画面の「USB 接続」で左手の Studio ポートを選びます。[ZeroShift 設定画面](https://te9no.github.io/zmk-feature-zeroshift/)
3. 「設定する側」を左にし、「拡張ソケット」で「トラックボール（PMW3610）」を選び、「設定を保存」を押します。次に右に切り替え、「光学エンコーダ（PAT9125）」を選んで保存します。右の設定も左手の USB 接続から操作できます。
4. 今回は左右とも変更したので、両方を再起動します。左手に再接続し、右手との通信が戻ったら、左右それぞれで「再読込」を押します。「起動時のドライバー」が選択と一致することを確認し、ボールでポインターが動くか、ダイヤルでページが上下するかを試します。

## 右のダイヤルを選ぶと何が起きるか

右手のソケットも、右手のファームウェアから見るとスロット番号は `0` です。左手が受けた Studio RPC `mekabu__modules` は、対象が右なら `mkb_remote_profile()` で要求を中継します。右手が自分のフラッシュに保存し、その結果を左手経由で Web UI に返します。[RPC の振り分け](https://github.com/te9no/zmk-config-MKB2/blob/44d5f41473fa11c764b9f1cc9715b182feb52815/src/zeroshift/modules_rpc.c) · [左右間の中継](https://github.com/te9no/zmk-config-MKB2/blob/44d5f41473fa11c764b9f1cc9715b182feb52815/src/zeroshift/modules_relay.c)

右の設定が最初は無効だった場合、読み戻した値は次のように変わります。MeKaBu では `0` が無効、`1` が PMW3610、`8` が PAT9125 です。

| 右手の状態 | 保存値 `saved[0]` | 起動中の値 `active[0]` |
| --- | --- | --- |
| 無効で起動 | 0 | 0 |
| PAT9125 を保存した直後 | 8 | 0 |
| 右手を再起動し、初期化に成功 | 8 | 8 |

起動時には ZeroShift が保存した ID を MeKaBu の `zeroshift_start_mode()` に渡します。下はその分岐の抜粋です。`start_on_bus()` はバスを初期化してからセンサーを起動します。PAT9125 では押し込みキーも初期化し、回転の X 方向の差分は入力処理で縦ホイールに変換します。[ドライバーの選択とスクロール変換](https://github.com/te9no/zmk-config-MKB2/blob/44d5f41473fa11c764b9f1cc9715b182feb52815/src/zeroshift/modules.c)

~~~c
case TB: return start_on_bus(DEV(tb_bus), DEV(tb));
/* ほかのモードは省略 */
case PAT: {
    int ret = start_on_bus(DEV(dial_bus), DEV(module_dial));
    return ret ? ret : device_init(DEV(module_key));
}
~~~

## ソースを取得する

ZeroShift のリポジトリ直下で次を実行すると、この例で使用した MeKaBu config が `examples/mekabu/keyboard-config` に展開されます。

~~~sh
git submodule update --init -- examples/mekabu/keyboard-config
~~~

ビルドには config 内の `config/west.yml` が固定する依存関係を使います。`build.yaml` の対象は `MKB-ZeroShift-left` と `MKB-ZeroShift-right` です。左右の配線は `boards/shields/MKB/MKB_L_ZS.overlay` と `MKB_R_ZS.overlay`、組み込むドライバーは `snippets/mkb-zeroshift/modules.conf` で確認できます。[固定した config 一式](https://github.com/te9no/zmk-config-MKB2/tree/44d5f41473fa11c764b9f1cc9715b182feb52815)

ZIP には親機のローカル入力と子機からの受信後の縦スクロールを調べた Renode の記録が含まれます。物理センサーから無線を経由して端末に届くまでの動作は、上の実機手順で確認してください。
