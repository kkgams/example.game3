#include "sim.h"

#include <assert.h>
#include <float.h>

uint8_t sim_tile(int x, int y) {
    if (x <= 0 || y <= 0 || x >= SIM_WIDTH - 1 || y >= SIM_HEIGHT - 1 ||
        (x >= 7 && x <= 8 && y >= 4 && y <= 5)) {
        return 4;
    }
    return (uint8_t)(1 + ((x + y) & 1));
}

bool sim_solid(int x, int y) {
    return sim_tile(x, y) == 4;
}

void sim_init(sim_state *state) {
    assert(state);
    *state = (sim_state){ .x = -80.0f, .y = 0.0f, .accumulator = 0.0,
        .hp = SIM_MAX_HP, .spawn_ticks = SIM_FIRST_SPAWN_TICKS };
}

/* Sweep the leading face against authored solid tiles. X then Y gives wall
   sliding with a stable corner tie-break; touching faces are not overlapping.
   Sweeps prevent tunneling rather than depending on endpoint overlap alone. */
static void move_x(float *px, float py, float half, float distance) {
    float target = *px + distance;
    for (int y = 0; y < SIM_HEIGHT; ++y) {
        const float bottom = SIM_ORIGIN_Y + y * SIM_TILE_SIZE;
        if (py + half <= bottom ||
            py - half >= bottom + SIM_TILE_SIZE) continue;
        for (int x = 0; x < SIM_WIDTH; ++x) {
            if (!sim_solid(x, y)) continue;
            const float left = SIM_ORIGIN_X + x * SIM_TILE_SIZE;
            const float low = left - half;
            const float high = left + SIM_TILE_SIZE + half;
            if (distance > 0.0f && *px <= low && target > low) target = low;
            if (distance < 0.0f && *px >= high && target < high) target = high;
        }
    }
    *px = target;
}

static void move_y(float px, float *py, float half, float distance) {
    float target = *py + distance;
    for (int x = 0; x < SIM_WIDTH; ++x) {
        const float left = SIM_ORIGIN_X + x * SIM_TILE_SIZE;
        if (px + half <= left ||
            px - half >= left + SIM_TILE_SIZE) continue;
        for (int y = 0; y < SIM_HEIGHT; ++y) {
            if (!sim_solid(x, y)) continue;
            const float bottom = SIM_ORIGIN_Y + y * SIM_TILE_SIZE;
            const float low = bottom - half;
            const float high = bottom + SIM_TILE_SIZE + half;
            if (distance > 0.0f && *py <= low && target > low) target = low;
            if (distance < 0.0f && *py >= high && target < high) target = high;
        }
    }
    *py = target;
}

/* Tick timers: initial spawn 120, later spawns 90, shots 60,
   contact invulnerability 90, bullet lifetime 240. */
static float absf(float x) { return x < 0 ? -x : x; }
static int tile_x(float x) { return (int)((x - SIM_ORIGIN_X) / SIM_TILE_SIZE); }
static int tile_y(float y) { return (int)((y - SIM_ORIGIN_Y) / SIM_TILE_SIZE); }
static float center_x(int x) { return SIM_ORIGIN_X + (x + .5f) * SIM_TILE_SIZE; }
static float center_y(int y) { return SIM_ORIGIN_Y + (y + .5f) * SIM_TILE_SIZE; }

/* First segment/AABB intersection, including a coincident starting point. */
static bool segment_box(float x, float y, float dx, float dy,
                        float left, float bottom, float right, float top, float *hit) {
    float low = 0, high = 1;
    const float p[2] = {x, y}, d[2] = {dx, dy};
    const float lo[2] = {left, bottom}, hi[2] = {right, top};
    for (int i = 0; i < 2; ++i) {
        if (d[i] == 0) {
            if (p[i] < lo[i] || p[i] > hi[i]) return false;
        } else {
            float a = (lo[i] - p[i]) / d[i], b = (hi[i] - p[i]) / d[i];
            if (a > b) { float swap = a; a = b; b = swap; }
            if (a > low) low = a;
            if (b < high) high = b;
            if (low > high) return false;
        }
    }
    *hit = low;
    return true;
}

static float wall_hit(float x, float y, float dx, float dy, float half) {
    float first = 2;
    for (int ty = 0; ty < SIM_HEIGHT; ++ty) {
        for (int tx = 0; tx < SIM_WIDTH; ++tx) {
            if (!sim_solid(tx, ty)) continue;
            float hit;
            const float left = SIM_ORIGIN_X + tx * SIM_TILE_SIZE;
            const float bottom = SIM_ORIGIN_Y + ty * SIM_TILE_SIZE;
            if (segment_box(x, y, dx, dy, left - half, bottom - half,
                            left + SIM_TILE_SIZE + half,
                            bottom + SIM_TILE_SIZE + half, &hit) && hit < first)
                first = hit;
        }
    }
    return first;
}

