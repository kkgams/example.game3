#include "sim.h"

#include <assert.h>
#include <float.h>
#include <limits.h>

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
        .hp = SIM_MAX_HP, .spawn_ticks = SIM_FIRST_SPAWN_TICKS,
        .level = 1, .xp_next = 3, .damage = 1,
        .shot_interval = SIM_SHOT_TICKS, .move_speed = SIM_SPEED };
}

int sim_wave(const sim_state *state) {
    assert(state);
    return state->boss_started ? 4 : 1 + (int)(state->ticks / SIM_WAVE_TICKS);
}

static int spawn_interval(const sim_state *state) {
    const int intervals[] = {90, 75, 60};
    int wave = sim_wave(state);
    assert(wave >= 1 && wave <= 3);
    return intervals[wave - 1];
}

bool sim_choose_upgrade(sim_state *state, int option) {
    assert(state && option >= 0 && option < SIM_UPGRADE_COUNT);
    if (state->dead || state->won || !state->choosing) return false;
    if (option == SIM_UPGRADE_ATTACK && state->shot_interval == SIM_MIN_SHOT_TICKS) return false;
    if (option == SIM_UPGRADE_BLADES && state->blade_count) return false;
    if (option >= SIM_UPGRADE_BLADE_DAMAGE && !state->blade_count) return false;
    if (option == SIM_UPGRADE_BLADE_COUNT && state->blade_count == SIM_MAX_BLADES) return false;
    if (option == SIM_UPGRADE_BLADE_SPEED && state->blade_speed == SIM_BLADE_MAX_SPEED) return false;
    assert(state->xp >= state->xp_next && state->xp_next <= INT_MAX - 2 && state->level < INT_MAX);
    switch (option) {
    case SIM_UPGRADE_DAMAGE:
        assert(state->damage < INT_MAX);
        ++state->damage;
        break;
    case SIM_UPGRADE_ATTACK:
        state->shot_interval -= 6;
        if (state->shot_interval < SIM_MIN_SHOT_TICKS) state->shot_interval = SIM_MIN_SHOT_TICKS;
        if (state->shot_ticks > state->shot_interval) state->shot_ticks = state->shot_interval;
        break;
    case SIM_UPGRADE_SPEED:
        state->move_speed += 8;
        break;
    case SIM_UPGRADE_BLADES:
        state->blade_count = 2;
        state->blade_damage = 1;
        state->blade_speed = 4;
        break;
    case SIM_UPGRADE_BLADE_DAMAGE:
        assert(state->blade_damage < INT_MAX);
        ++state->blade_damage;
        break;
    case SIM_UPGRADE_BLADE_COUNT:
        ++state->blade_count;
        break;
    case SIM_UPGRADE_BLADE_SPEED:
        state->blade_speed += 2;
        break;
    }
    state->xp -= state->xp_next;
    state->xp_next += 2;
    ++state->level;
    state->choosing = state->xp >= state->xp_next;
    state->accumulator = 0;
    return true;
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

static bool spawn(sim_state *state, sim_enemy_kind kind) {
    assert(kind >= SIM_CHASER && kind < SIM_ENEMY_KIND_COUNT);
    const int health[] = {2, 1, 6, SIM_BOSS_HP};
    int slot = 0;
    while (slot < SIM_MAX_ENEMIES && state->enemies[slot].active) ++slot;
    if (slot == SIM_MAX_ENEMIES) return false;
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
            state->enemies[slot] = (sim_enemy){
                .x = px, .y = py, .hp = health[kind], .active = true,
                .kind = kind, .attack_ticks = kind == SIM_BOSS ? 240 : 0,
            };
            return true;
        }
    }
    return false;
}

static void start_boss(sim_state *state) {
    // Make room for a guaranteed boss, even if the ordinary enemy pool is full.
    for (int i = 0; i < SIM_MAX_ENEMIES; ++i) state->enemies[i].active = false;
    for (int i = 0; i < SIM_MAX_BULLETS; ++i) state->bullets[i].active = false;
    for (int i = 0; i < SIM_MAX_HOSTILE_BULLETS; ++i) state->hostile_bullets[i].active = false;
    state->boss_started = true;
    bool spawned = spawn(state, SIM_BOSS);
    assert(spawned); // The fixed arena has ample free perimeter cells.
    (void)spawned;
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
        const float speeds[] = {28, 44, 18, 24};
        assert(enemy->kind >= SIM_CHASER && enemy->kind < SIM_ENEMY_KIND_COUNT);
        const float step = (float)(speeds[enemy->kind] * SIM_STEP);
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
        state->shot_ticks = state->shot_interval;
        return;
    }
}

