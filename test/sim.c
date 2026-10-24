#include "sim.h"

#include <assert.h>
#include <float.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

static void near(double actual, double expected, double tolerance) {
    const double difference = actual - expected;
    assert(difference >= -tolerance && difference <= tolerance);
}

static void free_body(const sim_state *state) {
    for (int y = 0; y < SIM_HEIGHT; ++y) {
        for (int x = 0; x < SIM_WIDTH; ++x) {
            if (!sim_solid(x, y)) continue;
            const float left = SIM_ORIGIN_X + x * SIM_TILE_SIZE;
            const float bottom = SIM_ORIGIN_Y + y * SIM_TILE_SIZE;
            assert(state->x + SIM_PLAYER_HALF <= left ||
                   state->x - SIM_PLAYER_HALF >= left + SIM_TILE_SIZE ||
                   state->y + SIM_PLAYER_HALF <= bottom ||
                   state->y - SIM_PLAYER_HALF >= bottom + SIM_TILE_SIZE);
        }
    }
}

static void map_and_reset(void) {
    sim_state state;
    sim_init(&state);
    assert(state.x == -80.0f && state.y == 0.0f && state.accumulator == 0.0);
    free_body(&state);
    for (int y = -1; y <= SIM_HEIGHT; ++y) {
        for (int x = -1; x <= SIM_WIDTH; ++x) {
            const bool expected = x <= 0 || y <= 0 || x >= SIM_WIDTH - 1 ||
                y >= SIM_HEIGHT - 1 || (x >= 7 && x <= 8 && y >= 4 && y <= 5);
            assert(sim_solid(x, y) == expected);
            assert(sim_tile(x, y) == (expected ? 4 : 1 + ((x + y) & 1)));
        }
    }
    assert(sim_solid(-100000, 3) && sim_solid(3, 100000));
    sim_advance(&state, (sim_input){1, 1}, 0.123);
    sim_init(&state);
    assert(state.x == -80.0f && state.y == 0.0f && state.accumulator == 0.0);
}

static void speed_and_accumulation(void) {
    for (int y = -1; y <= 1; ++y) {
        for (int x = -1; x <= 1; ++x) {
            sim_state state;
            sim_init(&state);
            sim_advance(&state, (sim_input){x, y}, 0.25);
            const double scale = x && y ? 0.7071067811865475244 : 1.0;
            near(state.x, -80.0 + x * 16.0 * scale, 0.0002);
            near(state.y, y * 16.0 * scale, 0.0002);
            const double dx = state.x + 80.0;
            near(dx * dx + state.y * state.y, (x || y) ? 256.0 : 0.0, 0.01);
            free_body(&state);
        }
    }
    sim_state state;
    sim_init(&state);
    sim_advance(&state, (sim_input){1, 0}, SIM_STEP * 0.25);
    assert(state.x == -80.0f);
    near(state.accumulator, SIM_STEP * 0.25, 1e-15);
    sim_advance(&state, (sim_input){1, 0}, SIM_STEP * 0.75);
    near(state.x, -80.0 + SIM_SPEED * SIM_STEP, 0.00001);
    near(state.accumulator, 0.0, 1e-15);
    /* Opposing keys are reduced to axis zero by the input adapter. */
    const float stopped = state.x;
    sim_advance(&state, (sim_input){0, 0}, 0.25);
    assert(state.x == stopped && state.y == 0.0f);
    sim_advance(&state, (sim_input){1, 0}, 0.0);
    assert(state.x == stopped);
}

static sim_state partition(int fps) {
    sim_state state;
    sim_init(&state);
    for (int i = 0; i < fps / 2; ++i) {
        sim_advance(&state, (sim_input){1, 1}, 1.0 / fps);
        free_body(&state);
    }
    return state;
}

