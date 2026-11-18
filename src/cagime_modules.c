// SPDX-License-Identifier: MIT

#include <string.h>
#include <zephyr/device.h>
#include <zephyr/input/input.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/settings/settings.h>
#include <zephyr/shell/shell.h>

#include <zmk/events/position_state_changed.h>
#include <zmk/events/sensor_event.h>
#include <zmk/matrix_transform.h>

#include "cagime_stick.h"
#include "modules_profile.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#define MODULE_SETTINGS_KEY "cagime/modules-v1"

/* Keep the original values in NVS so existing PMW3610 and LPPS settings carry over. */
enum module_mode { MODULE_OFF, MODULE_PMW3610, MODULE_LPPS, MODULE_ENCODER, MODULE_STICK, MODULE_KEY };
enum slot_index { LOWER_SLOT, INNER_SLOT };

struct module_slot {
    const struct device *bus;
    const struct device *pmw3610;
    const struct device *encoder;
    const struct device *key;
};

static const struct module_slot slots[] = {
    [LOWER_SLOT] = {
        .bus = DEVICE_DT_GET(DT_NODELABEL(cagime_lower_bus)),
        .pmw3610 = DEVICE_DT_GET(DT_NODELABEL(cagime_lower_pmw)),
        .encoder = DEVICE_DT_GET(DT_NODELABEL(cagime_lower_encoder)),
        .key = DEVICE_DT_GET(DT_NODELABEL(cagime_lower_key)),
    },
    [INNER_SLOT] = {
        .bus = DEVICE_DT_GET_OR_NULL(DT_NODELABEL(cagime_inner_bus)),
        .pmw3610 = DEVICE_DT_GET_OR_NULL(DT_NODELABEL(cagime_inner_pmw)),
        .encoder = DEVICE_DT_GET_OR_NULL(DT_NODELABEL(cagime_inner_encoder)),
        .key = DEVICE_DT_GET_OR_NULL(DT_NODELABEL(cagime_inner_key)),
    },
};

static const char *const mode_names[] = {
    [MODULE_OFF] = "off",
    [MODULE_PMW3610] = "pmw3610",
    [MODULE_LPPS] = "lpps",
    [MODULE_ENCODER] = "encoder",
    [MODULE_STICK] = "stick",
    [MODULE_KEY] = "key",
};

static uint8_t saved[ARRAY_SIZE(slots)];
static uint8_t active[ARRAY_SIZE(slots)];
static bool loaded;

K_MUTEX_DEFINE(profile_lock);

ZMK_MATRIX_TRANSFORM_EXTERN(DT_NODELABEL(default_transform));

static void module_key_event(struct input_event *event, void *user_data) {
    if (event->type != INPUT_EV_KEY) {
        return;
    }

    /* The layout keeps lower positions in row 6, column 0, and inner in column 1. */
    uint32_t column = event->dev == slots[LOWER_SLOT].key ? 0 : 1;
    int32_t position = zmk_matrix_transform_row_column_to_position(
        ZMK_MATRIX_TRANSFORM_T_FOR_NODE(DT_NODELABEL(default_transform)), 6, column);
    if (position < 0) {
        return;
    }

    raise_zmk_position_state_changed((struct zmk_position_state_changed){
        .source = ZMK_POSITION_STATE_CHANGE_SOURCE_LOCAL,
        .position = position,
        .state = event->value != 0,
        .timestamp = k_uptime_get(),
    });
}

static void module_encoder_event(const struct device *dev, const struct sensor_trigger *trigger) {
    struct sensor_value value;
    if (sensor_sample_fetch(dev) != 0 || sensor_channel_get(dev, trigger->chan, &value) != 0) {
        return;
    }
    if (value.val1 == 0 && value.val2 == 0) {
        return;
    }

    /* Preserve the original lower encoder indexes, then append the two inner encoders. */
    uint8_t index = IS_ENABLED(CONFIG_SHIELD_CAGIME_AAA_RIGHT);
    if (dev == slots[INNER_SLOT].encoder) {
        index += 2;
    }

    raise_zmk_sensor_event((struct zmk_sensor_event){
        .sensor_index = index,
        .channel_data_size = 1,
        .channel_data = {{.value = value, .channel = trigger->chan}},
        .timestamp = k_uptime_get(),
    });
}

static int start_encoder(const struct device *dev) {
    static const struct sensor_trigger trigger = {
        .type = SENSOR_TRIG_DATA_READY,
        .chan = SENSOR_CHAN_ROTATION,
    };
    int err = device_init(dev);
    return err == 0 ? sensor_trigger_set(dev, &trigger, module_encoder_event) : err;
}

INPUT_CALLBACK_DEFINE_NAMED(DEVICE_DT_GET(DT_NODELABEL(cagime_lower_key)),
                            module_key_event, NULL, cagime_lower_key);
#if DT_NODE_EXISTS(DT_NODELABEL(cagime_inner_encoder))
INPUT_CALLBACK_DEFINE_NAMED(DEVICE_DT_GET(DT_NODELABEL(cagime_inner_key)),
                            module_key_event, NULL, cagime_inner_key);
#endif

static bool valid_slot_mode(uint8_t mode, size_t slot) {
    switch (mode) {
    case MODULE_OFF:
        return true;
    case MODULE_PMW3610:
        return slots[slot].pmw3610 != NULL;
    case MODULE_LPPS:
        return slot == INNER_SLOT && DT_NODE_EXISTS(DT_NODELABEL(cagime_lpps_axes));
    case MODULE_ENCODER:
        return slots[slot].encoder != NULL;
    case MODULE_STICK:
        return slot == LOWER_SLOT;
    case MODULE_KEY:
        return slots[slot].key != NULL;
    default:
        return false;
    }
}