static void drop_gem(sim_state *state, float x, float y, int value) {
    int nearest = -1;
    float distance = FLT_MAX;
    for (int i = 0; i < SIM_MAX_GEMS; ++i) {
        sim_gem *gem = &state->gems[i];
        if (!gem->active) {
            *gem = (sim_gem){x, y, value, true};
            return;
        }
        float dx = gem->x - x, dy = gem->y - y;
        float d = dx * dx + dy * dy;
        if (d < distance) { nearest = i; distance = d; }
    }
    // Pool saturation is expected: merge the value into the nearest gem
    // instead of dropping XP or allocating an unbounded number of pickups.
    assert(nearest >= 0 && state->gems[nearest].value <= INT_MAX - value);
    state->gems[nearest].value += value;
}

static void collect_gems(sim_state *state) {
    for (int i = 0; i < SIM_MAX_GEMS; ++i) {
        sim_gem *gem = &state->gems[i];
        if (!gem->active) continue;
        float dx = state->x - gem->x, dy = state->y - gem->y;
        float distance = __builtin_sqrtf(dx * dx + dy * dy);
        if (distance > SIM_MAGNET_RADIUS ||
            wall_hit(gem->x, gem->y, dx, dy, SIM_GEM_HALF) <= 1) continue;
        float step = (float)(96 * SIM_STEP);
        if (distance <= SIM_PLAYER_HALF + SIM_GEM_HALF + step) {
            assert(gem->value > 0 && state->xp <= INT_MAX - gem->value);
            state->xp += gem->value;
            gem->active = false;
        } else {
            gem->x += dx * step / distance;
            gem->y += dy * step / distance;
        }
    }
    state->choosing = state->xp >= state->xp_next;
}

static void hit_enemy(sim_state *state, sim_enemy *enemy, int damage) {
    assert(enemy->active && enemy->hp > 0 && damage > 0);
    if (damage < enemy->hp) { enemy->hp -= damage; return; }
    enemy->hp = 0;
    enemy->active = false;
    ++state->kills;
    if (enemy->kind == SIM_BOSS) {
        state->won = true;
        state->choosing = false;
        for (int k = 0; k < SIM_MAX_ENEMIES; ++k) state->enemies[k].active = false;
        for (int k = 0; k < SIM_MAX_BULLETS; ++k) state->bullets[k].active = false;
        for (int k = 0; k < SIM_MAX_HOSTILE_BULLETS; ++k) state->hostile_bullets[k].active = false;
        return; // Victory wins this tick before hostile/contact damage.
    }
    // Reward threat, not remaining HP: fast runners earn the
    // middle tier; brutes have 3x chaser health but award 5x XP.
    const int rewards[] = {1, 2, 5};
    assert(enemy->kind >= SIM_CHASER && enemy->kind <= SIM_BRUTE);
    drop_gem(state, enemy->x, enemy->y, rewards[enemy->kind]);
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
                hit_enemy(state, &state->enemies[target], state->damage);
                if (state->won) return;
            }
        } else { bullet->x += dx; bullet->y += dy; }
        --bullet->ticks_left;
        if (bullet->ticks_left == 0) bullet->active = false;
    }
}

// Authored unit circle, linearly interpolated in fixed phase units. No host
// sin/cos or platform math imports; renderer and collision share these points.
_Static_assert(SIM_BLADE_PERIOD == 32u * 30u, "blade circle must match phase units");
static const float blade_circle[32][2] = {
    {1.0f, 0.0f},
    {0.98078528f, 0.19509032f},
    {0.92387953f, 0.38268343f},
    {0.83146961f, 0.55557023f},
    {0.70710678f, 0.70710678f},
    {0.55557023f, 0.83146961f},
    {0.38268343f, 0.92387953f},
    {0.19509032f, 0.98078528f},
    {0.0f, 1.0f},
    {-0.19509032f, 0.98078528f},
    {-0.38268343f, 0.92387953f},
    {-0.55557023f, 0.83146961f},
    {-0.70710678f, 0.70710678f},
    {-0.83146961f, 0.55557023f},
    {-0.92387953f, 0.38268343f},
    {-0.98078528f, 0.19509032f},
    {-1.0f, 0.0f},
    {-0.98078528f, -0.19509032f},
    {-0.92387953f, -0.38268343f},
    {-0.83146961f, -0.55557023f},
    {-0.70710678f, -0.70710678f},
    {-0.55557023f, -0.83146961f},
    {-0.38268343f, -0.92387953f},
    {-0.19509032f, -0.98078528f},
    {0.0f, -1.0f},
    {0.19509032f, -0.98078528f},
    {0.38268343f, -0.92387953f},
    {0.55557023f, -0.83146961f},
    {0.70710678f, -0.70710678f},
    {0.83146961f, -0.55557023f},
    {0.92387953f, -0.38268343f},
    {0.98078528f, -0.19509032f}
};