static void timing(void) {
    const sim_state a = partition(30), b = partition(60), c = partition(144);
    assert(a.x == b.x && b.x == c.x && a.y == b.y && b.y == c.y);
    near(a.accumulator, 0.0, 1e-14);
    near(b.accumulator, 0.0, 1e-14);
    near(c.accumulator, 0.0, 1e-14);
    sim_state cap, normal;
    sim_init(&cap);
    sim_init(&normal);
    sim_advance(&cap, (sim_input){1, 0}, SIM_STEP / 2);
    sim_advance(&normal, (sim_input){1, 0}, SIM_STEP / 2);
    sim_advance(&cap, (sim_input){1, 0}, DBL_MAX);
    sim_advance(&normal, (sim_input){1, 0}, 0.25);
    assert(cap.x == normal.x && cap.y == normal.y);
    near(cap.accumulator, SIM_STEP / 2, 1e-14);
    assert(cap.accumulator == normal.accumulator);
}

static void drive(sim_state *state, sim_input input) {
    state->spawn_ticks = 1000000; /* Movement-only fixture. */
    for (int i = 0; i < 80; ++i) {
        sim_advance(state, input, 0.25);
        free_body(state);
    }
}

static sim_state movement_state(float x, float y) {
    sim_state s;
    sim_init(&s);
    s.x = x; s.y = y;
    s.spawn_ticks = 1000000;
    return s;
}

static void collisions(void) {
    sim_state state = movement_state(-80, 32);
    drive(&state, (sim_input){-1, 0});
    assert(state.x == -107.0f);
    state = movement_state(80, 32);
    drive(&state, (sim_input){1, 0});
    assert(state.x == 107.0f);
    state = movement_state(80, 0);
    drive(&state, (sim_input){0, -1});
    assert(state.y == -59.0f);
    drive(&state, (sim_input){0, 1});
    assert(state.y == 59.0f);
    drive(&state, (sim_input){1, 1});
    assert(state.x == 107.0f && state.y == 59.0f);

    state = movement_state(-80, 0);
    drive(&state, (sim_input){1, 0});
    assert(state.x == -21.0f);
    state = movement_state(80, 0);
    drive(&state, (sim_input){-1, 0});
    assert(state.x == 21.0f);
    state = movement_state(0, -48);
    drive(&state, (sim_input){0, 1});
    assert(state.y == -21.0f);
    state = movement_state(0, 48);
    drive(&state, (sim_input){0, -1});
    assert(state.y == 21.0f);

    state = movement_state(-21, 0);
    sim_advance(&state, (sim_input){1, 1}, 0.25);
    assert(state.x == -21.0f && state.y > 11.0f);
    free_body(&state);
    sim_advance(&state, (sim_input){1, 1}, 0.25);
    sim_advance(&state, (sim_input){1, 1}, 0.25);
    assert(state.x > -21.0f && state.y > 21.0f);
    free_body(&state);
    for (int sx = -1; sx <= 1; sx += 2) {
        for (int sy = -1; sy <= 1; sy += 2) {
            state = movement_state(sx * 32.0f, sy * 32.0f);
            drive(&state, (sim_input){-sx, -sy});
        }
    }
}

