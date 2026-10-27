#ifdef NDEBUG
#error "simulation requires assertions enabled"
#endif
#include "sim.h"
#include "patterns.h"

#include <assert.h>
#include <float.h>
#include <limits.h>

void sim_init(sim_state *state) { sim_init_map(state, sim_default_map()); }

void sim_init_map(sim_state *state, const sim_map *map) {
    assert(state);
    sim_map_validate(map);
    sim_patterns_init();
    *state = (sim_state){ .map = map, .x = map->spawn_x, .y = map->spawn_y,
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

/* Floor before clamping; truncation would misclassify negative world offsets.
   Saturating outside coordinates also keeps casts bounded for distant shots. */
static int tile_coord(float world, float origin, float size, int count) {
    float cell = (world - origin) / size;
    if (cell < 0) return -1;
    if (cell >= count) return count;
    return (int)cell;
}
static int tile_x(const sim_map *map, float x) { return tile_coord(x, map->origin_x, map->tile_size, map->width); }
static int tile_y(const sim_map *map, float y) { return tile_coord(y, map->origin_y, map->tile_size, map->height); }
static float center_x(const sim_map *map, int x) { return map->origin_x + (x + .5f) * map->tile_size; }
static float center_y(const sim_map *map, int y) { return map->origin_y + (y + .5f) * map->tile_size; }
static float absf(float x) { return x < 0 ? -x : x; }
static float minf(float a, float b) { return a < b ? a : b; }
static float maxf(float a, float b) { return a > b ? a : b; }

typedef struct { int left, right, bottom, top; } tile_range;
static tile_range candidates(const sim_map *map, float x, float y, float dx, float dy, float half) {
    tile_range r = {
        tile_x(map, minf(x, x + dx) - half),
        tile_x(map, maxf(x, x + dx) + half),
        tile_y(map, minf(y, y + dy) - half),
        tile_y(map, maxf(y, y + dy) + half),
    };
    /* Include the cell on the other side of an exactly touching lower face. */
    if (r.left > 0) --r.left;
    if (r.bottom > 0) --r.bottom;
    if (r.left < 0) r.left = 0;
    if (r.bottom < 0) r.bottom = 0;
    if (r.right >= map->width) r.right = map->width - 1;
    if (r.top >= map->height) r.top = map->height - 1;
    return r;
}

/* Swept leading faces, X then Y, preserve the arena's wall-slide tie-break. */
static void move_x(const sim_map *map, float *px, float py, float half, float distance) {
    float target = *px + distance;
    tile_range r = candidates(map, *px, py, distance, 0, half);
    for (int y = r.bottom; y <= r.top; ++y) {
        const float bottom = map->origin_y + y * map->tile_size;
        if (py + half <= bottom || py - half >= bottom + map->tile_size) continue;
        for (int x = r.left; x <= r.right; ++x) {
            if (!sim_map_solid(map, x, y)) continue;
            const float left = map->origin_x + x * map->tile_size;
            const float low = left - half, high = left + map->tile_size + half;
            if (distance > 0 && *px <= low && target > low) target = low;
            if (distance < 0 && *px >= high && target < high) target = high;
        }
    }
    *px = target;
}

static void move_y(const sim_map *map, float px, float *py, float half, float distance) {
    float target = *py + distance;
    tile_range r = candidates(map, px, *py, 0, distance, half);
    for (int x = r.left; x <= r.right; ++x) {
        const float left = map->origin_x + x * map->tile_size;
        if (px + half <= left || px - half >= left + map->tile_size) continue;
        for (int y = r.bottom; y <= r.top; ++y) {
            if (!sim_map_solid(map, x, y)) continue;
            const float bottom = map->origin_y + y * map->tile_size;
            const float low = bottom - half, high = bottom + map->tile_size + half;
            if (distance > 0 && *py <= low && target > low) target = low;
            if (distance < 0 && *py >= high && target < high) target = high;
        }
    }
    *py = target;
}

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

static float wall_hit(const sim_map *map, float x, float y, float dx, float dy, float half) {
    if (sim_map_solid(map, tile_x(map, x), tile_y(map, y))) return 0;
    float first = 2;
    tile_range r = candidates(map, x, y, dx, dy, half);
    for (int ty = r.bottom; ty <= r.top; ++ty) {
        for (int tx = r.left; tx <= r.right; ++tx) {
            if (!sim_map_solid(map, tx, ty)) continue;
            float hit;
            const float left = map->origin_x + tx * map->tile_size;
            const float bottom = map->origin_y + ty * map->tile_size;
            if (segment_box(x, y, dx, dy, left - half, bottom - half,
                            left + map->tile_size + half,
                            bottom + map->tile_size + half, &hit) && hit < first)
                first = hit;
        }
    }
    return first;
}

static bool spawn(sim_state *state, sim_enemy_kind kind) {
    assert(kind >= SIM_CHASER && kind < SIM_ENEMY_KIND_COUNT);
    const int health[] = {2, 1, 6, SIM_BOSS_HP, 4};
    int slot = 0;
    while (slot < SIM_MAX_ENEMIES && state->enemies[slot].active) ++slot;
    if (slot == SIM_MAX_ENEMIES) return false;
    const sim_map *map = state->map;
    const int WIDTH = map->width - 2, HEIGHT = map->height - 2;
    const int PERIMETER = 2 * WIDTH + 2 * (HEIGHT - 2);
    /* Each perimeter center is attempted once, with a deterministic wave offset. */
    const unsigned wave = state->ticks / SIM_SPAWN_TICKS;
    for (int attempt = 0; attempt < PERIMETER; ++attempt) {
        int n = (int)((wave * 13u + (unsigned)attempt) % PERIMETER), x, y;
        if (n < WIDTH) { x = n + 1; y = 1; }
        else if ((n -= WIDTH) < HEIGHT - 2) { x = map->width - 2; y = n + 2; }
        else if ((n -= HEIGHT - 2) < WIDTH) { x = map->width - 2 - n; y = map->height - 2; }
        else { n -= WIDTH; x = 1; y = map->height - 3 - n; }
        const float px = center_x(state->map, x), py = center_y(state->map, y);
        bool occupied = absf(px - state->x) < SIM_PLAYER_HALF + SIM_ENEMY_HALF &&
                        absf(py - state->y) < SIM_PLAYER_HALF + SIM_ENEMY_HALF;
        for (int i = 0; i < SIM_MAX_ENEMIES; ++i) {
            const sim_enemy *enemy = &state->enemies[i];
            if (enemy->active && absf(px - enemy->x) < 2 * SIM_ENEMY_HALF &&
                absf(py - enemy->y) < 2 * SIM_ENEMY_HALF) occupied = true;
        }
        if (!occupied && !sim_map_solid(map, x, y)) {
            state->enemies[slot] = (sim_enemy){
                .x = px, .y = py, .hp = health[kind], .active = true,
                .kind = kind, .attack_ticks = kind == SIM_BOSS ? 240 : 0,
            };
            if (kind == SIM_RANGER) bm_init(&state->enemies[slot].pattern, sim_ranger_pattern(), 0);
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
    assert(spawned); // Validation guarantees ample connected free perimeter cells.
    (void)spawned;
}

static void chase(sim_state *state) {
    const sim_map *map = state->map;
    int distance[SIM_MAP_MAX_SIZE][SIM_MAP_MAX_SIZE];
    int queue[SIM_MAP_MAX_SIZE * SIM_MAP_MAX_SIZE], head = 0, tail = 0;
    for (int y = 0; y < map->height; ++y)
        for (int x = 0; x < map->width; ++x) distance[y][x] = -1;
    const int px = tile_x(map, state->x), py = tile_y(map, state->y);
    assert(!sim_map_solid(map, px, py));
    distance[py][px] = 0;
    queue[tail++] = py * map->width + px;
    const int dx[4] = {-1, 1, 0, 0}, dy[4] = {0, 0, -1, 1};
    while (head < tail) {
        const int cell = queue[head++], x = cell % map->width, y = cell / map->width;
        for (int i = 0; i < 4; ++i) {
            const int nx = x + dx[i], ny = y + dy[i];
            if (sim_map_solid(map, nx, ny) || distance[ny][nx] >= 0) continue;
            distance[ny][nx] = distance[y][x] + 1;
            queue[tail++] = ny * map->width + nx;
        }
    }
    for (int i = 0; i < SIM_MAX_ENEMIES; ++i) {
        sim_enemy *enemy = &state->enemies[i];
        if (!enemy->active) continue;
        const int x = tile_x(map, enemy->x), y = tile_y(map, enemy->y);
        assert(!sim_map_solid(map, x, y));
        float tx = state->x, ty = state->y;
        if (enemy->kind == SIM_RANGER) {
            float rx = state->x - enemy->x, ry = state->y - enemy->y;
            float range = __builtin_sqrtf(rx * rx + ry * ry);
            bool visible = wall_hit(state->map, enemy->x, enemy->y, rx, ry, SIM_BULLET_HALF) > 1;
            if (visible && range >= 48 && range <= 80) continue; // Hold firing distance.
            if (visible && range > 0 && range < 48) {
                float retreat = (float)(22 * SIM_STEP) / range;
                move_x(state->map, &enemy->x, enemy->y, SIM_ENEMY_HALF, -rx * retreat);
                move_y(state->map, enemy->x, &enemy->y, SIM_ENEMY_HALF, -ry * retreat);
                continue;
            }
        }
        if (distance[y][x] != 0) {
            tx = center_x(state->map, x); ty = center_y(state->map, y);
            for (int dir = 0; dir < 4; ++dir) {
                const int nx = x + dx[dir], ny = y + dy[dir];
                if (sim_map_solid(map, nx, ny) || distance[ny][nx] < 0 ||
                    distance[ny][nx] >= distance[y][x]) continue;
                /* Align perpendicular before crossing an edge to avoid corner cuts. */
                if (dx[dir] && absf(enemy->y - ty) < .001f) tx = center_x(state->map, nx);
                if (dy[dir] && absf(enemy->x - tx) < .001f) ty = center_y(state->map, ny);
                break;
            }
        }
        float vx = tx - enemy->x, vy = ty - enemy->y;
        const float length = __builtin_sqrtf(vx * vx + vy * vy);
        const float speeds[] = {28, 44, 18, 24, 22};
        assert(enemy->kind >= SIM_CHASER && enemy->kind < SIM_ENEMY_KIND_COUNT);
        const float step = (float)(speeds[enemy->kind] * SIM_STEP);
        if (length > step) { vx *= step / length; vy *= step / length; }
        move_x(state->map, &enemy->x, enemy->y, SIM_ENEMY_HALF, vx);
        move_y(state->map, enemy->x, &enemy->y, SIM_ENEMY_HALF, vy);
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
        if (wall_hit(state->map, state->x, state->y, dx, dy, SIM_BULLET_HALF) <= 1) continue;
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
            wall_hit(state->map, gem->x, gem->y, dx, dy, SIM_GEM_HALF) <= 1) continue;
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
    const int rewards[] = {1, 2, 5, 0, 3};
    assert(enemy->kind >= SIM_CHASER && enemy->kind < SIM_ENEMY_KIND_COUNT);
    assert(rewards[enemy->kind] > 0);
    drop_gem(state, enemy->x, enemy->y, rewards[enemy->kind]);
}

static void projectiles(sim_state *state) {
    for (int i = 0; i < SIM_MAX_BULLETS; ++i) {
        sim_bullet *bullet = &state->bullets[i];
        if (!bullet->active) continue;
        if (bullet->ticks_left <= 0) { bullet->active = false; continue; }
        float dx = bullet->vx * (float)SIM_STEP, dy = bullet->vy * (float)SIM_STEP;
        float first = wall_hit(state->map, bullet->x, bullet->y, dx, dy, SIM_BULLET_HALF);
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
    return wall_hit(state->map, state->x, state->y, *x - state->x, *y - state->y, SIM_BLADE_HALF) > 1;
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
        float wall = wall_hit(state->map, previous_x, previous_y, dx, dy, SIM_BLADE_HALF);
        for (int j = 0; j < SIM_MAX_ENEMIES; ++j) {
            sim_enemy *enemy = &state->enemies[j];
            if (!enemy->active || enemy->blade_hurt_ticks) continue;
            // Neither a clipped orbit nor an enemy behind a wall can be hit.
            if (wall_hit(state->map, state->x, state->y, enemy->x - state->x, enemy->y - state->y, 0) <= 1) continue;
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

// Convert through the same interpolated unit circle used by blades. Paired
// inverse/forward interpolation aims along the target vector without host trig.
static double aim_direction(float dx, float dy, double fallback) {
    if (dx == 0 && dy == 0) return fallback; // Coincident actors reuse the prior shot heading.
    double x = dy, y = dx; // BulletML: 0 up, clockwise; world: Y up.
    for (int i = 0; i < 32; ++i) {
        int next = (i + 1) % 32;
        double a = blade_circle[i][0] * y - blade_circle[i][1] * x;
        double b = x * blade_circle[next][1] - y * blade_circle[next][0];
        if (a < 0 || b < 0) continue;
        assert(a + b > 0);
        double direction = (i + a / (a + b)) * (360.0 / 32);
        return direction >= 360 ? direction - 360 : direction;
    }
    assert(false); // Every nonzero vector belongs to a circle sector.
    return 0;
}

typedef struct { sim_state *state; sim_enemy *enemy; } ranger_emitter;

static void ranger_event(void *user, const bm_event *event) {
    ranger_emitter *emitter = user;
    if (event->kind == BM_DONE) return;
    // First host slice deliberately accepts linear child bullets only. The VM
    // supports child actions/motion events, but their world integration is next.
    assert(event->kind == BM_SPAWN && event->child.depth == 0 && event->child.wait == 0);
    assert(event->direction >= 0 && event->direction < 360 && event->speed >= 0 && event->speed <= FLT_MAX / SIM_PATTERN_HZ);
    for (int i = 0; i < SIM_MAX_HOSTILE_BULLETS; ++i) {
        sim_bullet *bullet = &emitter->state->hostile_bullets[i];
        if (bullet->active) continue;
        double phase = event->direction * (32.0 / 360);
        int index = (int)phase, next = (index + 1) % 32;
        float t = (float)(phase - index);
        float vx = blade_circle[index][1] + t * (blade_circle[next][1] - blade_circle[index][1]);
        float vy = blade_circle[index][0] + t * (blade_circle[next][0] - blade_circle[index][0]);
        float scale = (float)(event->speed * SIM_PATTERN_HZ) / __builtin_sqrtf(vx * vx + vy * vy);
        *bullet = (sim_bullet){emitter->enemy->x,emitter->enemy->y,vx*scale,vy*scale,SIM_BULLET_TICKS,true};
        return;
    }
    // Pool saturation is expected: discard this shot, never stall/replay the VM.
}

static void ranger_attacks(sim_state *state) {
    for (int i = 0; i < SIM_MAX_ENEMIES; ++i) {
        sim_enemy *enemy = &state->enemies[i];
        if (!enemy->active || enemy->kind != SIM_RANGER) continue;
        assert(enemy->pattern.pattern == sim_ranger_pattern());
        float dx = state->x - enemy->x, dy = state->y - enemy->y;
        if (dx*dx + dy*dy > 96*96 || wall_hit(state->map, enemy->x,enemy->y,dx,dy,SIM_BULLET_HALF) <= 1) {
            bm_restart(&enemy->pattern, 0); // Reacquisition always gets a full tell.
            enemy->attack_ticks = 0;
            continue;
        }
        if (state->ticks % SIM_PATTERN_SUBSTEPS) continue; // VM 60 Hz, simulation 120.
        bm_context context = {.rank=.5,.random=.3,
            .aim_direction=aim_direction(dx,dy,enemy->pattern.last_fire_direction)};
        ranger_emitter emitter = {state,enemy};
        bm_tick(&enemy->pattern, context, ranger_event, &emitter);
        // Short waits are the warning window for this fixture. Do not inspect
        // VM stack/opcode positions: future authored actions can change freely.
        bool warning = !enemy->pattern.done && enemy->pattern.wait <= 30;
        enemy->attack_ticks = warning ? (enemy->pattern.wait + 1) * SIM_PATTERN_SUBSTEPS : 0;
    }
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
        float wall = wall_hit(state->map, b->x, b->y, dx, dy, SIM_BULLET_HALF), hit;
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
            if (sim_wave(state) == 2) {
                const sim_enemy_kind mix[] = {SIM_RUNNER, SIM_CHASER, SIM_RANGER, SIM_CHASER};
                kind = mix[sequence % 4];
            }
            if (sim_wave(state) == 3) {
                const sim_enemy_kind mix[] = {SIM_BRUTE, SIM_RUNNER, SIM_RANGER, SIM_CHASER};
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
    ranger_attacks(state);
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
    assert(state && state->map);
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
        move_x(state->map, &state->x, state->y, SIM_PLAYER_HALF, input.x * step);
        move_y(state->map, state->x, &state->y, SIM_PLAYER_HALF, input.y * step);
        combat(state, old_x, old_y);
        if (!state->dead && !state->won) collect_gems(state);
        state->accumulator -= SIM_STEP;
        if (state->accumulator < 0.0) state->accumulator = 0.0;
        if (state->dead || state->won || state->choosing) { state->accumulator = 0.0; break; }
    }
}