static void blade_point(int count, int blade, unsigned phase, float cx, float cy, float *x, float *y) {
    unsigned p = (phase + (unsigned)blade * SIM_BLADE_PERIOD / (unsigned)count) % SIM_BLADE_PERIOD;
    unsigned index = p / 30, next = (index + 1) % 32;
    float t = (p % 30) / 30.0f;
    *x = cx + SIM_BLADE_RADIUS * (blade_circle[index][0] + t * (blade_circle[next][0] - blade_circle[index][0]));
    *y = cy + SIM_BLADE_RADIUS * (blade_circle[index][1] + t * (blade_circle[next][1] - blade_circle[index][1]));
}

bool sim_blade_position(const sim_state *state, int blade, float *x, float *y) {
    assert(state && x && y && state->blade_count > 0 && state->blade_count <= SIM_MAX_BLADES);
    assert(blade >= 0 && blade < state->blade_count && state->blade_phase < SIM_BLADE_PERIOD);
    blade_point(state->blade_count, blade, state->blade_phase, state->x, state->y, x, y);
    return wall_hit(state->x, state->y, *x - state->x, *y - state->y, SIM_BLADE_HALF) > 1;
}

static void blades(sim_state *state, float old_x, float old_y) {
    if (!state->blade_count) return;
    assert(state->blade_count > 0 && state->blade_count <= SIM_MAX_BLADES);
    assert(state->blade_speed >= 4 && state->blade_speed <= SIM_BLADE_MAX_SPEED);
    unsigned old_phase = state->blade_phase;
    state->blade_phase = (old_phase + state->blade_speed) % SIM_BLADE_PERIOD;
    for (int j = 0; j < SIM_MAX_ENEMIES; ++j)
        if (state->enemies[j].blade_hurt_ticks > 0) --state->enemies[j].blade_hurt_ticks;
    for (int i = 0; i < state->blade_count; ++i) {
        float x, y, previous_x, previous_y;
        if (!sim_blade_position(state, i, &x, &y)) continue;
        blade_point(state->blade_count, i, old_phase, old_x, old_y, &previous_x, &previous_y);
        float dx = x - previous_x, dy = y - previous_y;
        float wall = wall_hit(previous_x, previous_y, dx, dy, SIM_BLADE_HALF);
        for (int j = 0; j < SIM_MAX_ENEMIES; ++j) {
            sim_enemy *enemy = &state->enemies[j];
            if (!enemy->active || enemy->blade_hurt_ticks) continue;
            // Neither a clipped orbit nor an enemy behind a wall can be hit.
            if (wall_hit(state->x, state->y, enemy->x - state->x, enemy->y - state->y, 0) <= 1) continue;
            float hit, half = SIM_ENEMY_HALF + SIM_BLADE_HALF;
            if (!segment_box(previous_x, previous_y, dx, dy, enemy->x - half,
                enemy->y - half, enemy->x + half, enemy->y + half, &hit) || hit >= wall) continue;
            enemy->blade_hurt_ticks = SIM_BLADE_HIT_TICKS;
            hit_enemy(state, enemy, state->blade_damage);
            if (state->won) return;
        }
    }
}

static void damage_player(sim_state *state) {
    if (state->hurt_ticks || state->dead || state->won) return;
    assert(state->hp > 0);
    --state->hp;
    state->hurt_ticks = SIM_HURT_TICKS;
    if (state->hp == 0) state->dead = true;
}

static void boss_attacks(sim_state *state) {
    const float directions[8][2] = {
        {1,0}, {.70710678f,.70710678f}, {0,1}, {-.70710678f,.70710678f},
        {-1,0}, {-.70710678f,-.70710678f}, {0,-1}, {.70710678f,-.70710678f},
    };
    for (int i = 0; i < SIM_MAX_ENEMIES; ++i) {
        sim_enemy *enemy = &state->enemies[i];
        if (!enemy->active || enemy->kind != SIM_BOSS) continue;
        int interval = enemy->hp <= SIM_BOSS_HP / 2 ? 120 : 240;
        if (enemy->attack_ticks > interval) enemy->attack_ticks = interval;
        if (enemy->attack_ticks > 0) --enemy->attack_ticks;
        if (enemy->attack_ticks) continue;
        enemy->attack_ticks = interval;
        for (int d = 0; d < 8; ++d) {
            for (int slot = 0; slot < SIM_MAX_HOSTILE_BULLETS; ++slot) {
                if (state->hostile_bullets[slot].active) continue;
                state->hostile_bullets[slot] = (sim_bullet){
                    enemy->x, enemy->y, directions[d][0] * 52, directions[d][1] * 52,
                    SIM_BULLET_TICKS, true,
                };
                break; // A full hostile pool skips only that projectile.
            }
        }
    }
}

