#ifndef GAME3_SIM_H
#define GAME3_SIM_H

#include <stdbool.h>
#include <stdint.h>

#define SIM_WIDTH 16
#define SIM_HEIGHT 10
#define SIM_TILE_SIZE 16
#define SIM_ORIGIN_X (-128.0f)
#define SIM_ORIGIN_Y (-80.0f)
#define SIM_PLAYER_HALF 5.0f
#define SIM_SPEED 64.0f
#define SIM_STEP (1.0/120.0)

#define SIM_MAX_ENEMIES 16
#define SIM_MAX_BULLETS 32
#define SIM_MAX_HP 3
#define SIM_ENEMY_HALF 5.0f
#define SIM_BULLET_HALF 2.0f
#define SIM_FIRST_SPAWN_TICKS 120
#define SIM_SPAWN_TICKS 90
#define SIM_SHOT_TICKS 60
#define SIM_HURT_TICKS 90
#define SIM_BULLET_TICKS 240

typedef struct { float x, y; int hp; bool active; } sim_enemy;
typedef struct {
    float x, y, vx, vy;
    int ticks_left;
    bool active;
} sim_bullet;
typedef struct {
    float x, y;
    double accumulator;
    int hp, kills;
    bool dead;
    unsigned ticks;
    int shot_ticks, spawn_ticks, hurt_ticks;
    sim_enemy enemies[SIM_MAX_ENEMIES];
    sim_bullet bullets[SIM_MAX_BULLETS];
} sim_state;
typedef struct { int x, y; } sim_input;

/* Tile (0, 0) is bottom-left; world coordinates are Y-up. Outside is solid. */
bool sim_solid(int x, int y);
uint8_t sim_tile(int x, int y);
void sim_init(sim_state *state);
/* Axes must be -1..1. Elapsed must be finite and nonnegative, capped at .25s.
   Input applies to every fixed tick consumed by this call, including carry. */
void sim_advance(sim_state *state, sim_input input, double elapsed);

#endif