static void spawn(sim_state *state) {
    int slot = 0;
    while (slot < SIM_MAX_ENEMIES && state->enemies[slot].active) ++slot;
    if (slot == SIM_MAX_ENEMIES) return;
    enum { WIDTH = SIM_WIDTH - 2, HEIGHT = SIM_HEIGHT - 2,
           PERIMETER = 2 * WIDTH + 2 * (HEIGHT - 2) };
    /* Each perimeter center is attempted once, with a deterministic wave offset. */
    const unsigned wave = state->ticks / SIM_SPAWN_TICKS;
    for (int attempt = 0; attempt < PERIMETER; ++attempt) {
        int n = (int)((wave * 13u + (unsigned)attempt) % PERIMETER), x, y;
        if (n < WIDTH) { x = n + 1; y = 1; }
        else if ((n -= WIDTH) < HEIGHT - 2) { x = SIM_WIDTH - 2; y = n + 2; }
        else if ((n -= HEIGHT - 2) < WIDTH) { x = SIM_WIDTH - 2 - n; y = SIM_HEIGHT - 2; }
        else { n -= WIDTH; x = 1; y = SIM_HEIGHT - 3 - n; }
        const float px = center_x(x), py = center_y(y);
        bool occupied = absf(px - state->x) < SIM_PLAYER_HALF + SIM_ENEMY_HALF &&
                        absf(py - state->y) < SIM_PLAYER_HALF + SIM_ENEMY_HALF;
        for (int i = 0; i < SIM_MAX_ENEMIES; ++i) {
            const sim_enemy *enemy = &state->enemies[i];
            if (enemy->active && absf(px - enemy->x) < 2 * SIM_ENEMY_HALF &&
                absf(py - enemy->y) < 2 * SIM_ENEMY_HALF) occupied = true;
        }
        if (!occupied && !sim_solid(x, y)) {
            state->enemies[slot] = (sim_enemy){px, py, 2, true};
            return;
        }
    }
}

static void chase(sim_state *state) {
    int distance[SIM_HEIGHT][SIM_WIDTH];
    int queue[SIM_HEIGHT * SIM_WIDTH], head = 0, tail = 0;
    for (int y = 0; y < SIM_HEIGHT; ++y)
        for (int x = 0; x < SIM_WIDTH; ++x) distance[y][x] = -1;
    const int px = tile_x(state->x), py = tile_y(state->y);
    assert(!sim_solid(px, py));
    distance[py][px] = 0;
    queue[tail++] = py * SIM_WIDTH + px;
    const int dx[4] = {-1, 1, 0, 0}, dy[4] = {0, 0, -1, 1};
    while (head < tail) {
        const int cell = queue[head++], x = cell % SIM_WIDTH, y = cell / SIM_WIDTH;
        for (int i = 0; i < 4; ++i) {
            const int nx = x + dx[i], ny = y + dy[i];
            if (sim_solid(nx, ny) || distance[ny][nx] >= 0) continue;
            distance[ny][nx] = distance[y][x] + 1;
            queue[tail++] = ny * SIM_WIDTH + nx;
        }
    }
    for (int i = 0; i < SIM_MAX_ENEMIES; ++i) {
        sim_enemy *enemy = &state->enemies[i];
        if (!enemy->active) continue;
        const int x = tile_x(enemy->x), y = tile_y(enemy->y);
        assert(!sim_solid(x, y));
        float tx = state->x, ty = state->y;
        if (distance[y][x] != 0) {
            tx = center_x(x); ty = center_y(y);
            for (int dir = 0; dir < 4; ++dir) {
                const int nx = x + dx[dir], ny = y + dy[dir];
                if (sim_solid(nx, ny) || distance[ny][nx] < 0 ||
                    distance[ny][nx] >= distance[y][x]) continue;
                /* Align perpendicular before crossing an edge to avoid corner cuts. */
                if (dx[dir] && absf(enemy->y - ty) < .001f) tx = center_x(nx);
                if (dy[dir] && absf(enemy->x - tx) < .001f) ty = center_y(ny);
                break;
            }
        }
        float vx = tx - enemy->x, vy = ty - enemy->y;
        const float length = __builtin_sqrtf(vx * vx + vy * vy);
        const float step = (float)(28.0 * SIM_STEP);
        if (length > step) { vx *= step / length; vy *= step / length; }
        move_x(&enemy->x, enemy->y, SIM_ENEMY_HALF, vx);
        move_y(enemy->x, &enemy->y, SIM_ENEMY_HALF, vy);
    }
}

