if(CONFIG_SHIELD_ZEROSHIFT_DEMO AND CONFIG_ZMK_ZEROSHIFT)
  target_sources(app PRIVATE src/slot.c)
endif()
