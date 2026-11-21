// SPDX-License-Identifier: MIT
#include <errno.h>
#include <string.h>
#include <pb_encode.h>
#include <zephyr/sys/byteorder.h>
#include <zmk/studio/custom.h>
#include <zeroshift/studio.h>

enum command { DESCRIBE, READ_SIDE, WRITE_SIDE };
static struct zmk_rpc_custom_subsystem_meta meta = {.security = ZMK_STUDIO_RPC_HANDLER_UNSECURED};
ZMK_RPC_CUSTOM_SUBSYSTEM(zeroshift__v1, &meta, handle);

/* Studio serializes calls and may encode the same response more than once. */
static uint8_t snapshot[4 + 2 * ZEROSHIFT_SLOT_COUNT];
static const uint8_t *payload;
static size_t length;

static bool encode(pb_ostream_t *stream, const pb_field_t *field, void *const *arg) {
    return pb_encode_tag_for_field(stream, field) && pb_encode_string(stream, payload, length);
}

static bool handle(const zmk_custom_CallRequest *req, pb_callback_t *out) {
    const uint8_t *data = req->payload.bytes;
    size_t size = req->payload.size;
    out->funcs.encode = encode;
    if (size == 1 && data[0] == DESCRIBE) {
        payload = (const uint8_t *)zeroshift_studio_descriptor;
        length = strlen(zeroshift_studio_descriptor);
        return true;
    }
    struct zeroshift_state state;
    int rc = -EINVAL;
    if (size >= 2 && data[1] <= 1) {
        if (data[0] == READ_SIDE && size == 2)
            rc = zeroshift_studio_profile(data[1], NULL, &state);
        if (data[0] == WRITE_SIDE && size == 2 + ZEROSHIFT_SLOT_COUNT)
            rc = zeroshift_studio_profile(data[1], data + 2, &state);
    }
    payload = snapshot;
    sys_put_le32((uint32_t)rc, snapshot);
    length = 4;
    if (!rc) {
        memcpy(snapshot + length, state.saved, sizeof(state.saved));
        length += sizeof(state.saved);
        memcpy(snapshot + length, state.active, sizeof(state.active));
        length += sizeof(state.active);
    }
    return true;
}
