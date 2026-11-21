# ZeroShift を変更・導入する AI エージェントへ

最初に [公開 API](include/zeroshift/profile.h)、[保存・起動処理](src/profile.c)、[MeKaBu の実装例](examples/mekabu/README.md)を読む。対象キーボードの既存の west マニフェスト、シールド、左右の親子関係、使用中の開発ブランチを確認する。

## 変更を置く場所

- ZeroShift コアは各スロットのモード ID の検証、永続化、起動時適用を担当する。
- 機種名、ピン、バス、スロット構成、ドライバー、モード ID の意味はキーボードの config に置く。サンプルは明示的に選んだビルドでのみコンパイルする。
- 分割機では各側にローカルのプロファイルがある。Web UI からの要求を親機で受け、子機の設定は対象側へ中継し、その側の応答を返す。親機が左右どちらかを既存のシールドで確認する。

MeKaBu を扱うときは、サンプルに固定した config の `config/west.yml` で ZeroShift のリビジョンを確認する。左右ともローカルのスロット番号は 0。右への要求は `src/zeroshift/modules_rpc.c` から `modules_relay.c` を通る。モードの追加・変更時は config の列挙値、RPC の対応ビット、Web UI の `mekabuModes` の順序を照合する。

## キーボード側の実装順

1. スロットごとの対応表を作る。既存機種では永続化済みの ID、スロット順、個数、settings のキーを確認する。これらを変更する場合は旧データの読み込み方法を設計する。
2. config のマニフェストで依存を確認したコミットに固定する。settings と ZeroShift を有効化し、`CONFIG_ZMK_ZEROSHIFT_SLOT_COUNT` をその側のスロット数に合わせる。
3. config で `zeroshift_mode_supported()` と `zeroshift_start_mode()` を実装する。モード 0 は無効を意味する。ピンを共有するデバイスと必要なバスは起動順を確認し、選択された経路だけを初期化する。初期化失敗は呼び出し元へ返す。両コールバックはロック中に呼ばれるので、そこから `zeroshift_profile()` を呼ぶとデッドロックする。
4. 読み取りは `zeroshift_profile(NULL, &state)`、保存はスロット数と同じ長さの配列を渡す。RPC では受信長と各値の範囲を検証してから変換する。保存成功後の `saved`、その起動で初期化が成功した `active` を区別する。settings の準備中は `-EAGAIN` を扱う。
5. 新規対応機種は共通 Studio API の `zeroshift__v1` を使う。キーボードの config に機種名、親機側、スロット名、選択肢と保存 ID を宣言し、`zeroshift_studio_profile()` で対象側へ振り分ける。新しい機種の名前や ID を共通 Web UI に追加する必要はない。[実装方法](docs/studio-descriptor.md)

## 完了時の検証

- 対象の config からビルドする。分割機は左右とも対象にする。`zmk-workspace2` ではワークスペース直下の `./just.sh` を使う。
- 初期状態 → 保存直後 → 対象側の再起動後を読み戻す。未対応モードを渡したときに保存値が保たれること、デバイス初期化失敗時に `active` が 0 に残ることも確認する。
- 実機のカーソル・キー・スクロール、左右間の通信、エミュレーターに注入したイベント、ビルド成功はそれぞれ何を確認したか記録する。
