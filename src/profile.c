// SPDX-License-Identifier: MIT
#include <errno.h>
#include <string.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/settings/settings.h>
#include <zeroshift/profile.h>

LOG_MODULE_REGISTER(zeroshift);
/* Lock order: save_lock -> settings -> zeroshift_lock. Settings loading calls
 * the handlers below with its own lock held, so flash writes must not happen
 * while zeroshift_lock is held. save_lock serializes writers. */
K_MUTEX_DEFINE(zeroshift_lock);
K_MUTEX_DEFINE(save_lock);
static struct zeroshift_state profile;
static bool ready;
/* The stored record differs from profile.saved because load replaced an
 * unsupported mode with 0. The next save must rewrite it. */
static bool stale;

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
    stale = false;
    for (size_t i = 0; i < sizeof(modes); i++) {
        profile.saved[i] = supported(i, modes[i]) ? modes[i] : 0;
        stale |= profile.saved[i] != modes[i];
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

int zeroshift_profile(const uint8_t *requested, struct zeroshift_state *state) {
    if (!state) {
        return -EINVAL;
    }
    if (requested) {
        k_mutex_lock(&save_lock, K_FOREVER);
    }
    k_mutex_lock(&zeroshift_lock, K_FOREVER);
    int err = ready ? 0 : -EAGAIN;
    bool write = false;
    for (size_t i = 0; !err && requested && i < ZEROSHIFT_SLOT_COUNT; i++) {
        if (!supported(i, requested[i])) {
            err = -EINVAL;
        }
    }
    if (!err && requested) {
        write = stale || memcmp(requested, profile.saved, sizeof(profile.saved)) != 0;
    }
    k_mutex_unlock(&zeroshift_lock);

    if (write) {
        err = settings_save_one(SUBTREE "/" PROFILE_KEY, requested, sizeof(profile.saved));
    }

    k_mutex_lock(&zeroshift_lock, K_FOREVER);
    if (write && !err) {
        memcpy(profile.saved, requested, sizeof(profile.saved));
        stale = false;
    }
    if (!err) {
        *state = profile;
    }
    k_mutex_unlock(&zeroshift_lock);
    if (requested) {
        k_mutex_unlock(&save_lock);
    }
    return err;
}
