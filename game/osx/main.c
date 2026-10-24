#include "../app.h"
#include "../vendor/sokol_gfx.h"
#include "../vendor/sokol_log.h"
#include "../vendor/sokol_glue.h"
#include <string.h>

static bool smoke_test;
static unsigned smoke_frames;

sg_swapchain get_sokol_swapchain(void) { return sglue_swapchain(); }

static void init_with_gl(void) {
  sg_setup(&(sg_desc){
      .environment = sglue_environment(),
      .logger.func = slog_func,
  });
  init();
}

static void frame_with_smoke_test(void) {
  frame(sapp_frame_duration());
  if (smoke_test && ++smoke_frames == 3) {
    sapp_request_quit();
  }
}

sapp_desc sokol_main(int argc, char *argv[]) {
  smoke_test = argc == 2 && strcmp(argv[1], "--smoke-test") == 0;
  return (sapp_desc){
      .init_cb = init_with_gl,
      .frame_cb = frame_with_smoke_test,
      .cleanup_cb = cleanup,
      .event_cb = event,
      .width = 640,
      .height = 480,
      .window_title = "example.game3 — Survivor combat",
      .icon.sokol_default = true,
      .logger.func = slog_func,
  };
}
