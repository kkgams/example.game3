#ifndef GAME_RENDER2D_H
#define GAME_RENDER2D_H

#include "../vendor/sokol_gfx.h"
#include <stdint.h>

#define R2_MAX_TILEMAPS 64
#define R2_MAX_SPRITES 8192

// World coordinates are pixels, Y up. UVs are normalized atlas rectangles.
// Tile IDs in the RGBA8 LUT: R + 256*G + 65536*B; 0 is empty, 1 is
// the bottom-left tileset tile, then left-to-right and bottom-to-top.
typedef struct {
    float pos[2], tile_size[2], tileset_uv[4], lut_uv[4];
    float parallax[2], repeat[2];
} r2_tilemap;

typedef struct {
    float pos[2], z, opacity; // Depth 0 (near)..1 (far), on both backends.
    uint32_t flip; // H=1, V=2, anti-diagonal=4; only values 0..7.
    float uv[4], color_add[4]; // RGB tint + strength (0 leaves source unchanged).
    int32_t offset[2];
} r2_sprite;

typedef struct {
    float ortho[16]; // Column-major, consistent with the camera fields below.
    float pos[2], viewport[2], zoom; // Zoom is world pixels per viewport pixel.
} r2_camera;

typedef struct {
    sg_shader shader;
    sg_pipeline pipeline;
    sg_bindings bindings;
} r2_batch;

typedef struct {
    r2_batch tilemap, sprite;
    sg_buffer quad, indices;
    sg_view atlas_view, lut_view;
    sg_sampler sampler;
    float atlas_size[2], lut_size[2];
} r2_renderer;

// Initialize a zeroed renderer after sg_setup. Images are borrowed and must
// outlive it. Renderer owns all other resources and destroys them explicitly.
void r2_init(r2_renderer *r, sg_image atlas, sg_image lut);
void r2_destroy(r2_renderer *r);
// Call inside a compatible render pass, at most once per batch per frame.
// A zero count is a no-op; capacities and input invariants are asserted.
// Tilemaps use painter order; sprites use LESS_EQUAL depth with writes + alpha
// blending. Submit translucent sprites back-to-front; tilemaps before sprites.
void r2_draw_tilemaps(r2_renderer *r, const r2_camera *camera,
                      const r2_tilemap *maps, int count);
void r2_draw_sprites(r2_renderer *r, const r2_camera *camera,
                     const r2_sprite *sprites, int count);
// Centered, Y-up orthographic camera. Width/height are framebuffer pixels.
r2_camera r2_camera_make(float x, float y, float width, float height, float zoom);

#endif
