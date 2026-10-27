#ifndef GAME3_TEST_ARENA_H
#define GAME3_TEST_ARENA_H

#include "sim.h"
#include "arena-map.h"

/* Existing combat/VM regressions intentionally run on the original authored
   16x10 arena, independently of the larger production map. No C map duplicate. */
static inline void sim_test_init(sim_state *state) {
    sim_init_map(state, &sim_authored_map);
}
#define sim_init sim_test_init
#define SIM_WIDTH (sim_authored_map.width)
#define SIM_HEIGHT (sim_authored_map.height)
#define SIM_TILE_SIZE (sim_authored_map.tile_size)
#define SIM_ORIGIN_X (sim_authored_map.origin_x)
#define SIM_ORIGIN_Y (sim_authored_map.origin_y)
static inline bool sim_solid(int x, int y) {
    return sim_map_solid(&sim_authored_map, x, y);
}
static inline uint8_t sim_tile(int x, int y) {
    return sim_solid(x, y) ? 4 : (uint8_t)(1 + ((x + y) & 1));
}

#endif
