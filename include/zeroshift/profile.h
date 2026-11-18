// SPDX-License-Identifier: MIT
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define ZEROSHIFT_SLOT_COUNT CONFIG_ZMK_ZEROSHIFT_SLOT_COUNT

struct zeroshift_state {
    uint8_t saved[ZEROSHIFT_SLOT_COUNT];
    uint8_t active[ZEROSHIFT_SLOT_COUNT];
};

/* Implement these callbacks in the keyboard config. Mode 0 means disabled.
 * Callbacks run under the profile lock and must not call zeroshift_profile(). */
bool zeroshift_mode_supported(size_t slot, uint8_t mode);
int zeroshift_start_mode(size_t slot, uint8_t mode);

/* Read (requested == NULL) or persist one complete profile and return its
 * snapshot. requested must contain ZEROSHIFT_SLOT_COUNT bytes. A saved change
 * takes effect on the next boot. Returns a negative errno on failure. */
int zeroshift_profile(const uint8_t *requested, struct zeroshift_state *state);
