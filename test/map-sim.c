#include "sim.h"
#include <assert.h>
#ifndef __wasm__
#include <stdio.h>
#include <stdlib.h>
#endif

static uint8_t cells[SIM_MAP_MAX_CELLS];
static sim_map map;
static sim_state state;
static float cx(int x) { return map.origin_x + (x + .5f) * map.tile_size; }
static float cy(int y) { return map.origin_y + (y + .5f) * map.tile_size; }
static float absolute(float x) { return x < 0 ? -x : x; }
static void near(float x, float y) { assert(absolute(x - y) < .002f); }
static void fixture(int width, int height) {
    map = (sim_map){width,height,16,-256,-192,0,0,cells};
    for (int y = 0; y < height; ++y)
        for (int x = 0; x < width; ++x)
            cells[y * width + x] = x == 0 || y == 0 || x == width-1 || y == height-1;
    map.spawn_x = cx(4); map.spawn_y = cy(height / 2);
}
static void tick(void) { sim_advance(&state, (sim_input){0,0}, SIM_STEP); }
static void quiet(void) {
    state.spawn_ticks = 100000;
    state.shot_ticks = 100000;
    state.hurt_ticks = 100000;
}

/* Both native and WASM call exactly these real-map/real-simulation assertions. */
__attribute__((visibility("default"))) int map_sim_probe(void) {
    sim_map_validate(sim_default_map());
    sim_init(&state);
    assert(state.map == sim_default_map());
    near(state.x, state.map->spawn_x); near(state.y, state.map->spawn_y);
    fixture(32,24);
    sim_map_validate(&map);
    assert(sim_map_solid(&map,-1,12) && sim_map_solid(&map,32,12));
    assert(sim_map_solid(&map,12,-1) && sim_map_solid(&map,12,24));
    assert(sim_map_solid(&map,0,12) && !sim_map_solid(&map,1,12));
    float x, y;
    sim_map_camera(&map, -80, 0, 320, 240, &x, &y);
    near(x,-80); near(y,0);
    sim_map_camera(&map, -10000, -10000, 320,240,&x,&y);
    near(x,-96); near(y,-72);
    sim_map_camera(&map, 10000, 10000, 320,240,&x,&y);
    near(x,96); near(y,72);
    sim_map_camera(&map, 10000,-10000,1024,768,&x,&y);
    near(x,0); near(y,0);
    sim_map_camera(&map, 10000,10000,512,100,&x,&y);
    near(x,0); near(y,142);
    fixture(8,8);
    sim_map_camera(&map, 0,0,320,240,&x,&y);
    near(x,-192); near(y,-128);
    /* Exercise maximum workspaces and movement sweeps across the whole map. */
    fixture(64,64);
    sim_init_map(&state,&map); quiet(); state.move_speed = 1000000;
    sim_advance(&state,(sim_input){1,0},SIM_STEP);
    near(state.x,map.origin_x + 63*16 - SIM_PLAYER_HALF);
    sim_advance(&state,(sim_input){-1,0},SIM_STEP);
    near(state.x,map.origin_x + 16 + SIM_PLAYER_HALF);
    sim_advance(&state,(sim_input){0,1},SIM_STEP);
    near(state.y,map.origin_y + 63*16 - SIM_PLAYER_HALF);
    sim_advance(&state,(sim_input){0,-1},SIM_STEP);
    near(state.y,map.origin_y + 16 + SIM_PLAYER_HALF);
    /* Long shots stop at interior walls; outside shots are immediately solid. */
    fixture(32,24);
    for (int yy=5; yy<=18; ++yy) cells[yy*32+15]=1;
    sim_init_map(&state,&map); quiet();
    state.bullets[0]=(sim_bullet){cx(14),cy(12),100000,0,100,true};
    state.hostile_bullets[0]=(sim_bullet){map.origin_x-.01f,cy(12),100000,0,100,true};
    tick();
    assert(!state.bullets[0].active && !state.hostile_bullets[0].active);
    /* Cardinal BFS must route around a long wall instead of stalling against it. */
    state.x=cx(13); state.y=cy(12);
    state.enemies[0]=(sim_enemy){.x=cx(17),.y=cy(12),.hp=1000,.active=true,.kind=SIM_RUNNER};
    for (int i=0;i<1200;++i) tick();
    assert(state.enemies[0].x < cx(15));
    assert(absolute(state.enemies[0].x-state.x)<1 && absolute(state.enemies[0].y-state.y)<1);
    /* Ordinary spawns use free inner perimeter cells, even with sparse blocks. */
    fixture(32,24);
    for(int xx=2;xx<20;++xx) cells[32+xx]=1;
    sim_init_map(&state,&map); quiet(); state.spawn_ticks=1;
    tick();
    int count=0;
    for(int i=0;i<SIM_MAX_ENEMIES;++i) if(state.enemies[i].active) {
        ++count;
        int tx=(int)((state.enemies[i].x-map.origin_x)/16);
        int ty=(int)((state.enemies[i].y-map.origin_y)/16);
        assert(!sim_map_solid(&map,tx,ty));
        assert(tx==1 || ty==1 || tx==30 || ty==22);
    }
    assert(count==1);
    /* Full pools cannot prevent a boss; validate its new spawn on a large map. */
    for(int i=0;i<SIM_MAX_ENEMIES;++i)
        state.enemies[i]=(sim_enemy){.x=state.x,.y=state.y,.hp=2,.active=true,.kind=SIM_CHASER};
    state.bullets[0]=(sim_bullet){state.x,state.y,0,0,100,true};
    state.hostile_bullets[0]=state.bullets[0];
    state.ticks=SIM_BOSS_TICKS-1;
    tick(); count=0;
    for(int i=0;i<SIM_MAX_ENEMIES;++i) if(state.enemies[i].active) {
        ++count; assert(state.enemies[i].kind==SIM_BOSS);
        assert(state.enemies[i].hp==SIM_BOSS_HP);
    }
    assert(state.boss_started && count==1);
    assert(!state.bullets[0].active && !state.hostile_bullets[0].active);
    /* Minimum admitted perimeter has eight sites, and still guarantees a boss. */
    fixture(8,8);
    for(int yy=1;yy<7;++yy) for(int xx=1;xx<7;++xx)
        if(xx==1 || yy==1 || xx==6 || yy==6) cells[yy*8+xx]=1;
    for(int xx=1;xx<=6;++xx) cells[8+xx]=0;
    cells[2*8+1]=0; cells[2*8+6]=0;
    sim_init_map(&state,&map); quiet(); state.ticks=SIM_BOSS_TICKS-1;
    tick(); assert(state.boss_started && state.enemies[0].active);
    return 1;
}