static sim_state fixture(void) {
    sim_state s;
    sim_init(&s);
    s.spawn_ticks = 1000000;
    return s;
}
static void ticks(sim_state *s, int n) {
    for (int i = 0; i < n; ++i) sim_advance(s, (sim_input){0, 0}, SIM_STEP);
}
static int enemies(const sim_state *s) {
    int n = 0;
    for (int i = 0; i < SIM_MAX_ENEMIES; ++i) n += s->enemies[i].active;
    return n;
}
static int bullets(const sim_state *s) {
    int n = 0;
    for (int i = 0; i < SIM_MAX_BULLETS; ++i) n += s->bullets[i].active;
    return n;
}
static void combat_reset(void) {
    sim_state s;
    memset(&s, 0xff, sizeof s);
    sim_init(&s);
    assert(s.hp == 3 && s.kills == 0 && !s.dead && s.ticks == 0);
    assert(s.shot_ticks == 0 && s.hurt_ticks == 0 && s.spawn_ticks == SIM_FIRST_SPAWN_TICKS);
    assert(s.x == -80 && s.y == 0 && s.accumulator == 0);
    for (int i = 0; i < SIM_MAX_ENEMIES; ++i) {
        sim_enemy e = s.enemies[i];
        assert(!e.active && e.hp == 0 && e.x == 0 && e.y == 0);
    }
    for (int i = 0; i < SIM_MAX_BULLETS; ++i) {
        sim_bullet b = s.bullets[i];
        assert(!b.active && b.ticks_left == 0 && b.x == 0 && b.y == 0 && b.vx == 0 && b.vy == 0);
    }
}
static void spawning(void) {
    sim_state a, b;
    sim_init(&a); sim_init(&b);
    a.shot_ticks = b.shot_ticks = 1000000;
    ticks(&a, 119); ticks(&b, 119);
    assert(enemies(&a) == 0 && a.spawn_ticks == 1);
    ticks(&a, 1); ticks(&b, 1);
    assert(enemies(&a) == 1 && a.spawn_ticks == SIM_SPAWN_TICKS);
    assert(a.enemies[0].x == b.enemies[0].x && a.enemies[0].y == b.enemies[0].y);
    assert(a.enemies[0].hp == 2);
    ticks(&a, SIM_SPAWN_TICKS - 1);
    assert(enemies(&a) == 1);
    ticks(&a, 1);
    assert(enemies(&a) == 2);
    a = fixture(); a.spawn_ticks = 1; a.shot_ticks = 1000000;
    a.x = -104; a.y = -56;
    ticks(&a, 1);
    assert(enemies(&a) == 1 && a.enemies[0].x > -90 && a.hp == 3);
    a = fixture(); a.spawn_ticks = 1; a.shot_ticks = 1000000;
    a.enemies[0] = (sim_enemy){.x = -104, .y = -56, .hp = 2, .active = true, .kind = SIM_CHASER};
    ticks(&a, 1);
    assert(enemies(&a) == 2 && a.enemies[1].x > -90);
    a = fixture(); a.spawn_ticks = 1; a.shot_ticks = 1000000;
    for (int i = 0; i < SIM_MAX_ENEMIES; ++i)
        a.enemies[i] = (sim_enemy){.x = 80, .y = 40, .hp = 2, .active = true, .kind = SIM_CHASER};
    ticks(&a, 1);
    assert(enemies(&a) == SIM_MAX_ENEMIES && a.spawn_ticks == SIM_SPAWN_TICKS);
}
static void chase_obstacle(void) {
    for (int dir = 0; dir < 4; ++dir) {
        sim_state s = fixture();
        s.shot_ticks = s.hurt_ticks = 1000000;
        if (dir < 2) {
            s.x = dir ? 72 : -72; s.y = 8;
            s.enemies[0] = (sim_enemy){.x = -s.x, .y = 8, .hp = 2, .active = true, .kind = SIM_CHASER};
        } else {
            s.x = 8; s.y = dir == 2 ? -40 : 40;
            s.enemies[0] = (sim_enemy){.x = 8, .y = -s.y, .hp = 2, .active = true, .kind = SIM_CHASER};
        }
        bool detour = false;
        for (int i = 0; i < 1200; ++i) {
            ticks(&s, 1);
            sim_state body = {.x = s.enemies[0].x, .y = s.enemies[0].y};
            assert(SIM_ENEMY_HALF == SIM_PLAYER_HALF);
            free_body(&body);
            if (dir < 2 && (body.y < -20 || body.y > 20)) detour = true;
            if (dir >= 2 && (body.x < -20 || body.x > 20)) detour = true;
        }
        assert(detour);
        near(s.enemies[0].x, s.x, .001);
        near(s.enemies[0].y, s.y, .001);
    }
}

