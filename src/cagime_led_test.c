// SPDX-License-Identifier: MIT

#include <drivers/behavior.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/led_strip.h>
#include <zephyr/init.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zmk/events/activity_state_changed.h>

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#define LED_TEST DT_NODELABEL(cagime_led_test)
#define LED_STRIP DT_PHANDLE(LED_TEST, strip)
#define MAX_RED DT_PROP(LED_TEST, max_channel_value)
#define TEST_DURATION_MS 10000

BUILD_ASSERT(MAX_RED > 0 && MAX_RED <= UINT8_MAX);

static const struct gpio_dt_spec power = GPIO_DT_SPEC_GET(LED_TEST, power_gpios);
static const struct device *const strip = DEVICE_DT_GET(LED_STRIP);
static bool power_ready;
static bool powered;
static int64_t expires_at;

K_MUTEX_DEFINE(led_lock);

static void power_off(void) {
    if (powered) {
        int err = gpio_pin_set_dt(&power, 0);
        if (err < 0) {
            LOG_ERR("CaGiMe LED power off failed: %d", err);
            return;
        }
        powered = false;
    }
}

static void expire_test(struct k_work *work) {
    k_mutex_lock(&led_lock, K_FOREVER);
    if (k_uptime_get() >= expires_at) {
        power_off();
    }
    k_mutex_unlock(&led_lock);
}

K_WORK_DELAYABLE_DEFINE(led_timeout, expire_test);

static int write_red(uint8_t red) {
    struct led_rgb pixels[DT_PROP(LED_STRIP, chain_length)] = {0};

    for (size_t i = 0; i < ARRAY_SIZE(pixels); i++) {
        pixels[i].r = red;
    }

    return led_strip_update_rgb(strip, pixels, ARRAY_SIZE(pixels));
}

static int test_led(uint8_t red) {
    if (!power_ready || !device_is_ready(strip)) {
        return -ENODEV;
    }

    if (!powered) {
        int err = gpio_pin_set_dt(&power, 1);
        if (err < 0) {
            return err;
        }
        powered = true;

        /* Let the switched rail settle and latch an all-zero frame first. */
        k_msleep(2);
        err = write_red(0);
        if (err < 0) {
            power_off();
            return err;
        }
    }

    int err = write_red(red);
    if (err < 0) {
        power_off();
        return err;
    }

    expires_at = k_uptime_get() + TEST_DURATION_MS;
    err = k_work_reschedule(&led_timeout, K_TIMEOUT_ABS_MS(expires_at));
    if (err < 0) {
        power_off();
        return err;
    }
    return 0;
}

static int on_pressed(struct zmk_behavior_binding *binding,
                      struct zmk_behavior_binding_event event) {
    int err = 0;

    k_mutex_lock(&led_lock, K_FOREVER);
    if (binding->param1 == 0) {
        power_off();
    } else {
        /* Clamp every write. Only the red channel is exposed, with no stored state. */
        err = test_led(MIN(binding->param1, MAX_RED));
    }
    k_mutex_unlock(&led_lock);
    return err;
}

static int on_released(struct zmk_behavior_binding *binding,
                       struct zmk_behavior_binding_event event) {
    return ZMK_BEHAVIOR_OPAQUE;
}

static int on_activity(const zmk_event_t *event) {
    if (as_zmk_activity_state_changed(event)->state != ZMK_ACTIVITY_ACTIVE) {
        k_mutex_lock(&led_lock, K_FOREVER);
        power_off();
        k_mutex_unlock(&led_lock);
    }
    return ZMK_EV_EVENT_BUBBLE;
}

ZMK_LISTENER(cagime_led, on_activity);
ZMK_SUBSCRIPTION(cagime_led, zmk_activity_state_changed);

static int init_led_power(void) {
    if (!gpio_is_ready_dt(&power)) {
        return -ENODEV;
    }

    int err = gpio_pin_configure_dt(&power, GPIO_OUTPUT_INACTIVE);
    power_ready = (err == 0);
    return err;
}

SYS_INIT(init_led_power, POST_KERNEL, 0);

static const struct behavior_driver_api led_test_api = {
    .locality = BEHAVIOR_LOCALITY_EVENT_SOURCE,
    .binding_pressed = on_pressed,
    .binding_released = on_released,
};

BEHAVIOR_DT_DEFINE(LED_TEST, NULL, NULL, NULL, NULL, POST_KERNEL, 95, &led_test_api);
