#ifndef GAME3_BULLETML_H
#define GAME3_BULLETML_H

#include <stdbool.h>

// Independent, allocation-free port of the demo's event-emitting BulletML VM.
// Input is borrowed immutable pattern IR, not XML, JSON or an RSPK wire layout.
#define BM_MAX_FRAMES 16
#define BM_MAX_PARAMS 8
#define BM_MAX_STEPS 1024
#define BM_MAX_EXPR_DEPTH 32

typedef enum { BM_NUMBER = 1, BM_EXPRESSION = 2 } bm_expr_kind;
typedef struct { bm_expr_kind kind; double number; const char *source; } bm_expr;
typedef struct { int index; const bm_expr *params; int param_count; } bm_ref;
typedef enum { BM_AIM, BM_DIRECTION_ABSOLUTE, BM_DIRECTION_RELATIVE, BM_DIRECTION_SEQUENCE } bm_direction_kind;
typedef enum { BM_SPEED_ABSOLUTE, BM_SPEED_RELATIVE, BM_SPEED_SEQUENCE } bm_speed_kind;
typedef struct { bm_direction_kind kind; bm_expr value; } bm_direction;
typedef struct { bm_speed_kind kind; bm_expr value; } bm_speed;
typedef enum {
    BM_FIRE = 1, BM_ACTION, BM_WAIT, BM_REPEAT, BM_VANISH,
    BM_CHANGE_DIRECTION, BM_CHANGE_SPEED, BM_ACCEL
} bm_command_kind;
typedef struct {
    bm_command_kind kind;
    union {
        bm_ref ref; // Fire/action reference.
        bm_expr wait;
        struct { bm_expr times; bm_ref action; } repeat;
        struct { bm_direction value; bm_expr term; } direction;
        struct { bm_speed value; bm_expr term; } speed;
        struct { bm_speed horizontal, vertical; bm_expr term; } accel;
    };
} bm_command;
typedef struct { const bm_command *commands; int count; } bm_action;
typedef struct { bm_direction direction; bm_speed speed; const bm_ref *actions; int action_count; } bm_bullet;
typedef struct { bm_direction direction; bm_speed speed; bm_ref bullet; } bm_fire;
typedef struct {
    const bm_bullet *bullets; int bullet_count;
    const bm_action *actions; int action_count;
    const bm_fire *fires; int fire_count;
} bm_pattern;
typedef struct { double rank, random, aim_direction; } bm_context;
typedef struct {
    int action, command, remaining, param_count;
    double params[BM_MAX_PARAMS];
} bm_frame;
typedef struct {
    const bm_pattern *pattern;
    bm_frame frames[BM_MAX_FRAMES];
    int depth, wait;
    bool done;
    double direction, speed, last_fire_direction, last_fire_speed;
} bm_state;
typedef enum { BM_SPAWN, BM_EVENT_VANISH, BM_EVENT_DIRECTION, BM_EVENT_SPEED, BM_EVENT_ACCEL, BM_DONE } bm_event_kind;
typedef struct {
    bm_event_kind kind;
    int bullet, term;
    double direction, speed, previous_direction, previous_speed, horizontal, vertical;
    bm_state child; // Valid for Spawn; copy if retaining beyond callback.
} bm_event;
typedef void (*bm_emit)(void *user, const bm_event *event);

// Directions are degrees: 0=up, positive clockwise. Speed and tick units belong
// to the host. Wait N suppresses the following N tick calls (demo semantics).
// State/IR overflow, malformed data/expressions and runaway scripts assert.
void bm_init(bm_state *state, const bm_pattern *pattern, int action);
// Restart preserves motion/previous-fire context, matching the original VM.
void bm_restart(bm_state *state, int action);
void bm_tick(bm_state *state, bm_context context, bm_emit emit, void *user);
double bm_eval(bm_expr expr, const double *params, int count, bm_context context);

#endif
