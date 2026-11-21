// SPDX-License-Identifier: MIT
#define DT_DRV_COMPAT zeroshift_demo_save_mode
#include <errno.h>
#include <drivers/behavior.h>
#include <zephyr/device.h>
#include <zephyr/logging/log.h>
#include <zeroshift/profile.h>

LOG_MODULE_REGISTER(zeroshift_demo);
BUILD_ASSERT(ZEROSHIFT_SLOT_COUNT == 1);

enum demo_mode { MODE_OFF, MODE_CLICK };

bool zeroshift_mode_supported(size_t slot, uint8_t mode) {
    return slot == 0 && mode == MODE_CLICK;
}

int zeroshift_start_mode(size_t slot, uint8_t mode) {
    if (!zeroshift_mode_supported(slot, mode)) {
        return -EINVAL;
    }
    return device_init(DEVICE_DT_GET(DT_NODELABEL(slot_button)));
}

static int save_mode(struct zmk_behavior_binding *binding, struct zmk_behavior_binding_event event) {
    if (binding->param1 > MODE_CLICK) {
        return -EINVAL;
    }
    const uint8_t requested[ZEROSHIFT_SLOT_COUNT] = {binding->param1};
    struct zeroshift_state state;
    int err = zeroshift_profile(requested, &state);
    if (err) {
        LOG_ERR("Profile save failed (%d)", err);
        return err;
    }
    LOG_INF("Saved %u, active %u", state.saved[0], state.active[0]);
    return ZMK_BEHAVIOR_OPAQUE;
}

static int release_mode(struct zmk_behavior_binding *binding, struct zmk_behavior_binding_event event) {
    return ZMK_BEHAVIOR_OPAQUE;
}

static const struct behavior_driver_api api = {
    .binding_pressed = save_mode,
    .binding_released = release_mode,
};

BEHAVIOR_DT_INST_DEFINE(0, NULL, NULL, NULL, NULL, POST_KERNEL,
                        CONFIG_KERNEL_INIT_PRIORITY_DEFAULT, &api);
