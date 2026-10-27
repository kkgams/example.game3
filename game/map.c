#ifdef NDEBUG
#error "map validation requires assertions enabled"
#endif
#include "map.h"
#include "sim.h"
#include <assert.h>
#include <float.h>
#include "world-map.h"

const sim_map *sim_default_map(void) { return &sim_authored_map; }

bool sim_map_solid(const sim_map *map, int x, int y) {
    assert(map && map->collision);
    return x < 0 || y < 0 || x >= map->width || y >= map->height ||
           map->collision[y * map->width + x] != 0;
}

static bool finite_float(float x) { return x >= -FLT_MAX && x <= FLT_MAX; }

void sim_map_validate(const sim_map *map) {
    assert(map && map->collision);
    assert(map->width >= SIM_MAP_MIN_SIZE && map->width <= SIM_MAP_MAX_SIZE);
    assert(map->height >= SIM_MAP_MIN_SIZE && map->height <= SIM_MAP_MAX_SIZE);
    assert(map->tile_size == SIM_MAP_TILE_SIZE);
    assert(map->origin_x >= -SIM_MAP_MAX_COORD && map->origin_x <= SIM_MAP_MAX_COORD);
    assert(map->origin_y >= -SIM_MAP_MAX_COORD && map->origin_y <= SIM_MAP_MAX_COORD);
    assert(map->spawn_x >= -SIM_MAP_MAX_COORD && map->spawn_x <= SIM_MAP_MAX_COORD);
    assert(map->spawn_y >= -SIM_MAP_MAX_COORD && map->spawn_y <= SIM_MAP_MAX_COORD);
    const float right = map->origin_x + map->width * map->tile_size;
    const float top = map->origin_y + map->height * map->tile_size;
    /* Reject origins whose float precision cannot represent our tile/body grid. */
    assert(right > map->origin_x && top > map->origin_y);
    assert(map->origin_x + map->tile_size > map->origin_x);
    assert(map->origin_y + map->tile_size > map->origin_y);
    assert(map->spawn_x - SIM_PLAYER_HALF > map->origin_x &&
           map->spawn_x + SIM_PLAYER_HALF < right &&
           map->spawn_y - SIM_PLAYER_HALF > map->origin_y &&
           map->spawn_y + SIM_PLAYER_HALF < top);
    int free_cells = 0, perimeter = 0;
    for (int y = 0; y < map->height; ++y) {
        for (int x = 0; x < map->width; ++x) {
            assert(map->collision[y * map->width + x] <= 1);
            bool solid = sim_map_solid(map, x, y);
            if (x == 0 || y == 0 || x == map->width - 1 || y == map->height - 1)
                assert(solid);
            if (!solid) {
                ++free_cells;
                if (x == 1 || y == 1 || x == map->width - 2 || y == map->height - 2)
                    ++perimeter;
            } else {
                const float left = map->origin_x + x * map->tile_size;
                const float bottom = map->origin_y + y * map->tile_size;
                assert(map->spawn_x + SIM_PLAYER_HALF <= left ||
                       map->spawn_x - SIM_PLAYER_HALF >= left + map->tile_size ||
                       map->spawn_y + SIM_PLAYER_HALF <= bottom ||
                       map->spawn_y - SIM_PLAYER_HALF >= bottom + map->tile_size);
            }
        }
    }
    assert(perimeter >= 8);
    /* Spawn is strictly inside bounds, so these nonnegative casts are floors. */
    const int sx = (int)((map->spawn_x - map->origin_x) / map->tile_size);
    const int sy = (int)((map->spawn_y - map->origin_y) / map->tile_size);
    bool visited[SIM_MAP_MAX_SIZE * SIM_MAP_MAX_SIZE] = {false};
    int queue[SIM_MAP_MAX_SIZE * SIM_MAP_MAX_SIZE], head = 0, tail = 0;
    int start = sy * map->width + sx;
    assert(!sim_map_solid(map, sx, sy));
    visited[start] = true;
    queue[tail++] = start;
    const int dx[] = {-1, 1, 0, 0}, dy[] = {0, 0, -1, 1};
    while (head < tail) {
        int cell = queue[head++], x = cell % map->width, y = cell / map->width;
        for (int i = 0; i < 4; ++i) {
            int nx = x + dx[i], ny = y + dy[i], next = ny * map->width + nx;
            if (sim_map_solid(map, nx, ny) || visited[next]) continue;
            visited[next] = true;
            queue[tail++] = next;
        }
    }
    assert(tail == free_cells);
}

static float camera_axis(float player, float origin, float extent, float view) {
    if (view >= extent) return origin + extent * .5f;
    float low = origin + view * .5f, high = origin + extent - view * .5f;
    return player < low ? low : player > high ? high : player;
}

void sim_map_camera(const sim_map *map, float player_x, float player_y,
                    float view_width, float view_height, float *out_x, float *out_y) {
    assert(map && out_x && out_y);
    assert(finite_float(player_x) && finite_float(player_y));
    assert(finite_float(view_width) && view_width > 0);
    assert(finite_float(view_height) && view_height > 0);
    *out_x = camera_axis(player_x, map->origin_x, map->width * map->tile_size, view_width);
    *out_y = camera_axis(player_y, map->origin_y, map->height * map->tile_size, view_height);
}
