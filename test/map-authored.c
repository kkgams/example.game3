#include "sim.h"
#ifndef __wasm__
#include <stdio.h>
#endif

/* Identical C for baseline/edited JSON and native/WASM. The initial corridor
   extends past the old screen edge; an authored wall must stop the same sweep. */
__attribute__((visibility("default"))) float map_authored_probe(void) {
    static sim_state state;
    sim_init(&state);
    state.spawn_ticks = state.shot_ticks = 1000000;
    state.x = state.map->origin_x + 2.5f * state.map->tile_size;
    state.y = state.map->origin_y + 2.5f * state.map->tile_size;
    state.move_speed = 100000;
    sim_advance(&state, (sim_input){1,0}, SIM_STEP);
    return state.x;
}
#ifndef __wasm__
int main(void) { printf("%.3f\n", map_authored_probe()); return 0; }
#endif