static int parse_mode(const char *name, size_t slot) {
    for (size_t i = 0; i < ARRAY_SIZE(mode_names); i++) {
        if (strcmp(name, mode_names[i]) == 0 && valid_slot_mode(i, slot)) {
            return (int)i;
        }
    }
    return -EINVAL;
}

static int start_mode(uint8_t mode, size_t slot) {
    int err;

    switch (mode) {
    case MODULE_OFF:
        return 0;
    case MODULE_PMW3610:
        err = device_init(slots[slot].bus);
        return err == 0 ? device_init(slots[slot].pmw3610) : err;
#if DT_NODE_EXISTS(DT_NODELABEL(cagime_lpps_axes))
    case MODULE_LPPS:
        err = device_init(DEVICE_DT_GET(DT_NODELABEL(spi0)));
        if (err != 0) {
            return err;
        }
        err = device_init(DEVICE_DT_GET(DT_NODELABEL(cagime_lpps_adc)));
        return err == 0 ? device_init(DEVICE_DT_GET(DT_NODELABEL(cagime_lpps_axes))) : err;
#endif
    case MODULE_ENCODER:
        return start_encoder(slots[slot].encoder);
    case MODULE_STICK:
        /* The MeKaBu stick module also exposes an encoder on the lower A/B pins. */
        err = start_encoder(slots[slot].encoder);
        return err == 0 ? cagime_stick_start() : err;
    case MODULE_KEY:
        return device_init(slots[slot].key);
    default:
        return -ENOTSUP;
    }
}

static int load_modes(const char *name, size_t len, settings_read_cb read_cb, void *arg) {
    uint8_t modes[ARRAY_SIZE(slots)];
    if (!name || strcmp(name, "modules-v1") != 0) {
        return -ENOENT;
    }
    if (len != sizeof(modes)) {
        return -EINVAL;
    }

    ssize_t received = read_cb(arg, modes, sizeof(modes));
    if (received != (ssize_t)sizeof(modes)) {
        return received < 0 ? (int)received : -EIO;
    }

    k_mutex_lock(&profile_lock, K_FOREVER);
    for (size_t i = 0; i < ARRAY_SIZE(slots); i++) {
        saved[i] = valid_slot_mode(modes[i], i) ? modes[i] : MODULE_OFF;
    }
    k_mutex_unlock(&profile_lock);
    return 0;
}

static int apply_modes(void) {
    k_mutex_lock(&profile_lock, K_FOREVER);
    if (loaded) {
        k_mutex_unlock(&profile_lock);
        return 0;
    }

    for (size_t i = 0; i < ARRAY_SIZE(slots); i++) {
        int err = start_mode(saved[i], i);
        if (err < 0) {
            LOG_ERR("CaGiMe slot %u initialization failed: %d", (unsigned)i, err);
            continue;
        }
        active[i] = saved[i];
    }

    loaded = true;
    k_mutex_unlock(&profile_lock);
    return 0;
}

SETTINGS_STATIC_HANDLER_DEFINE(cagime, "cagime", NULL, load_modes, apply_modes, NULL);

static int save_modes(const uint8_t modes[2]) {
    if (!valid_slot_mode(modes[0], LOWER_SLOT) || !valid_slot_mode(modes[1], INNER_SLOT)) {
        return -EINVAL;
    }
    if (memcmp(modes, saved, sizeof(saved)) == 0) {
        return 0;
    }

    int err = settings_save_one(MODULE_SETTINGS_KEY, modes, sizeof(saved));
    if (err == 0) {
        memcpy(saved, modes, sizeof(saved));
    }
    return err;
}

int cagime_profile(const uint8_t *requested, struct module_state *state) {
    k_mutex_lock(&profile_lock, K_FOREVER);
    int err = !loaded ? -EAGAIN : requested ? save_modes(requested) : 0;
    if (!err) {
        memcpy(state->saved, saved, sizeof(saved));
        memcpy(state->active, active, sizeof(active));
    }
    k_mutex_unlock(&profile_lock);
    return err;
}

static int module_command(const struct shell *shell, size_t argc, char **argv) {
    int err = -EINVAL;
    struct module_state state;
    if (argc == 2 && strcmp(argv[1], "get") == 0) {
        err = cagime_profile(NULL, &state);
    } else if (argc == 4 && strcmp(argv[1], "set") == 0) {
        int lower = parse_mode(argv[2], LOWER_SLOT);
        int inner = parse_mode(argv[3], INNER_SLOT);
        if (lower >= 0 && inner >= 0) {
            uint8_t modes[] = {lower, inner};
            err = cagime_profile(modes, &state);
        }
    }

    if (err == 0) {
        const char *side = IS_ENABLED(CONFIG_SHIELD_CAGIME_AAA_LEFT) ? "left" : "right";
        shell_print(shell, "CAGIME/2 state %s %s %s %s %s %u", side,
                    mode_names[state.saved[0]], mode_names[state.saved[1]],
                    mode_names[state.active[0]], mode_names[state.active[1]],
                    (unsigned)(slots[INNER_SLOT].pmw3610 != NULL));
    } else {
        shell_print(shell, "CAGIME/2 error %d", err);
    }
    return err;
}

SHELL_CMD_ARG_REGISTER(cagime, NULL, "get | set <lower> <inner>", module_command, 2, 2);
