if(CONFIG_ZMK_ZEROSHIFT)
  zephyr_include_directories(include)
  target_sources(app PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src/profile.c)
endif()