static void targeting(void) {
    sim_state s = fixture();
    ticks(&s, 1);
    assert(bullets(&s) == 0 && s.shot_ticks == 0);
    s.enemies[0] = (sim_enemy){.x = 80, .y = 0, .hp = 2, .active = true, .kind = SIM_CHASER};
    ticks(&s, 1);
    assert(bullets(&s) == 0); /* Outside range. */
    s.enemies[0] = (sim_enemy){.x = 24, .y = 0, .hp = 2, .active = true, .kind = SIM_CHASER};
    ticks(&s, 1);
    assert(bullets(&s) == 0); /* Central wall hides enemy. */
    s.enemies[1] = (sim_enemy){.x = -80, .y = 48, .hp = 2, .active = true, .kind = SIM_CHASER};
    s.enemies[2] = (sim_enemy){.x = -48, .y = 0, .hp = 2, .active = true, .kind = SIM_CHASER};
    ticks(&s, 1);
    assert(bullets(&s) == 1 && s.shot_ticks == SIM_SHOT_TICKS);
    assert(s.bullets[0].vx > 159);
    near(s.bullets[0].vy, 0, 2); /* Chase aligns toward tile center before firing. */
    near(s.bullets[0].vx * (s.enemies[2].y - s.y),
         s.bullets[0].vy * (s.enemies[2].x - s.x), .001);
    ticks(&s, 59);
    assert(s.shot_ticks == 1);
    ticks(&s, 1);
    assert(s.shot_ticks == SIM_SHOT_TICKS);
    s = fixture(); s.x = -24;
    s.enemies[0] = (sim_enemy){.x = 24, .y = 0, .hp = 2, .active = true, .kind = SIM_CHASER};
    s.enemies[1] = (sim_enemy){.x = -96, .y = 0, .hp = 2, .active = true, .kind = SIM_CHASER};
    ticks(&s, 1);
    assert(s.bullets[0].active && s.bullets[0].vx < -159);
}
static void hits_and_lifetime(void) {
    sim_state s = fixture();
    s.enemies[0] = (sim_enemy){.x = -48, .y = 0, .hp = 2, .active = true, .kind = SIM_CHASER};
    ticks(&s, 35);
    assert(s.enemies[0].hp == 1 && s.kills == 0);
    ticks(&s, 70);
    assert(!s.enemies[0].active && s.enemies[0].hp == 0 && s.kills == 1);
    ticks(&s, 300);
    assert(s.kills == 1 && bullets(&s) == 0);
    s = fixture(); s.shot_ticks = 1000000;
    s.enemies[0] = (sim_enemy){.x = -48, .y = 0, .hp = 1, .active = true, .kind = SIM_CHASER};
    for (int i = 0; i < 2; ++i)
        s.bullets[i] = (sim_bullet){-48, 0, 0, 0, 240, true};
    ticks(&s, 1);
    assert(s.kills == 1 && !s.enemies[0].active);
    assert(!s.bullets[0].active && s.bullets[1].active);
    s = fixture(); s.shot_ticks = 1000000;
    s.enemies[0] = (sim_enemy){.x = -48, .y = 0, .hp = 2, .active = true, .kind = SIM_CHASER};
    s.bullets[0] = (sim_bullet){-96, 0, 12000, 0, 240, true};
    ticks(&s, 1); /* Extreme speed proves sweep cannot tunnel. */
    assert(s.enemies[0].hp == 1 && !s.bullets[0].active);
    s = fixture(); s.shot_ticks = 1000000;
    s.enemies[0] = (sim_enemy){.x = 40, .y = 0, .hp = 2, .active = true, .kind = SIM_CHASER};
    s.bullets[0] = (sim_bullet){-40, 0, 12000, 0, 240, true};
    ticks(&s, 1);
    assert(!s.bullets[0].active && s.enemies[0].hp == 2);
    near(s.bullets[0].x, -18, .001);
    s = fixture();
    s.bullets[0] = (sim_bullet){-80, 0, 0, 0, SIM_BULLET_TICKS, true};
    ticks(&s, SIM_BULLET_TICKS - 1);
    assert(s.bullets[0].active && s.bullets[0].ticks_left == 1);
    ticks(&s, 1);
    assert(!s.bullets[0].active && s.bullets[0].ticks_left == 0);
    ticks(&s, 20);
    assert(s.bullets[0].ticks_left == 0);
    s.bullets[0] = (sim_bullet){-80, 0, 0, 0, 0, true};
    ticks(&s, 1);
    assert(!s.bullets[0].active && s.bullets[0].ticks_left == 0);
}

