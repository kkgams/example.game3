#include "patterns.h"

#define NUMBER(n) {.kind=BM_NUMBER,.number=(n)}
#define DIRECTION(mode,n) {.kind=(mode),.value=NUMBER(n)}
#define SPEED(n) {.kind=BM_SPEED_ABSOLUTE,.value=NUMBER(n)}

// VM runs at 60 Hz; speed is pixels per VM frame (52 pixels/second here).
// Wait 30 telegraphs the fan, wait 60 rests after it;
// demo Wait semantics also consume a resume call (see bulletml/README.md).
static const bm_command top[] = {
    {.kind=BM_REPEAT,.repeat={.times=NUMBER(1000000),.action={.index=1}}},
};
static const bm_expr offsets[][1] = {{NUMBER(-10)},{NUMBER(0)},{NUMBER(10)}};
static const bm_command burst[] = {
    {.kind=BM_WAIT,.wait=NUMBER(30)},
    {.kind=BM_FIRE,.ref={.index=0,.params=offsets[0],.param_count=1}},
    {.kind=BM_FIRE,.ref={.index=0,.params=offsets[1],.param_count=1}},
    {.kind=BM_FIRE,.ref={.index=0,.params=offsets[2],.param_count=1}},
    {.kind=BM_WAIT,.wait=NUMBER(60)},
};
static const bm_action actions[] = {{top,1},{burst,5}};
static const bm_bullet bullets[] = {
    {.direction=DIRECTION(BM_DIRECTION_ABSOLUTE,0),.speed=SPEED(52.0 / SIM_PATTERN_HZ)},
};
static const bm_fire fires[] = {
    {.direction={.kind=BM_AIM,.value={.kind=BM_EXPRESSION,.source="$1"}},
     .speed=SPEED(52.0 / SIM_PATTERN_HZ),.bullet={.index=0}},
};
const bm_pattern sim_ranger_pattern = {
    .bullets=bullets,.bullet_count=1,.actions=actions,.action_count=2,.fires=fires,.fire_count=1,
};
