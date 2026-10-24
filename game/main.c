#include "app.h"
#include "sim.h"
#include "render/render2d.h"
#include "font.h"
#include <assert.h>

sg_swapchain get_sokol_swapchain(void);

// Procedural assets and hard-coded spawns; decoder/director remain deferred.
static struct {
    r2_renderer renderer;
    sg_image atlas, lut;
    sim_state simulation;
    bool keys[GAME_KEY_COUNT];
    bool face_left;
} state;

void init(void) {
    sim_init(&state.simulation);
    for (int i = 0; i < GAME_KEY_COUNT; ++i) state.keys[i] = false;
    state.face_left = false;
    uint8_t atlas[128 * 64 * 4] = {0};
    for (int y = 0; y < 32; ++y) {
        for (int x = 0; x < 32; ++x) {
            int p = (y * 128 + x) * 4;
            bool edge = x % 16 == 0 || y % 16 == 0;
            if (y >= 16) { // IDs 1 and 2: two dark floor tiles.
                atlas[p] = x < 16 ? 33 : 42;
                atlas[p+1] = x < 16 ? 46 : 56;
                atlas[p+2] = x < 16 ? 58 : 69;
                atlas[p+3] = 255;
            } else if (x >= 16) { // ID 4: arena border.
                atlas[p] = edge ? 44 : 69;
                atlas[p+1] = edge ? 88 : 130;
                atlas[p+2] = edge ? 101 : 143;
                atlas[p+3] = 255;
            } else { // ID 3: placeholder player, facing right.
                bool body = (x >= 4 && x <= 11 && y >= 3 && y <= 9) ||
                            (x >= 5 && x <= 10 && y >= 9 && y <= 13);
                atlas[p] = x < 7 ? 255 : 245;
                atlas[p+1] = x < 7 ? 200 : 100;
                atlas[p+2] = 70;
                atlas[p+3] = body ? 255 : 0;
            }
        }
    }
    // Extra cells: enemy, projectile and health pip. White permits exact tint.
    for (int y = 0; y < 32; ++y) {
        for (int x = 32; x < 64; ++x) {
            int px = x % 16, py = y % 16;
            bool body = y >= 16 ? (px >= 4 && px <= 11 && py >= 4 && py <= 11) :
                x < 48 ? (px >= 3 && px <= 12 && py >= 3 && py <= 12) :
                         (px >= 6 && px <= 9 && py >= 6 && py <= 9);
            int p = (y * 128 + x) * 4;
            atlas[p] = atlas[p+1] = atlas[p+2] = 255;
            atlas[p+3] = body ? 255 : 0;
        }
    }
    for (int g = 0; g < 36; ++g) {
        for (int row = 0; row < 7; ++row) {
            for (int col = 0; col < 5; ++col) {
                int x = 64 + (g % 8) * 8 + col;
                int y = (g / 8) * 8 + 6 - row;
                int p = (y * 128 + x) * 4;
                atlas[p] = atlas[p+1] = atlas[p+2] = 255;
                atlas[p+3] = (game_glyphs[g][row] & (1 << (4-col))) ? 255 : 0;
            }
        }
    }
    uint8_t lut[SIM_WIDTH * (SIM_HEIGHT + 1) * 4] = {0};
    for (int y = 0; y <= SIM_HEIGHT; ++y) {
        for (int x = 0; x < SIM_WIDTH; ++x) {
            int p = (y * SIM_WIDTH + x) * 4;
            lut[p] = y == 0 ? 1 : sim_tile(x, y - 1);
            lut[p+3] = 255;
        }
    }
    state.atlas = sg_make_image(&(sg_image_desc){
        .width = 128, .height = 64, .pixel_format = SG_PIXELFORMAT_RGBA8,
        .data.mip_levels[0] = SG_RANGE(atlas), .label = "fixture-atlas",
    });
    state.lut = sg_make_image(&(sg_image_desc){
        .width = SIM_WIDTH, .height = SIM_HEIGHT + 1, .pixel_format = SG_PIXELFORMAT_RGBA8,
        .data.mip_levels[0] = SG_RANGE(lut), .label = "fixture-tile-lut",
    });
    r2_init(&state.renderer, state.atlas, state.lut);
}

enum { SPRITE_CAPACITY = 1 + SIM_MAX_ENEMIES + SIM_MAX_BULLETS + 128 };

static void add_text(r2_sprite *sprites, int *count, const char *text, float x, float y) {
    for (int i = 0; text[i]; ++i) {
        if (text[i] == ' ') continue;
        assert(*count < SPRITE_CAPACITY);
        int glyph = game_glyph_index(text[i]);
        float u = (64 + (glyph % 8) * 8) / 128.0f;
        float v = ((glyph / 8) * 8) / 64.0f;
        sprites[(*count)++] = (r2_sprite){
            .pos = {x + i * 8, y}, .opacity = 1,
            .uv = {u,v,u + 8.0f/128,v + 8.0f/64},
        };
    }
}

static void add_number(r2_sprite *sprites, int *count, unsigned number, float x, float y) {
    char text[11], reversed[10];
    int n = 0;
    do { reversed[n++] = (char)('0' + number % 10); number /= 10; } while (number);
    for (int i = 0; i < n; ++i) text[i] = reversed[n - 1 - i];
    text[n] = 0;
    add_text(sprites, count, text, x, y);
}