static void hostile_projectiles(sim_state *state) {
    for (int i = 0; i < SIM_MAX_HOSTILE_BULLETS; ++i) {
        sim_bullet *b = &state->hostile_bullets[i];
        if (!b->active) continue;
        if (b->ticks_left <= 0) { b->active = false; continue; }
        float dx = b->vx * (float)SIM_STEP, dy = b->vy * (float)SIM_STEP;
        float wall = wall_hit(b->x, b->y, dx, dy, SIM_BULLET_HALF), hit;
        float half = SIM_BULLET_HALF + SIM_PLAYER_HALF;
        bool player_hit = segment_box(b->x, b->y, dx, dy,
            state->x - half, state->y - half, state->x + half, state->y + half, &hit) && hit < wall;
        if (player_hit) {
            b->active = false;
            damage_player(state);
        } else if (wall <= 1) {
            b->active = false;
        } else {
            b->x += dx; b->y += dy;
        }
        --b->ticks_left;
        if (!b->ticks_left) b->active = false;
        if (state->dead) return;
    }
}

static void combat(sim_state *state, float old_x, float old_y) {
    ++state->ticks;
    if (state->shot_ticks > 0) --state->shot_ticks;
    if (state->hurt_ticks > 0) --state->hurt_ticks;
    if (!state->boss_started && state->ticks >= SIM_BOSS_TICKS) {
        start_boss(state);
    } else if (!state->boss_started) {
        if (state->spawn_ticks > 0) --state->spawn_ticks;
        if (state->spawn_ticks == 0) {
            unsigned sequence = state->ticks / (unsigned)spawn_interval(state);
            sim_enemy_kind kind = SIM_CHASER;
            if (sim_wave(state) == 2 && sequence % 3 == 0) kind = SIM_RUNNER;
            if (sim_wave(state) == 3) {
                const sim_enemy_kind mix[] = {SIM_BRUTE, SIM_RUNNER, SIM_RUNNER, SIM_CHASER};
                kind = mix[sequence % 4];
            }
            spawn(state, kind); // Full pools/occupied spawn sites skip this attempt.
            state->spawn_ticks = spawn_interval(state);
        }
    }
    chase(state);
    shoot(state);
    projectiles(state);
    if (state->won) return;
    blades(state, old_x, old_y);
    if (state->won) return;
    boss_attacks(state);
    hostile_projectiles(state);
    if (state->hurt_ticks == 0) {
        for (int i = 0; i < SIM_MAX_ENEMIES; ++i) {
            sim_enemy *enemy = &state->enemies[i];
            if (!enemy->active || absf(enemy->x - state->x) >= SIM_ENEMY_HALF + SIM_PLAYER_HALF ||
                absf(enemy->y - state->y) >= SIM_ENEMY_HALF + SIM_PLAYER_HALF) continue;
            damage_player(state);
            break;
        }
    }
}

void sim_advance(sim_state *state, sim_input input, double elapsed) {
    assert(state);
    assert(input.x >= -1 && input.x <= 1 && input.y >= -1 && input.y <= 1);
    /* This rejects NaN and both infinities without a platform math library. */
    assert(elapsed >= 0.0 && elapsed <= DBL_MAX);
    if (state->dead || state->won || state->choosing) return;
    if (elapsed > 0.25) elapsed = 0.25;
    state->accumulator += elapsed;
    const float diagonal = 0.7071067811865475244f;
    const float step = (float)(state->move_speed * SIM_STEP) *
        ((input.x != 0 && input.y != 0) ? diagonal : 1.0f);
    /* Allow only rounding-scale slack, so rational frame partitions consume
       the same ticks (e.g. 144 frames of 1/144 second versus 30 of 1/30). */
    const double rounding = 8.0 * DBL_EPSILON;
    while (state->accumulator + rounding >= SIM_STEP) {
        float old_x = state->x, old_y = state->y;
        move_x(&state->x, state->y, SIM_PLAYER_HALF, input.x * step);
        move_y(state->x, &state->y, SIM_PLAYER_HALF, input.y * step);
        combat(state, old_x, old_y);
        if (!state->dead && !state->won) collect_gems(state);
        state->accumulator -= SIM_STEP;
        if (state->accumulator < 0.0) state->accumulator = 0.0;
        if (state->dead || state->won || state->choosing) { state->accumulator = 0.0; break; }
    }
}
