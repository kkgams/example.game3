#ifndef GAME3_SIM_H
#define GAME3_SIM_H

#include <stdbool.h>
#include <stdint.h>
#include "bulletml/bulletml.h"
#include "map.h"

#define SIM_PLAYER_HALF 5.0f
#define SIM_SPEED 64.0f
#define SIM_STEP (1.0/120.0)

#define SIM_MAX_ENEMIES 16
#define SIM_MAX_BULLETS 32
#define SIM_MAX_HOSTILE_BULLETS 32
#define SIM_WAVE_TICKS (30u * 120u)
#define SIM_BOSS_TICKS (3u * SIM_WAVE_TICKS)
#define SIM_BOSS_HP 120
#define SIM_MAX_HP 3
#define SIM_MAX_GEMS 64
#define SIM_GEM_HALF 2.0f
#define SIM_MAGNET_RADIUS 32.0f
#define SIM_MIN_SHOT_TICKS 12
#define SIM_ENEMY_HALF 5.0f
#define SIM_BULLET_HALF 2.0f
#define SIM_FIRST_SPAWN_TICKS 120
#define SIM_SPAWN_TICKS 90
#define SIM_SHOT_TICKS 60
#define SIM_HURT_TICKS 90
#define SIM_BULLET_TICKS 240

#define SIM_MAX_BLADES 4
#define SIM_BLADE_RADIUS 22.0f
#define SIM_BLADE_HALF 3.0f
#define SIM_BLADE_PERIOD 960u
#define SIM_BLADE_MAX_SPEED 12u
#define SIM_BLADE_HIT_TICKS 30

enum {
    SIM_UPGRADE_DAMAGE, SIM_UPGRADE_ATTACK, SIM_UPGRADE_SPEED,
    SIM_UPGRADE_BLADES, SIM_UPGRADE_BLADE_DAMAGE, SIM_UPGRADE_BLADE_COUNT,
    SIM_UPGRADE_BLADE_SPEED, SIM_UPGRADE_COUNT
};
typedef struct { float x, y; int value; bool active; } sim_gem;
typedef enum { SIM_CHASER, SIM_RUNNER, SIM_BRUTE, SIM_BOSS, SIM_RANGER, SIM_ENEMY_KIND_COUNT } sim_enemy_kind;
typedef struct {
    float x, y;
    int hp;
    bool active;
    sim_enemy_kind kind;
    int attack_ticks;
    int blade_hurt_ticks;
    bm_state pattern; // Active only for rangers; immutable IR is borrowed.
} sim_enemy;
typedef struct {
    float x, y, vx, vy;
    int ticks_left;
    bool active;
} sim_bullet;
typedef struct {
    const sim_map *map;
    float x, y;
    double accumulator;
    int hp, kills;
    bool dead, won, boss_started;
    unsigned ticks;
    int shot_ticks, spawn_ticks, hurt_ticks;
    int level, xp, xp_next, damage, shot_interval;
    float move_speed;
    bool choosing;
    int blade_count, blade_damage;
    unsigned blade_phase, blade_speed;
    sim_gem gems[SIM_MAX_GEMS];
    sim_enemy enemies[SIM_MAX_ENEMIES];
    sim_bullet bullets[SIM_MAX_BULLETS];
    sim_bullet hostile_bullets[SIM_MAX_HOSTILE_BULLETS];
} sim_state;
typedef struct { int x, y; } sim_input;

/* Map storage must remain immutable and alive for the entire run. */
void sim_init_map(sim_state *state, const sim_map *map);
void sim_init(sim_state *state);
/* Waves 1..3 last 30 seconds each; 4 denotes the final boss duel. Clock ticks
   advance only during active play (never choices, death or victory). */
int sim_wave(const sim_state *state);
/* Get an unlocked blade's shared render/collision position. False if occluded
   by a wall; output coordinates are still set. Blade indices must be active. */
bool sim_blade_position(const sim_state *state, int blade, float *x, float *y);
/* False outside a level-up, for locked/already-unlocked or capped options. Invalid option
   indices assert. Each accepted choice consumes one threshold, preserves excess
   XP and queues another choice if needed; no elapsed time is carried across. */
bool sim_choose_upgrade(sim_state *state, int option);
/* Axes must be -1..1. Elapsed must be finite and nonnegative, capped at .25s.
   Input applies to every fixed tick consumed by this call, including carry. */
void sim_advance(sim_state *state, sim_input input, double elapsed);

#endif