static void saturation_and_death(void) {
    sim_state s = fixture();
    s.enemies[0] = (sim_enemy){.x = -48, .y = 0, .hp = 2, .active = true, .kind = SIM_CHASER};
    for (int i = 0; i < SIM_MAX_BULLETS; ++i)
        s.bullets[i] = (sim_bullet){-104, 48, 0, 0, 240, true};
    ticks(&s, 1);
    assert(bullets(&s) == SIM_MAX_BULLETS && s.shot_ticks == 0);
    s.bullets[7].active = false;
    ticks(&s, 1);
    assert(bullets(&s) == SIM_MAX_BULLETS && s.shot_ticks == SIM_SHOT_TICKS);
    s = fixture(); s.shot_ticks = 1000000;
    s.enemies[0] = (sim_enemy){.x = s.x, .y = s.y, .hp = 2, .active = true, .kind = SIM_CHASER};
    s.enemies[1] = s.enemies[0];
    ticks(&s, 1);
    assert(s.hp == 2 && s.hurt_ticks == SIM_HURT_TICKS && !s.dead);
    ticks(&s, SIM_HURT_TICKS - 1);
    assert(s.hp == 2 && s.hurt_ticks == 1);
    ticks(&s, 1);
    assert(s.hp == 1 && s.hurt_ticks == SIM_HURT_TICKS);
    ticks(&s, SIM_HURT_TICKS);
    assert(s.hp == 0 && s.dead);
    sim_state frozen = s;
    for (int i = 0; i < 20; ++i) sim_advance(&s, (sim_input){1, 1}, .25);
    assert(memcmp(&s, &frozen, sizeof s) == 0);
    sim_init(&s);
    assert(!s.dead && s.hp == 3 && s.kills == 0 && s.ticks == 0);
    assert(enemies(&s) == 0 && bullets(&s) == 0);
    sim_advance(&s, (sim_input){1, 0}, SIM_STEP);
    assert(s.x > -80);
}
static sim_state combat_partition(int fps) {
    sim_state s;
    sim_init(&s);
    for (int i = 0; i < fps * 8; ++i)
        sim_advance(&s, (sim_input){0, 0}, 1.0 / fps);
    return s;
}
static void combat_timing(void) {
    sim_state a = combat_partition(30), b = combat_partition(60), c = combat_partition(144);
    near(a.accumulator, b.accumulator, 1e-14);
    near(b.accumulator, c.accumulator, 1e-14);
    assert(a.x == b.x && b.x == c.x && a.y == b.y && b.y == c.y);
    assert(a.hp == b.hp && b.hp == c.hp && a.kills == b.kills && b.kills == c.kills);
    assert(a.dead == b.dead && b.dead == c.dead && a.ticks == b.ticks && b.ticks == c.ticks);
    assert(a.level == b.level && b.level == c.level && a.xp == b.xp && b.xp == c.xp);
    assert(a.choosing == b.choosing && b.choosing == c.choosing);
    for (int i = 0; i < SIM_MAX_GEMS; ++i) {
        sim_gem x = a.gems[i], y = b.gems[i], z = c.gems[i];
        assert(x.x == y.x && y.x == z.x && x.y == y.y && y.y == z.y);
        assert(x.value == y.value && y.value == z.value && x.active == y.active && y.active == z.active);
    }
    assert(a.shot_ticks == b.shot_ticks && b.shot_ticks == c.shot_ticks);
    assert(a.spawn_ticks == b.spawn_ticks && b.spawn_ticks == c.spawn_ticks);
    assert(a.hurt_ticks == b.hurt_ticks && b.hurt_ticks == c.hurt_ticks);
    for (int i = 0; i < SIM_MAX_ENEMIES; ++i) {
        sim_enemy x = a.enemies[i], y = b.enemies[i], z = c.enemies[i];
        assert(x.x == y.x && y.x == z.x && x.y == y.y && y.y == z.y);
        assert(x.hp == y.hp && y.hp == z.hp && x.active == y.active && y.active == z.active);
    }
    for (int i = 0; i < SIM_MAX_BULLETS; ++i) {
        sim_bullet x = a.bullets[i], y = b.bullets[i], z = c.bullets[i];
        assert(x.x == y.x && y.x == z.x && x.y == y.y && y.y == z.y);
        assert(x.vx == y.vx && y.vx == z.vx && x.vy == y.vy && y.vy == z.vy);
        assert(x.ticks_left == y.ticks_left && y.ticks_left == z.ticks_left);
        assert(x.active == y.active && y.active == z.active);
    }
}