static void shoot(sim_state *state) {
    if (state->shot_ticks > 0) return;
    int target = -1;
    float nearest = 112.0f * 112.0f;
    for (int i = 0; i < SIM_MAX_ENEMIES; ++i) {
        const sim_enemy *enemy = &state->enemies[i];
        if (!enemy->active) continue;
        float dx = enemy->x - state->x, dy = enemy->y - state->y;
        float distance = dx * dx + dy * dy;
        if (distance > nearest || (target >= 0 && distance == nearest)) continue;
        if (wall_hit(state->x, state->y, dx, dy, SIM_BULLET_HALF) <= 1) continue;
        nearest = distance; target = i;
    }
    if (target < 0) return;
    for (int i = 0; i < SIM_MAX_BULLETS; ++i) {
        if (state->bullets[i].active) continue;
        float dx = state->enemies[target].x - state->x;
        float dy = state->enemies[target].y - state->y;
        float length = __builtin_sqrtf(nearest);
        float scale = length > 0 ? 160.0f / length : 0;
        state->bullets[i] = (sim_bullet){state->x, state->y, dx * scale, dy * scale, SIM_BULLET_TICKS, true};
        state->shot_ticks = SIM_SHOT_TICKS;
        return;
    }
}

static void projectiles(sim_state *state) {
    for (int i = 0; i < SIM_MAX_BULLETS; ++i) {
        sim_bullet *bullet = &state->bullets[i];
        if (!bullet->active) continue;
        if (bullet->ticks_left <= 0) { bullet->active = false; continue; }
        float dx = bullet->vx * (float)SIM_STEP, dy = bullet->vy * (float)SIM_STEP;
        float first = wall_hit(bullet->x, bullet->y, dx, dy, SIM_BULLET_HALF);
        int target = -1;
        for (int j = 0; j < SIM_MAX_ENEMIES; ++j) {
            sim_enemy *enemy = &state->enemies[j];
            if (!enemy->active) continue;
            float hit, half = SIM_ENEMY_HALF + SIM_BULLET_HALF;
            if (segment_box(bullet->x, bullet->y, dx, dy, enemy->x - half,
                            enemy->y - half, enemy->x + half, enemy->y + half, &hit) && hit < first) {
                first = hit; target = j;
            }
        }
        if (first <= 1) {
            bullet->x += dx * first; bullet->y += dy * first;
            bullet->active = false;
            if (target >= 0) {
                sim_enemy *enemy = &state->enemies[target];
                if (--enemy->hp == 0) { enemy->active = false; ++state->kills; }
            }
        } else { bullet->x += dx; bullet->y += dy; }
        --bullet->ticks_left;
        if (bullet->ticks_left == 0) bullet->active = false;
    }
}

static void combat(sim_state *state) {
    ++state->ticks;
    if (state->shot_ticks > 0) --state->shot_ticks;
    if (state->hurt_ticks > 0) --state->hurt_ticks;
    if (state->spawn_ticks > 0) --state->spawn_ticks;
    if (state->spawn_ticks == 0) { spawn(state); state->spawn_ticks = SIM_SPAWN_TICKS; }
    chase(state);
    shoot(state);
    projectiles(state);
    if (state->hurt_ticks == 0) {
        for (int i = 0; i < SIM_MAX_ENEMIES; ++i) {
            sim_enemy *enemy = &state->enemies[i];
            if (!enemy->active || absf(enemy->x - state->x) >= SIM_ENEMY_HALF + SIM_PLAYER_HALF ||
                absf(enemy->y - state->y) >= SIM_ENEMY_HALF + SIM_PLAYER_HALF) continue;
            --state->hp; state->hurt_ticks = SIM_HURT_TICKS;
            if (state->hp == 0) state->dead = true;
            break;
        }
    }
}

void sim_advance(sim_state *state, sim_input input, double elapsed) {
    assert(state);
    assert(input.x >= -1 && input.x <= 1 && input.y >= -1 && input.y <= 1);
    /* This rejects NaN and both infinities without a platform math library. */
    assert(elapsed >= 0.0 && elapsed <= DBL_MAX);
    if (state->dead) return;
    if (elapsed > 0.25) elapsed = 0.25;
    state->accumulator += elapsed;
    const float diagonal = 0.7071067811865475244f;
    const float step = (float)(SIM_SPEED * SIM_STEP) *
        ((input.x != 0 && input.y != 0) ? diagonal : 1.0f);
    /* Allow only rounding-scale slack, so rational frame partitions consume
       the same ticks (e.g. 144 frames of 1/144 second versus 30 of 1/30). */
    const double rounding = 8.0 * DBL_EPSILON;
    while (state->accumulator + rounding >= SIM_STEP) {
        move_x(&state->x, state->y, SIM_PLAYER_HALF, input.x * step);
        move_y(state->x, &state->y, SIM_PLAYER_HALF, input.y * step);
        combat(state);
        state->accumulator -= SIM_STEP;
        if (state->accumulator < 0.0) state->accumulator = 0.0;
        if (state->dead) { state->accumulator = 0.0; break; }
    }
}
