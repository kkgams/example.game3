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
    // Ranger and warning glyph in two unused 16x16 cells.
    for (int y = 32; y < 48; ++y) {
        for (int x = 0; x < 32; ++x) {
            int px = x % 16, py = y % 16;
            int dx = px - 7, dy = py - 7, r2 = dx*dx + dy*dy;
            bool body = x < 16 ? ((r2 >= 20 && r2 <= 42) || (dx >= -1 && dx <= 1 && dy >= -1 && dy <= 1)) :
                (px >= 6 && px <= 8 && ((py >= 6 && py <= 13) || (py >= 2 && py <= 3)));
            int p = (y * 128 + x) * 4;
            atlas[p] = atlas[p+1] = atlas[p+2] = 255;
            atlas[p+3] = body ? 255 : 0;
        }
    }
    // XP gem, blade, 8x4 bar segment and solid 16x16 panel tile in unused cells.
    for (int y = 0; y < 64; ++y) {
        for (int x = 32; x < 64; ++x) {
            bool gem = x >= 48 && y >= 32 && y < 48 &&
                (x % 16 > 7 ? x % 16 - 7 : 7 - x % 16) +
                (y % 16 > 7 ? y % 16 - 7 : 7 - y % 16) <= 2;
            bool bar = x >= 48 && x < 56 && y >= 16 && y < 20;
            bool panel = x < 48 && y >= 48;
            int px = x % 16, py = y % 16;
            bool blade = x >= 48 && y >= 48 && px >= 3 && px <= 12 &&
                ((px - py >= -1 && px - py <= 1) ||
                 (px >= 3 && px <= 6 && px + py >= 9 && px + py <= 11));
            if (!gem && !bar && !panel && !blade) continue;
            int p = (y * 128 + x) * 4;
            atlas[p] = atlas[p+1] = atlas[p+2] = atlas[p+3] = 255;
        }
    }
    // Distinct silhouettes for runner, brute, boss and hostile projectiles.
    for (int y = 48; y < 64; ++y) {
        for (int x = 64; x < 128; ++x) {
            int px = x % 16, py = y % 16;
            int dx = px > 7 ? px - 7 : 7 - px;
            int dy = py > 7 ? py - 7 : 7 - py;
            bool body;
            if (x < 80) body = py >= 3 && py <= 13 && dx <= (13 - py) / 2;
            else if (x < 96) body = px >= 2 && px <= 13 && py >= 2 && py <= 13 &&
                                   (px < 5 || px > 10 || py < 5 || py > 10);
            else if (x < 112) body = (dx + dy <= 7 && dx + dy >= 4) || (dx <= 1 && dy <= 1);
            else body = dx * dx + dy * dy <= 9;
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

enum { SPRITE_CAPACITY = 1 + 2 * SIM_MAX_ENEMIES + SIM_MAX_BULLETS + SIM_MAX_HOSTILE_BULLETS + SIM_MAX_GEMS + SIM_MAX_BLADES + 576 };
_Static_assert(SPRITE_CAPACITY <= R2_MAX_SPRITES, "game sprite capacity exceeds renderer");

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

typedef struct { float x, y; int width; } reward_card;

static reward_card reward_layout(int slot) {
    int columns = state.simulation.blade_count ? 3 : 2;
    assert(slot >= 0 && slot < columns * 2);
    return (reward_card){
        .x = columns == 3 ? (slot % columns - 1) * 104.0f : (slot % columns ? 72.0f : -72.0f),
        .y = slot < columns ? 40.0f : -40.0f,
        .width = columns == 3 ? 96 : 128,
    };
}

static bool choose_reward_slot(int slot) {
    assert(slot >= 0 && slot < 6);
    int option = slot;
    if (slot == 3) option = state.simulation.blade_count ? SIM_UPGRADE_BLADE_DAMAGE : SIM_UPGRADE_BLADES;
    else if (slot == 4) option = SIM_UPGRADE_BLADE_COUNT;
    else if (slot == 5) option = SIM_UPGRADE_BLADE_SPEED;
    if (!sim_choose_upgrade(&state.simulation, option)) return false;
    for (int i = 0; i < GAME_KEY_COUNT; ++i) state.keys[i] = false;
    return true;
}

static float viewport_zoom(int width, int height) {
    assert(width > 0 && height > 0);
    float x = 320.0f / width, y = 240.0f / height;
    return x > y ? x : y;
}

void app_choose_reward(float nx, float ny) {
    if (!state.simulation.choosing) return;
    // Pointer capture/window borders can produce coordinates outside the canvas.
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    sg_swapchain swapchain = get_sokol_swapchain();
    if (swapchain.width <= 0 || swapchain.height <= 0) return;
    float zoom = viewport_zoom(swapchain.width, swapchain.height);
    float x = (nx - .5f) * swapchain.width * zoom;
    float y = (.5f - ny) * swapchain.height * zoom;
    int count = state.simulation.blade_count ? 6 : 4;
    for (int i = 0; i < count; ++i) {
        reward_card card = reward_layout(i);
        if (x >= card.x - card.width / 2 && x <= card.x + card.width / 2 &&
            y >= card.y - 32 && y <= card.y + 32) {
            choose_reward_slot(i);
            return;
        }
    }
}

// Crop solid atlas cells into rectangles; no new shader or scaling contract.
static void add_ui_rect(r2_sprite *sprites, int *count, float cx, float cy,
                        int width, int height, const float color[3]) {
    for (int y = 0; y < height; y += 16) {
        for (int x = 0; x < width; x += 16) {
            int w = width - x < 16 ? width - x : 16;
            int h = height - y < 16 ? height - y : 16;
            assert(*count < SPRITE_CAPACITY);
            sprites[(*count)++] = (r2_sprite){
                .pos = {cx - width / 2.0f + x + w / 2.0f, cy - height / 2.0f + y + h / 2.0f},
                .opacity = 1, .uv = {.25f,.75f,.25f + w / 128.0f,.75f + h / 64.0f},
                .color_add = {color[0],color[1],color[2],1},
            };
        }
    }
}

static void add_card_text(r2_sprite *sprites, int *count, const char *text,
                          float x, float y, int width, bool enabled) {
    int length = 0;
    while (text[length]) ++length;
    assert(length * 8 <= width); // Never silently clip or truncate a card label.
    int start = *count;
    add_text(sprites, count, text, x - (length - 1) * 4 + 2, y);
    if (!enabled) {
        for (int i = start; i < *count; ++i) {
            sprites[i].color_add[0] = .45f;
            sprites[i].color_add[1] = .48f;
            sprites[i].color_add[2] = .52f;
            sprites[i].color_add[3] = 1;
        }
    }
}

static void add_reward_cards(r2_sprite *sprites, int *count, const sim_state *s) {
    const char *categories[] = {"SHOTS", "SHOTS", "PLAYER", "BLADES", "BLADES", "BLADES"};
    const char *names[] = {"DAMAGE", "FIRE RATE", "MOVE SPEED", s->blade_count ? "DAMAGE" : "UNLOCK", "COUNT", "SPIN SPEED"};
    const char *effects[] = {"PLUS 1", "FASTER", "PLUS 8", s->blade_count ? "PLUS 1" : "2 BLADES", "PLUS 1", "FASTER"};
    const bool enabled[] = {true, s->shot_interval > SIM_MIN_SHOT_TICKS, true, true,
        s->blade_count < SIM_MAX_BLADES, s->blade_speed < SIM_BLADE_MAX_SPEED};
    int cards = s->blade_count ? 6 : 4;
    add_card_text(sprites, count, "LEVEL UP", 0, 84, 320, true);
    for (int i = 0; i < cards; ++i) {
        reward_card card = reward_layout(i);
        const float body[] = {.035f,.05f,.075f};
        const float accent[] = {enabled[i] ? (i == 2 ? .9f : .3f) : .2f,
                                enabled[i] ? .75f : .25f, enabled[i] ? .85f : .3f};
        add_ui_rect(sprites, count, card.x, card.y, card.width, 64, body);
        add_ui_rect(sprites, count, card.x, card.y + 31, card.width, 2, accent);
        add_ui_rect(sprites, count, card.x, card.y - 31, card.width, 2, accent);
        add_ui_rect(sprites, count, card.x - card.width / 2 + 1, card.y, 2, 60, accent);
        add_ui_rect(sprites, count, card.x + card.width / 2 - 1, card.y, 2, 60, accent);
        float badge_x = card.x - card.width / 2 + 12;
        add_ui_rect(sprites, count, badge_x, card.y + 20, 16, 16, accent);
        char key[] = {(char)('1' + i), 0};
        add_card_text(sprites, count, key, badge_x, card.y + 20, 16, enabled[i]);
        add_card_text(sprites, count, categories[i], card.x + 8, card.y + 20, card.width - 32, enabled[i]);
        add_card_text(sprites, count, names[i], card.x, card.y, card.width - 16, enabled[i]);
        add_card_text(sprites, count, enabled[i] ? effects[i] : "MAX", card.x, card.y - 20, card.width - 16, enabled[i]);
    }
    add_card_text(sprites, count, "CHOOSE ONE REWARD", 0, -88, 320, true);
    add_card_text(sprites, count, s->blade_count ? "PRESS 1 TO 6 OR CLICK" : "PRESS 1 TO 4 OR CLICK", 0, -104, 320, true);
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
    bool was_choosing = state.simulation.choosing;
    sim_advance(&state.simulation, input, elapsed);
    if (!was_choosing && state.simulation.choosing)
        for (int i = 0; i < GAME_KEY_COUNT; ++i) state.keys[i] = false;
    if (input.x && !state.simulation.dead && !state.simulation.won && !state.simulation.choosing) state.face_left = input.x < 0;
    r2_camera camera = r2_camera_make(0, 0, (float)swapchain.width,
                                     (float)swapchain.height,
                                     viewport_zoom(swapchain.width, swapchain.height));
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
        .pos = {s->x,s->y}, .opacity = !s->dead && !s->won && s->hurt_ticks && (s->ticks / 8) % 2 ? .3f : 1,
        .uv = {0,0,.125f,.25f}, .flip = state.face_left ? 1 : 0,
        .color_add = {1,0,0,s->dead ? 1 : 0},
    };
    for (int i = 0; i < s->blade_count; ++i) {
        float x, y;
        if (!sim_blade_position(s, i, &x, &y)) continue;
        sprites[count++] = (r2_sprite){
            .pos = {x,y}, .opacity = 1, .flip = i % 2,
            .uv = {.375f,.75f,.5f,1}, .color_add = {.65f,1,.9f,1},
        };
    }
    for (int i = 0; i < SIM_MAX_GEMS; ++i) {
        const sim_gem *gem = &s->gems[i];
        if (!gem->active) continue;
        assert(gem->value > 0);
        // Color reflects actual stored XP, including full-pool merges.
        const float colors[3][3] = {{.65f,.4f,1}, {.25f,.65f,1}, {1,.8f,.15f}};
        int tier = gem->value >= 5 ? 2 : gem->value >= 2 ? 1 : 0;
        sprites[count++] = (r2_sprite){
            .pos = {gem->x,gem->y}, .opacity = 1,
            .uv = {.375f,.5f,.5f,.75f},
            .color_add = {colors[tier][0],colors[tier][1],colors[tier][2],1},
        };
    }
    const sim_enemy *boss = 0;
    for (int i = 0; i < SIM_MAX_ENEMIES; ++i) {
        const sim_enemy *enemy = &s->enemies[i];
        if (!enemy->active) continue;
        assert(enemy->kind >= SIM_CHASER && enemy->kind < SIM_ENEMY_KIND_COUNT);
        const float colors[SIM_ENEMY_KIND_COUNT][3] = {
            {1,.22f,.3f}, {.6f,1,.25f}, {.3f,.65f,1}, {1,.85f,.15f}, {.85f,.4f,1},
        };
        float u = enemy->kind == SIM_CHASER ? .25f : .5f + (enemy->kind - 1) * .125f;
        float v = enemy->kind == SIM_CHASER ? 0 : .75f;
        if (enemy->kind == SIM_RANGER) { u = 0; v = .5f; }
        sprites[count++] = (r2_sprite){
            .pos = {enemy->x,enemy->y}, .opacity = 1,
            .uv = {u,v,u + .125f,v + .25f},
            .color_add = {colors[enemy->kind][0],colors[enemy->kind][1],colors[enemy->kind][2],1},
        };
        if (enemy->kind == SIM_RANGER && enemy->attack_ticks > 0) {
            sprites[count-1].color_add[0] = 1;
            sprites[count-1].color_add[1] = .8f;
            sprites[count-1].color_add[2] = .2f;
            sprites[count++] = (r2_sprite){
                .pos = {enemy->x,enemy->y + 12}, .opacity = 1,
                .uv = {.125f,.5f,.25f,.75f}, .color_add = {1,.65f,.15f,1},
            };
        }
        if (enemy->kind == SIM_BOSS) {
            boss = enemy;
            if (enemy->hp <= SIM_BOSS_HP / 2) {
                sprites[count-1].color_add[1] = .25f;
                sprites[count-1].color_add[2] = .05f;
            }
        }
    }
    for (int i = 0; i < SIM_MAX_BULLETS; ++i) {
        if (!s->bullets[i].active) continue;
        sprites[count++] = (r2_sprite){
            .pos = {s->bullets[i].x,s->bullets[i].y}, .opacity = 1,
            .uv = {.375f,0,.5f,.25f}, .color_add = {.4f,1,1,1},
        };
    }
    for (int i = 0; i < SIM_MAX_HOSTILE_BULLETS; ++i) {
        if (!s->hostile_bullets[i].active) continue;
        sprites[count++] = (r2_sprite){
            .pos = {s->hostile_bullets[i].x,s->hostile_bullets[i].y}, .opacity = 1,
            .uv = {.875f,.75f,1,1}, .color_add = {1,.3f,.65f,1},
        };
    }
    add_text(sprites, &count, "TIME", -52, 96);
    unsigned remaining = s->ticks < SIM_BOSS_TICKS ? (SIM_BOSS_TICKS - s->ticks + 119) / 120 : 0;
    add_number(sprites, &count, remaining, -12, 96);
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
    add_text(sprites, &count, "LV", -132, 112);
    add_number(sprites, &count, (unsigned)s->level, -108, 112);
    add_text(sprites, &count, "XP", -72, 112);
    float fraction = (float)s->xp / s->xp_next;
    int filled = fraction >= 1 ? 16 : (int)(fraction * 16);
    for (int i = 0; i < 16; ++i) {
        sprites[count++] = (r2_sprite){
            .pos = {-44 + i * 8.0f,112}, .opacity = 1,
            .uv = {.375f,.25f,.4375f,.3125f},
            .color_add = {i < filled ? .65f : .12f, i < filled ? .4f : .12f,
                          i < filled ? 1 : .2f, 1},
        };
    }
    add_number(sprites, &count, (unsigned)s->xp, 96, 112);
    add_text(sprites, &count, "OF", 112, 112);
    add_number(sprites, &count, (unsigned)s->xp_next, 136, 112);
    if (s->choosing) {
        add_reward_cards(sprites, &count, s);
    } else if (s->dead || s->won) {
        add_text(sprites, &count, s->won ? "YOU WIN" : "YOU DIED", s->won ? -24 : -28, -96);
        add_text(sprites, &count, "R RETRY", -24, -108);
    } else if (s->boss_started) {
        assert(boss);
        add_text(sprites, &count, "BOSS", -132, -96);
        int bars = (boss->hp * 16 + SIM_BOSS_HP - 1) / SIM_BOSS_HP;
        for (int i = 0; i < 16; ++i) {
            sprites[count++] = (r2_sprite){
                .pos = {-80 + i * 8.0f,-96}, .opacity = 1,
                .uv = {.375f,.25f,.4375f,.3125f},
                .color_add = {i < bars ? 1 : .15f, i < bars ? .45f : .12f, .1f, 1},
            };
        }
        add_number(sprites, &count, (unsigned)boss->hp, 56, -96);
        add_text(sprites, &count, "OF", 88, -96);
        add_number(sprites, &count, SIM_BOSS_HP, 112, -96);
        add_text(sprites, &count, "DEFEAT THE BOSS", -52, -108);
    } else {
        add_text(sprites, &count, "WAVE", -132, -100);
        add_number(sprites, &count, (unsigned)sim_wave(s), -92, -100);
        add_text(sprites, &count, s->blade_count ? "SHOT AND BLADES" : "AUTO FIRE", s->blade_count ? -52 : -32, -100);
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
    if (e->type == SAPP_EVENTTYPE_MOUSE_DOWN && e->mouse_button == SAPP_MOUSEBUTTON_LEFT &&
        state.simulation.choosing) {
        assert(e->window_width > 0 && e->window_height > 0);
        app_choose_reward(e->mouse_x / e->window_width, e->mouse_y / e->window_height);
        return;
    }
    if (e->type != SAPP_EVENTTYPE_KEY_DOWN && e->type != SAPP_EVENTTYPE_KEY_UP) return;
    if (e->type == SAPP_EVENTTYPE_KEY_DOWN && e->key_code == SAPP_KEYCODE_R &&
        !e->key_repeat && (state.simulation.dead || state.simulation.won)) {
        sim_init(&state.simulation);
        for (int i = 0; i < GAME_KEY_COUNT; ++i) state.keys[i] = false;
        state.face_left = false;
        return;
    }
    if (e->type == SAPP_EVENTTYPE_KEY_DOWN && !e->key_repeat &&
        e->key_code >= SAPP_KEYCODE_1 && e->key_code <= SAPP_KEYCODE_6) {
        choose_reward_slot(e->key_code - SAPP_KEYCODE_1);
        return;
    }
    if (state.simulation.choosing && e->type == SAPP_EVENTTYPE_KEY_DOWN) return;
    const sapp_keycode codes[GAME_KEY_COUNT] = {
        SAPP_KEYCODE_W, SAPP_KEYCODE_A, SAPP_KEYCODE_S, SAPP_KEYCODE_D,
        SAPP_KEYCODE_UP, SAPP_KEYCODE_LEFT, SAPP_KEYCODE_DOWN, SAPP_KEYCODE_RIGHT,
    };
    for (int i = 0; i < GAME_KEY_COUNT; ++i) {
        if (e->key_code == codes[i]) state.keys[i] = e->type == SAPP_EVENTTYPE_KEY_DOWN;
    }
}