static int gem_value(const sim_state *s) {
    int total = 0;
    for (int i = 0; i < SIM_MAX_GEMS; ++i)
        if (s->gems[i].active) total += s->gems[i].value;
    return total;
}

static void progression(void) {
    sim_state s = fixture();
    assert(s.level == 1 && s.xp == 0 && s.xp_next == 3 && !s.choosing);
    assert(s.damage == 1 && s.shot_interval == SIM_SHOT_TICKS && s.move_speed == SIM_SPEED);
    assert(!sim_choose_upgrade(&s, SIM_UPGRADE_DAMAGE));
    s.shot_ticks = 1000000;
    s.enemies[0] = (sim_enemy){.x = -48, .y = 0, .hp = 1, .active = true, .kind = SIM_CHASER};
    s.bullets[0] = (sim_bullet){-48, 0, 0, 0, 240, true};
    ticks(&s, 1);
    assert(s.kills == 1 && s.xp == 0 && gem_value(&s) == 1);
    const float dropped_x = s.gems[0].x;
    s.x += 1; /* Step inside the magnet radius after the kill. */
    ticks(&s, 8);
    assert(s.gems[0].x < dropped_x && s.xp == 0);
    ticks(&s, 60);
    assert(s.xp == 1 && gem_value(&s) == 0);
    ticks(&s, 60);
    assert(s.xp == 1); /* No duplicate collection. */

    s = fixture();
    s.gems[0] = (sim_gem){s.x, s.y, 5, true};
    ticks(&s, 1);
    assert(s.choosing && s.xp == 5 && s.accumulator == 0);
    sim_state frozen = s;
    sim_advance(&s, (sim_input){1, 1}, .25);
    assert(memcmp(&s, &frozen, sizeof s) == 0); /* Everything pauses. */
    assert(sim_choose_upgrade(&s, SIM_UPGRADE_DAMAGE));
    assert(!s.choosing && s.level == 2 && s.xp == 2 && s.xp_next == 5 && s.damage == 2);
    assert(!sim_choose_upgrade(&s, SIM_UPGRADE_SPEED)); /* No double choice. */
    s.enemies[0] = (sim_enemy){.x = -48, .y = 0, .hp = 2, .active = true, .kind = SIM_CHASER};
    s.bullets[0] = (sim_bullet){-48, 0, 0, 0, 240, true};
    s.shot_ticks = 1000000;
    ticks(&s, 1);
    assert(!s.enemies[0].active && s.kills == 1); /* Upgraded hit damage. */

    s = fixture(); s.xp = 3; s.choosing = true;
    assert(sim_choose_upgrade(&s, SIM_UPGRADE_ATTACK));
    s.enemies[0] = (sim_enemy){.x = -48, .y = 0, .hp = 100, .active = true, .kind = SIM_CHASER};
    s.hurt_ticks = 1000000;
    ticks(&s, 1);
    assert(s.shot_ticks == 54);
    ticks(&s, 53);
    assert(s.shot_ticks == 1);
    ticks(&s, 1);
    assert(s.shot_ticks == 54); /* Upgraded cadence is used by actual firing. */

    s = fixture(); s.xp = 12; s.choosing = true; s.shot_ticks = 60;
    assert(sim_choose_upgrade(&s, SIM_UPGRADE_ATTACK));
    assert(s.choosing && s.level == 2 && s.xp == 9 && s.shot_interval == 54 && s.shot_ticks == 54);
    assert(sim_choose_upgrade(&s, SIM_UPGRADE_SPEED));
    assert(!s.choosing && s.level == 3 && s.xp == 4 && s.xp_next == 7 && s.move_speed == 72);
    sim_advance(&s, (sim_input){1, 0}, .25);
    near(s.x, -62, .0002);
    s.xp = s.xp_next; s.choosing = true; s.shot_interval = SIM_MIN_SHOT_TICKS;
    frozen = s;
    assert(!sim_choose_upgrade(&s, SIM_UPGRADE_ATTACK));
    assert(memcmp(&s, &frozen, sizeof s) == 0); /* Capped choice consumes nothing. */

    s = fixture(); s.x = -24;
    s.gems[0] = (sim_gem){24, 0, 1, true};
    s.gems[1] = (sim_gem){-104, 48, 1, true};
    ticks(&s, 120);
    assert(s.gems[0].x == 24 && s.gems[1].x == -104 && s.xp == 0);
    s.x = -21; s.y = 8;
    s.gems[0] = (sim_gem){-8, 24, 1, true}; /* In radius, but blocked across a wall corner. */
    ticks(&s, 10);
    assert(s.gems[0].x == -8 && s.gems[0].y == 24 && s.xp == 0);

    s = fixture(); s.shot_ticks = 1000000;
    for (int i = 0; i < SIM_MAX_GEMS; ++i)
        s.gems[i] = (sim_gem){-104, 48, 1, true};
    s.enemies[0] = (sim_enemy){.x = -48, .y = 0, .hp = 1, .active = true, .kind = SIM_CHASER};
    s.bullets[0] = (sim_bullet){-48, 0, 0, 0, 240, true};
    ticks(&s, 1);
    assert(gem_value(&s) == SIM_MAX_GEMS + 1 && s.xp == 0); /* Full pool merges, no lost XP. */
    s.dead = true; s.choosing = true; s.xp = 10;
    assert(!sim_choose_upgrade(&s, SIM_UPGRADE_DAMAGE));
    sim_init(&s);
    assert(gem_value(&s) == 0 && !s.choosing && s.xp == 0 && s.level == 1);
    assert(s.damage == 1 && s.shot_interval == 60 && s.move_speed == 64);
}

