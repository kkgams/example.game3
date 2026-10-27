// Same actual simulation/pack adapter compiled natively and freestanding WASM.
#include "arena.h"
#include "patterns.h"
#include <assert.h>

static sim_state state;
static int ticks, count;
static float velocities[3][2];

#ifdef __wasm__
#define EXPORT(name) __attribute__((export_name(name)))
#else
#define EXPORT(name)
#endif

EXPORT("probe") void probe(void) {
    sim_init(&state); // Decodes the embedded content before any wave begins.
    state.ticks = SIM_WAVE_TICKS + 149;
    state.spawn_ticks = 1;
    state.shot_ticks = state.hurt_ticks = 1000000;
    sim_advance(&state, (sim_input){0}, SIM_STEP);
    sim_enemy *enemy = &state.enemies[0];
    assert(enemy->active && enemy->kind == SIM_RANGER);
    assert(enemy->pattern.pattern == sim_ranger_pattern());
    enemy->x = -80; enemy->y = 56;
    bm_restart(&enemy->pattern, 0);
    state.spawn_ticks = 1000000;
    ticks = count = 0;
    while (ticks < 1000 && !count) {
        sim_advance(&state, (sim_input){0}, SIM_STEP);
        ++ticks;
        for (int i = 0; i < SIM_MAX_HOSTILE_BULLETS; ++i) {
            const sim_bullet *shot = &state.hostile_bullets[i];
            if (!shot->active) continue;
            assert(count < 3);
            velocities[count][0] = shot->vx;
            velocities[count][1] = shot->vy;
            ++count;
        }
    }
    assert(count == 3);
}

EXPORT("probe_ticks") int probe_ticks(void) { return ticks; }
EXPORT("probe_count") int probe_count(void) { return count; }
EXPORT("probe_velocity") double probe_velocity(int shot, int axis) {
    assert(shot >= 0 && shot < count && axis >= 0 && axis < 2);
    return velocities[shot][axis];
}

#ifndef __wasm__
#include <stdio.h>
int main(void) {
    probe();
    printf("[%d,%d", ticks, count);
    for (int i = 0; i < count; ++i)
        printf(",%.9g,%.9g", (double)velocities[i][0], (double)velocities[i][1]);
    puts("]");
    return 0;
}
#endif
