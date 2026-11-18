// SPDX-License-Identifier: MIT
#pragma once
#include <stdint.h>
#include <stdbool.h>

struct module_state {
    uint8_t saved[2];
    uint8_t active[2];
};

int cagime_profile(const uint8_t *requested, struct module_state *state);
int cagime_remote_profile(const uint8_t *requested, struct module_state *state);
