// SPDX-License-Identifier: MIT
#include <errno.h>
#include <string.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/settings/settings.h>
#include <zeroshift/profile.h>

LOG_MODULE_REGISTER(zeroshift);
K_MUTEX_DEFINE(zeroshift_lock);
static struct zeroshift_state profile;
static bool ready;

#define PROFILE_KEY CONFIG_ZMK_ZEROSHIFT_SETTINGS_KEY
#define SUBTREE CONFIG_ZMK_ZEROSHIFT_SETTINGS_SUBTREE

static bool supported(size_t slot, uint8_t mode) {
    return mode == 0 || zeroshift_mode_supported(slot, mode);
}

static int load_profile(const char *name, size_t len, settings_read_cb read_cb, void *arg) {
    uint8_t modes[ZEROSHIFT_SLOT_COUNT];
    if (!name || strcmp(name, PROFILE_KEY) != 0) {
        return -ENOENT;
    }
    if (len != sizeof(modes)) {
        return -EINVAL;
    }
    ssize_t received = read_cb(arg, modes, sizeof(modes));
    if (received != sizeof(modes)) {
        return received < 0 ? (int)received : -EIO;
    }
    k_mutex_lock(&zeroshift_lock, K_FOREVER);
    for (size_t i = 0; i < sizeof(modes); i++) {
        profile.saved[i] = supported(i, modes[i]) ? modes[i] : 0;
    }
    k_mutex_unlock(&zeroshift_lock);
    return 0;
}

static int apply_profile(void) {
    k_mutex_lock(&zeroshift_lock, K_FOREVER);
    if (!ready) {
        for (size_t i = 0; i < ZEROSHIFT_SLOT_COUNT; i++) {
            uint8_t mode = profile.saved[i];
            if (!mode) {
                continue;
            }
            int err = zeroshift_start_mode(i, mode);
            if (err != 0) {
                LOG_ERR("Slot %u mode %u failed to start: %d", (unsigned)i, mode, err);
            } else {
                profile.active[i] = mode;
            }
        }
        ready = true;
    }
    k_mutex_unlock(&zeroshift_lock);
    return 0;
}

SETTINGS_STATIC_HANDLER_DEFINE(zeroshift, SUBTREE, NULL, load_profile, apply_profile, NULL);

static int save_profile(const uint8_t *modes) {
    for (size_t i = 0; i < ZEROSHIFT_SLOT_COUNT; i++) {
        if (!supported(i, modes[i])) {
            return -EINVAL;
        }
    }
    if (memcmp(modes, profile.saved, sizeof(profile.saved)) == 0) {
        return 0;
    }
    int err = settings_save_one(SUBTREE "/" PROFILE_KEY, modes, sizeof(profile.saved));
    if (!err) {
        memcpy(profile.saved, modes, sizeof(profile.saved));
    }
    return err;
}

int zeroshift_profile(const uint8_t *requested, struct zeroshift_state *state) {
    if (!state) {
        return -EINVAL;
    }
    k_mutex_lock(&zeroshift_lock, K_FOREVER);
    int err = ready ? 0 : -EAGAIN;
    if (!err && requested) {
        err = save_profile(requested);
    }
    if (!err) {
        *state = profile;
    }
    k_mutex_unlock(&zeroshift_lock);
    return err;
}
