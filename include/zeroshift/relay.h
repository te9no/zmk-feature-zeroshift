// SPDX-License-Identifier: MIT
#pragma once
#include <zeroshift/profile.h>

/* One outstanding request from the serial Studio dispatcher. The peer's
 * result (including positive capability bits) passes through unchanged. */
uint32_t zeroshift_relay_begin(void);
int zeroshift_relay_wait(uint32_t id, struct zeroshift_state *state);
void zeroshift_relay_complete(uint32_t id, int32_t result, const struct zeroshift_state *state);
