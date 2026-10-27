#ifndef GAME3_MAP_H
#define GAME3_MAP_H

#include <stdbool.h>
#include <stdint.h>

#define SIM_MAP_MIN_SIZE 8
#define SIM_MAP_MAX_WIDTH 64
#define SIM_MAP_MAX_HEIGHT 64
#define SIM_MAP_MAX_CELLS (SIM_MAP_MAX_WIDTH * SIM_MAP_MAX_HEIGHT)
#define SIM_MAP_MAX_SIZE SIM_MAP_MAX_WIDTH
#define SIM_MAP_TILE_SIZE 16
#define SIM_MAP_MAX_COORD 32768.0f

typedef struct {
    int width, height;
    float tile_size, origin_x, origin_y, spawn_x, spawn_y;
    const uint8_t *collision;
} sim_map;

/* Borrowed immutable map. collision has at least width*height bytes, rows
   bottom-to-top in Y-up coordinates. Keep it alive/stationary while states borrow
   it. This slice uses sealed, connected maps and a common 10x10 spawn body. */
const sim_map *sim_default_map(void);
/* Required internal content: malformed maps assert, never fall back. */
void sim_map_validate(const sim_map *map);
bool sim_map_solid(const sim_map *map, int x, int y);
/* View dimensions are actual visible world dimensions, not framebuffer pixels. */
void sim_map_camera(const sim_map *map, float player_x, float player_y,
                    float view_width, float view_height, float *out_x, float *out_y);

#endif
