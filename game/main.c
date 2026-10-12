#include "vendor/sokol_app.h"
#include "vendor/sokol_gfx.h"
#include "vendor/sokol_log.h"

#include "triangle-sapp.glsl.h"

sg_swapchain get_sokol_swapchain(void); // sglue_swapchain or web variant
static struct {
  sg_pipeline pip;
  sg_bindings bind;
  sg_pass_action pass_action;
  float mouse_y;
  int window_height;
} state;

void init(void) {
  float vertices[] = {0.0f,  0.5f,  0.5f, 1.0f, 0.0f, 0.0f, 1.0f,
                      0.5f,  -0.5f, 0.5f, 0.0f, 1.0f, 0.0f, 1.0f,
                      -0.5f, -0.5f, 0.5f, 0.0f, 0.0f, 1.0f, 1.0f};
  state.bind.vertex_buffers[0] = sg_make_buffer(&(sg_buffer_desc){
      .data = SG_RANGE(vertices),
  });

  state.pip = sg_make_pipeline(&(sg_pipeline_desc){
      .shader = sg_make_shader(triangle_shader_desc(sg_query_backend())),
      .layout = {.attrs = {[ATTR_triangle_position].format =
                               SG_VERTEXFORMAT_FLOAT3,
                           [ATTR_triangle_color0].format =
                               SG_VERTEXFORMAT_FLOAT4}},
  });

  state.pass_action =
      (sg_pass_action){.colors[0] = {.load_action = SG_LOADACTION_CLEAR,
                                     .clear_value = {0.0f, 0.0f, 0.0f, 1.0f}}};

  state.mouse_y = 0.0f;
  state.window_height = get_sokol_swapchain().height;
}

void frame(void) {
  // Calculate rotation angle based on mouse Y position (0-360 degrees)
  // Mouse Y ranges from 0 (top) to window_height (bottom)
  float normalized_y = 1.0f - (state.mouse_y / (float)state.window_height);
  float angle = normalized_y * 2.0f * 3.14159f; // 0 to 2*PI radians (0-360 deg)

  vs_params_t vs_params = {.angle = angle};

  sg_begin_pass(&(sg_pass){.action = state.pass_action,
                           .swapchain = get_sokol_swapchain()});
  sg_apply_pipeline(state.pip);
  sg_apply_bindings(&state.bind);
  sg_apply_uniforms(UB_vs_params, &SG_RANGE(vs_params));
  sg_draw(0, 3, 1);
  sg_end_pass();
  sg_commit();
}

void cleanup(void) { sg_shutdown(); }

void event(const sapp_event *e) {
  switch (e->type) {
  case SAPP_EVENTTYPE_MOUSE_MOVE: {
    state.mouse_y = e->mouse_y;
    break;
  }
  case SAPP_EVENTTYPE_RESIZED: {
    state.window_height = e->framebuffer_height;
    break;
  }
  default:
    break;
  }
}