int main(int argc, char **argv) {
    if (argc == 2) {
        sim_state state;
        sim_init(&state);
        if (!strcmp(argv[1], "negative")) sim_advance(&state, (sim_input){0, 0}, -0.1);
        else if (!strcmp(argv[1], "nan")) sim_advance(&state, (sim_input){0, 0}, NAN);
        else if (!strcmp(argv[1], "infinite")) sim_advance(&state, (sim_input){0, 0}, INFINITY);
        else if (!strcmp(argv[1], "negative-infinite")) sim_advance(&state, (sim_input){0, 0}, -INFINITY);
        else if (!strcmp(argv[1], "axis-x")) sim_advance(&state, (sim_input){2, 0}, 0);
        else if (!strcmp(argv[1], "axis-y")) sim_advance(&state, (sim_input){0, -2}, 0);
        else if (!strcmp(argv[1], "upgrade-negative")) sim_choose_upgrade(&state, -1);
        else if (!strcmp(argv[1], "upgrade-range")) sim_choose_upgrade(&state, SIM_UPGRADE_COUNT);
        else return 2;
        return 0;
    }
    assert(argc == 1);
    map_and_reset();
    speed_and_accumulation();
    timing();
    collisions();
    combat_reset();
    spawning();
    chase_obstacle();
    targeting();
    hits_and_lifetime();
    saturation_and_death();
    combat_timing();
    progression();
    puts("simulation assertions passed");
    return 0;
}
