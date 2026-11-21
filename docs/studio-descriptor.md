# キーボードの config から Web UI を定義する

親機で `CONFIG_ZMK_STUDIO=y` と `CONFIG_ZMK_ZEROSHIFT_STUDIO=y` を有効にし、通常の ZeroShift の保存・起動コールバックを左右に実装します。Studio のカスタム RPC を提供する ZMK が必要です。

キーボード側の `zeroshift_studio_descriptor[]` に、次の形式の UTF-8 JSON を格納します。表示文字列はテキストとして扱います。

~~~json
{
  "model": "Example",
  "central": "right",
  "slots": [
    {"label": "拡張ソケット", "modes": [[0, "オフ"], [3, "トラックボール"]]}
  ]
}
~~~

`slots` は左右共通の定義です。左右の選択肢が違う場合は `left`、`right` にそれぞれ同じ形式の配列を指定できます。配列の順序は保存するスロットの順序です。各側のスロット数はその側のプロファイルと一致させます。各モードは 0〜255 の一意な ID と表示名の組で、0 はオフです。表示名を変えても保存済み ID の意味は維持します。

親機の config で `<zeroshift/studio.h>` の `zeroshift_studio_profile(right, requested, state)` を実装し、自分側では `zeroshift_profile()`、反対側ではキーボードの中継処理を呼びます。キーボード自身も保存前にモードの対応可否を検証します。共通 C アダプターは1回でローカルのスロット数と同じ長さの配列を転送します。

## Studio 上の通信形式

共通 Web UI は接続ごとに `zeroshift__v1` を検索します。Studio のカスタム呼び出しの payload は次のバイト列です。

| 操作 | 要求 | 応答 |
| --- | --- | --- |
| 構成の取得 | `[0]` | UTF-8 JSON |
| 読み取り | `[1, side]` | ステータス、保存済み ID 配列、起動中 ID 配列 |
| 保存 | `[2, side, ...ids]` | 読み取りと同形式 |

`side` は左が0、右が1。ステータスは符号付き32ビットのリトルエンディアンで、失敗時はステータスだけを返します。保存直後の起動値は変わらず、変更した側の再起動後に適用されます。