__attribute__((visibility("default"))) void map_sim_guard(int guard) {
    fixture(32,24);
    switch(guard) {
    case 0: map.width=7; break;
    case 1: map.height=65; break;
    case 2: map.tile_size=8; break;
    case 3: cells[10*32+10]=2; break;
    case 4: cells[0]=0; break;
    case 5: /* An isolated free cell, though spawn and perimeter remain valid. */
        cells[9*32+10]=cells[11*32+10]=cells[10*32+9]=cells[10*32+11]=1; break;
    case 6: cells[12*32+4]=1; break;
    case 7: /* Center free, but body overlaps the sealed outer wall. */
        map.spawn_x=map.origin_x+16+4; break;
    case 8: map.spawn_x=map.origin_x-.01f; break;
    case 9: map.collision=0; break;
    case 10:
        for(int yy=1;yy<23;++yy) for(int xx=1;xx<31;++xx)
            if(xx==1 || yy==1 || xx==30 || yy==22) cells[yy*32+xx]=1;
        break;
    case 11: map.origin_x=__builtin_nanf(""); break;
    case 12: map.spawn_y=__builtin_inff(); break;
    case 13: map.origin_x=32769; break;
    case 14: map.spawn_x=-32769; break;
    default: assert(false);
    }
    sim_init_map(&state,&map);
}

#ifndef __wasm__
int main(int argc, char **argv) {
    if(argc>1) { map_sim_guard(atoi(argv[1])); return 0; }
    assert(map_sim_probe()==1);
    puts("map simulation assertions passed");
    return 0;
}
#endif
