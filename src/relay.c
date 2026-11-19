// SPDX-License-Identifier: MIT
#include <errno.h>
#include <zephyr/kernel.h>
#include <zeroshift/relay.h>

struct reply {
    uint32_t id;
    int32_t result;
    struct zeroshift_state state;
};

K_MSGQ_DEFINE(replies, sizeof(struct reply), 4, 4);

uint32_t zeroshift_relay_begin(void) {
    static uint32_t sequence;
    k_msgq_purge(&replies);
    return ++sequence;
}

int zeroshift_relay_wait(uint32_t id, struct zeroshift_state *state) {
    k_timepoint_t deadline = sys_timepoint_calc(K_SECONDS(2));
    struct reply reply;
    while (!k_msgq_get(&replies, &reply, sys_timepoint_timeout(deadline))) {
        if (reply.id == id) {
            *state = reply.state;
            return reply.result;
        }
    }
    return -ETIMEDOUT;
}

void zeroshift_relay_complete(uint32_t id, int32_t result, const struct zeroshift_state *state) {
    struct reply reply = {.id = id, .result = result, .state = *state};
    k_msgq_put(&replies, &reply, K_NO_WAIT);
}
