#include <stddef.h>
#include <stdint.h>

#define SOKOL_GLES3
#define SOKOL_EXTERNAL_GL_LOADER

// Include GL types before sokol_gfx.h when using external loader
#include <GLES3/gl3.h>
#include <gl_funcs.h>

#include "../app.h"
#include <assert.h>

#define SOKOL_IMPL
#include "../vendor/sokol_gfx.h"

// Custom minimal logger for freestanding WASM (no sokol_log.h)
void slog_func(const char *tag, uint32_t log_level, uint32_t log_item,
               const char *message, uint32_t line_nr, const char *filename,
               void *user_data) {
  __attribute__((import_module("env"), import_name("game_log"))) void
  game_log(uint32_t level, const char *message, uint32_t item);
  game_log(log_level, message, log_item);
  (void)tag;
  (void)line_nr;
  (void)filename;
  (void)user_data;
}

// JS imports
__attribute__((import_module("env"), import_name("js_canvas_width"))) int
js_canvas_width(void);

__attribute__((import_module("env"), import_name("js_canvas_height"))) int
js_canvas_height(void);

__attribute__((import_module("env"),
               import_name("js_webgl_framebuffer"))) unsigned int
js_webgl_framebuffer(void);

// Supply swapchain for main.c
sg_swapchain get_sokol_swapchain(void) {
  sg_swapchain sc = {0};
  sc.width = js_canvas_width();
  sc.height = js_canvas_height();
  sc.color_format = SG_PIXELFORMAT_RGBA8;
  sc.depth_format = SG_PIXELFORMAT_DEPTH_STENCIL;
  sc.sample_count = 1;
  sc.gl.framebuffer = js_webgl_framebuffer();
  return sc;
}

// Platform init - calls app init, exports as "init" to JS
__attribute__((visibility("default"), export_name("init"))) void
platform_init(void) {
  sg_desc desc = {0};
  desc.logger.func = slog_func;
  desc.environment.defaults.color_format = SG_PIXELFORMAT_RGBA8;
  desc.environment.defaults.depth_format = SG_PIXELFORMAT_DEPTH_STENCIL;
  desc.environment.defaults.sample_count = 1;
  sg_setup(&desc);
  init(); // App init from main.c
}

// Platform frame - calls app frame, exports as "frame" to JS
__attribute__((visibility("default"), export_name("frame"))) void
platform_frame(double elapsed) {
  frame(elapsed); // Seconds supplied by requestAnimationFrame, shared simulation.
}

// Platform cleanup - calls app cleanup, exports as "cleanup" to JS
__attribute__((visibility("default"), export_name("cleanup"))) void
platform_cleanup(void) {
  cleanup(); // App cleanup from main.c
}

// Scalar input ABI keeps JS independent of sapp_event enum values and layout.
__attribute__((export_name("resize"))) void platform_resize(int width, int height) {
  sapp_event e = {.type = SAPP_EVENTTYPE_RESIZED,
                  .framebuffer_width = width, .framebuffer_height = height};
  event(&e);
}

__attribute__((export_name("mouse_move"))) void platform_mouse_move(float x, float y) {
  sapp_event e = {.type = SAPP_EVENTTYPE_MOUSE_MOVE, .mouse_x = x, .mouse_y = y};
  event(&e);
}

// Browser physical-key ABI. Keep WASD and arrows independent so releasing
// one binding cannot cancel a different held binding of the same direction.
__attribute__((export_name("key"))) void platform_key(int key, int down) {
  const sapp_keycode codes[GAME_KEY_COUNT] = {
    SAPP_KEYCODE_W, SAPP_KEYCODE_A, SAPP_KEYCODE_S, SAPP_KEYCODE_D,
    SAPP_KEYCODE_UP, SAPP_KEYCODE_LEFT, SAPP_KEYCODE_DOWN, SAPP_KEYCODE_RIGHT,
  };
  assert(key >= 0 && key < GAME_KEY_COUNT && (down == 0 || down == 1));
  sapp_event e = {.type = down ? SAPP_EVENTTYPE_KEY_DOWN : SAPP_EVENTTYPE_KEY_UP,
                  .key_code = codes[key]};
  event(&e);
}

__attribute__((export_name("release_keys"))) void platform_release_keys(void) {
  sapp_event e = {.type = SAPP_EVENTTYPE_UNFOCUSED};
  event(&e);
}

// UI slots 0..5 map to physical 1..6, not simulation upgrade enum values.
// Slot 3 unlocks blades first and upgrades their damage thereafter.
__attribute__((export_name("choose_upgrade"))) void platform_choose_upgrade(int option) {
  assert(option >= 0 && option < 6);
  sapp_event e = {.type = SAPP_EVENTTYPE_KEY_DOWN,
                  .key_code = (sapp_keycode)(SAPP_KEYCODE_1 + option)};
  event(&e);
}

__attribute__((export_name("choose_reward"))) void platform_choose_reward(float x, float y) {
  app_choose_reward(x, y);
}

__attribute__((export_name("retry"))) void platform_retry(void) {
  sapp_event e = {.type = SAPP_EVENTTYPE_KEY_DOWN, .key_code = SAPP_KEYCODE_R};
  event(&e);
}

// Platform event - calls app event, exports as "event" to JS
__attribute__((visibility("default"), export_name("event"))) void
platform_event(uint32_t event_ptr) {
  const sapp_event* e = (const sapp_event*)event_ptr;
  event(e); // App event from main.c
}

// Get event buffer for JS to write event data
static sapp_event g_event_buffer;
__attribute__((visibility("default"), export_name("get_event_buffer"))) uint32_t
platform_get_event_buffer(void) {
  return (uint32_t)&g_event_buffer;
}

// Export critical field offsets for JS to use
__attribute__((visibility("default"), export_name("event_offset_mouse_x"))) uint32_t
event_offset_mouse_x(void) { return offsetof(sapp_event, mouse_x); }

__attribute__((visibility("default"), export_name("event_offset_mouse_y"))) uint32_t
event_offset_mouse_y(void) { return offsetof(sapp_event, mouse_y); }

__attribute__((visibility("default"), export_name("event_offset_window_width"))) uint32_t
event_offset_window_width(void) { return offsetof(sapp_event, window_width); }

__attribute__((visibility("default"), export_name("event_offset_window_height"))) uint32_t
event_offset_window_height(void) { return offsetof(sapp_event, window_height); }

__attribute__((visibility("default"), export_name("event_offset_framebuffer_width"))) uint32_t
event_offset_framebuffer_width(void) { return offsetof(sapp_event, framebuffer_width); }

__attribute__((visibility("default"), export_name("event_offset_framebuffer_height"))) uint32_t
event_offset_framebuffer_height(void) { return offsetof(sapp_event, framebuffer_height); }