void frame(double elapsed) {
    sg_swapchain swapchain = get_sokol_swapchain();
    if (swapchain.width <= 0 || swapchain.height <= 0) return;
    sim_input input = {
        .x = (state.keys[GAME_KEY_D] || state.keys[GAME_KEY_RIGHT]) -
             (state.keys[GAME_KEY_A] || state.keys[GAME_KEY_LEFT]),
        .y = (state.keys[GAME_KEY_W] || state.keys[GAME_KEY_UP]) -
             (state.keys[GAME_KEY_S] || state.keys[GAME_KEY_DOWN]),
    };
    sim_advance(&state.simulation, input, elapsed);
    if (input.x && !state.simulation.dead) state.face_left = input.x < 0;
    float zoom_x = 320.0f / swapchain.width;
    float zoom_y = 240.0f / swapchain.height;
    r2_camera camera = r2_camera_make(0, 0, (float)swapchain.width,
                                     (float)swapchain.height,
                                     zoom_x > zoom_y ? zoom_x : zoom_y);
    r2_tilemap maps[] = {
        {.tile_size = {16,16}, .tileset_uv = {0,0,.25f,.5f},
         .lut_uv = {0,0,1.0f/SIM_WIDTH,1.0f/(SIM_HEIGHT + 1)},
         .parallax = {1,1}, .repeat = {1,1}},
        {.pos = {SIM_ORIGIN_X,SIM_ORIGIN_Y},
         .tile_size = {SIM_TILE_SIZE,SIM_TILE_SIZE}, .tileset_uv = {0,0,.25f,.5f},
         .lut_uv = {0,1.0f/(SIM_HEIGHT + 1),1,1}},
    };
    const sim_state *s = &state.simulation;
    r2_sprite sprites[SPRITE_CAPACITY] = {0};
    int count = 0;
    // Player stays first in the upload for integration checks.
    sprites[count++] = (r2_sprite){
        .pos = {s->x,s->y}, .opacity = s->hurt_ticks && (s->ticks / 8) % 2 ? .3f : 1,
        .uv = {0,0,.125f,.25f}, .flip = state.face_left ? 1 : 0,
        .color_add = {1,0,0,s->dead ? 1 : 0},
    };
    for (int i = 0; i < SIM_MAX_ENEMIES; ++i) {
        const sim_enemy *enemy = &s->enemies[i];
        if (!enemy->active) continue;
        sprites[count++] = (r2_sprite){
            .pos = {enemy->x,enemy->y}, .opacity = 1,
            .uv = {.25f,0,.375f,.25f}, .color_add = {1,.22f,.3f,1},
        };
    }
    for (int i = 0; i < SIM_MAX_BULLETS; ++i) {
        if (!s->bullets[i].active) continue;
        sprites[count++] = (r2_sprite){
            .pos = {s->bullets[i].x,s->bullets[i].y}, .opacity = 1,
            .uv = {.375f,0,.5f,.25f}, .color_add = {.4f,1,1,1},
        };
    }
    add_text(sprites, &count, "HP", -132, 96);
    for (int i = 0; i < SIM_MAX_HP; ++i) {
        sprites[count++] = (r2_sprite){
            .pos = {-108 + i * 16.0f,96}, .opacity = 1,
            .uv = {.25f,.25f,.375f,.5f},
            .color_add = {i < s->hp ? .3f : .15f, i < s->hp ? 1 : .15f, .2f, 1},
        };
    }
    add_text(sprites, &count, "KILLS", 40, 96);
    add_number(sprites, &count, (unsigned)s->kills, 88, 96);
    if (s->dead) {
        add_text(sprites, &count, "YOU DIED", -28, -96);
        add_text(sprites, &count, "R RETRY", -24, -108);
    } else {
        add_text(sprites, &count, "AUTO FIRE", -32, -100);
    }
    sg_begin_pass(&(sg_pass){
        .action = {.colors[0] = {.load_action = SG_LOADACTION_CLEAR,
                                 .clear_value = {.05f,.06f,.08f,1}},
                   .depth = {.load_action = SG_LOADACTION_CLEAR, .clear_value = 1}},
        .swapchain = swapchain,
    });
    r2_draw_tilemaps(&state.renderer, &camera, maps, 2);
    r2_draw_sprites(&state.renderer, &camera, sprites, count);
    sg_end_pass();
    sg_commit();
}

void cleanup(void) {
    r2_destroy(&state.renderer);
    sg_destroy_image(state.atlas);
    sg_destroy_image(state.lut);
    sg_shutdown();
    for (int i = 0; i < GAME_KEY_COUNT; ++i) state.keys[i] = false;
}

void event(const sapp_event *e) {
    assert(e);
    if (e->type == SAPP_EVENTTYPE_UNFOCUSED || e->type == SAPP_EVENTTYPE_SUSPENDED) {
        for (int i = 0; i < GAME_KEY_COUNT; ++i) state.keys[i] = false;
        state.simulation.accumulator = 0;
        return;
    }
    if (e->type != SAPP_EVENTTYPE_KEY_DOWN && e->type != SAPP_EVENTTYPE_KEY_UP) return;
    if (e->type == SAPP_EVENTTYPE_KEY_DOWN && e->key_code == SAPP_KEYCODE_R &&
        !e->key_repeat && state.simulation.dead) {
        sim_init(&state.simulation);
        for (int i = 0; i < GAME_KEY_COUNT; ++i) state.keys[i] = false;
        state.face_left = false;
        return;
    }
    const sapp_keycode codes[GAME_KEY_COUNT] = {
        SAPP_KEYCODE_W, SAPP_KEYCODE_A, SAPP_KEYCODE_S, SAPP_KEYCODE_D,
        SAPP_KEYCODE_UP, SAPP_KEYCODE_LEFT, SAPP_KEYCODE_DOWN, SAPP_KEYCODE_RIGHT,
    };
    for (int i = 0; i < GAME_KEY_COUNT; ++i) {
        if (e->key_code == codes[i]) state.keys[i] = e->type == SAPP_EVENTTYPE_KEY_DOWN;
    }
}
