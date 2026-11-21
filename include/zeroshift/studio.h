// SPDX-License-Identifier: MIT
#pragma once
#include <zeroshift/profile.h>

/* Keyboard-owned UTF-8 JSON, valid for the lifetime of the firmware. */
extern const char zeroshift_studio_descriptor[];

/* Route to the requested half. NULL reads, a full local profile writes. */
int zeroshift_studio_profile(bool right, const uint8_t *requested, struct zeroshift_state *state);
