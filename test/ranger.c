#include "sim.h"
#include "patterns.h"
#include <assert.h>
#include <string.h>

static void tick(sim_state *s) { sim_advance(s, (sim_input){0,0}, SIM_STEP); }
static void ticks(sim_state *s, int n) { for (int i=0;i<n;++i) tick(s); }
static int shots(const sim_state *s) {
    int n=0; for(int i=0;i<SIM_MAX_HOSTILE_BULLETS;++i) n += s->hostile_bullets[i].active;
    return n;
}
static sim_state fixture(float px, float py, float x, float y) {
    sim_state s; sim_init(&s);
    s.x=px; s.y=py; s.shot_ticks=s.spawn_ticks=s.hurt_ticks=1000000;
    s.enemies[0]=(sim_enemy){.x=x,.y=y,.hp=4,.active=true,.kind=SIM_RANGER};
    bm_init(&s.enemies[0].pattern,sim_ranger_pattern(),0);
    return s;
}
static void timing_and_aim(void) {
    const float cases[][6] = {
        {-80,0,-80,-56,0,52}, {-80,0,-80,56,0,-52},
        {-48,40,-104,40,52,0}, {-48,40,8,40,-52,0},
    };
    for(int c=0;c<4;++c) {
        sim_state s=fixture(cases[c][0],cases[c][1],cases[c][2],cases[c][3]);
        ticks(&s,2);
        assert(s.enemies[0].attack_ticks>0 && s.enemies[0].pattern.wait==30 && shots(&s)==0);
        ticks(&s,60);
        assert(s.enemies[0].pattern.wait==0 && shots(&s)==0);
        ticks(&s,2);
        assert(shots(&s)==3 && s.enemies[0].pattern.wait==60 && s.enemies[0].attack_ticks==0);
        sim_bullet middle=s.hostile_bullets[1];
        float dx=middle.vx-cases[c][4],dy=middle.vy-cases[c][5];
        assert(dx*dx+dy*dy < .0001f && middle.ticks_left==SIM_BULLET_TICKS-1);
        for(int i=0;i<3;++i) {
            sim_bullet b=s.hostile_bullets[i];
            assert(b.vx*b.vx+b.vy*b.vy>2703.9f && b.vx*b.vx+b.vy*b.vy<2704.1f);
        }
    }
    sim_state s=fixture(-80,0,-80,56);
    s.hurt_ticks=0;
    ticks(&s,200);
    assert(s.hp==2 && !s.dead); // Actual aimed projectile reaches the player; no contact.
    s=fixture(-80,0,-80,0);
    ticks(&s,64);
    assert(s.enemies[0].pattern.wait==60 && s.enemies[0].pattern.last_fire_direction==190);
    // Coincident aim is explicit; shots are immediately absorbed by the overlapping player.
}
static void movement_and_visibility(void) {
    sim_state s=fixture(-48,40,80,40);
    ticks(&s,120); assert(s.enemies[0].x<80 && s.enemies[0].x>48);
    s=fixture(-48,40,-16,40);
    ticks(&s,60); assert(s.enemies[0].x>-6); // Retreat when too close.
    s=fixture(-80,0,-80,56);
    ticks(&s,120); assert(s.enemies[0].x==-80 && s.enemies[0].y==56); // Hold range.
    s=fixture(-48,8,40,8);
    ticks(&s,64); assert(shots(&s)==0 && s.enemies[0].attack_ticks==0 && s.enemies[0].pattern.wait==0);
    s.x=40; s.y=-48;
    ticks(&s,30); assert(shots(&s)==0 && s.enemies[0].pattern.wait>0);
    s.x=-48; s.y=8;
    tick(&s); assert(shots(&s)==0 && s.enemies[0].attack_ticks==0 && s.enemies[0].pattern.wait==0);
    s.x=40; s.y=-48;
    ticks(&s,62); assert(shots(&s)==0); // Reacquisition cannot bypass the tell.
    ticks(&s,2); assert(shots(&s)==3);
    s=fixture(-48,8,40,8);
    bool fired=false;
    for(int i=0;i<720;++i) { tick(&s); if(shots(&s)) fired=true; }
    assert(fired); // Routes around the obstacle, then acquires LOS and fires.
}
static void pool_pause_partition(void) {
    sim_state s=fixture(-80,0,-80,56);
    for(int i=0;i<SIM_MAX_HOSTILE_BULLETS;++i) s.hostile_bullets[i]=(sim_bullet){80,48,0,0,1000,true};
    ticks(&s,64);
    assert(shots(&s)==SIM_MAX_HOSTILE_BULLETS && s.enemies[0].pattern.wait==60);
    assert(s.hostile_bullets[0].x==80 && s.hostile_bullets[0].vx==0 && s.hostile_bullets[0].ticks_left==936);
    for(int i=0;i<SIM_MAX_HOSTILE_BULLETS;++i) s.hostile_bullets[i].active=false;
    ticks(&s,182); assert(shots(&s)==0); // No catch-up/replay of dropped shots.
    ticks(&s,2); assert(shots(&s)==3);
    s=fixture(-80,0,-80,56); ticks(&s,20);
    s.choosing=true; s.xp=s.xp_next;
    sim_state paused=s;
    sim_advance(&s,(sim_input){1,1},.25);
    assert(memcmp(&s,&paused,sizeof s)==0);
    assert(sim_choose_upgrade(&s,SIM_UPGRADE_SPEED));
    ticks(&s,44); assert(shots(&s)==3);
    sim_state runs[3]; const int fps[]={30,60,144};
    for(int i=0;i<3;++i) {
        runs[i]=fixture(-80,0,-80,56);
        for(int frame=0;frame<fps[i]*4;++frame) sim_advance(&runs[i],(sim_input){0,0},1.0/fps[i]);
        assert(runs[i].ticks==480 && runs[i].enemies[0].pattern.wait==runs[0].enemies[0].pattern.wait);
        assert(runs[i].enemies[0].attack_ticks==runs[0].enemies[0].attack_ticks);
        for(int j=0;j<SIM_MAX_HOSTILE_BULLETS;++j) {
            sim_bullet a=runs[0].hostile_bullets[j],b=runs[i].hostile_bullets[j];
            assert(a.active==b.active && a.x==b.x && a.y==b.y && a.vx==b.vx && a.vy==b.vy && a.ticks_left==b.ticks_left);
        }
    }
}
static void spawn_kill_reset(void) {
    sim_state s; sim_init(&s);
    s.ticks=SIM_WAVE_TICKS+149; s.spawn_ticks=1; s.shot_ticks=s.hurt_ticks=1000000;
    tick(&s);
    assert(s.enemies[0].kind==SIM_RANGER && s.enemies[0].hp==4 && s.enemies[0].pattern.pattern==sim_ranger_pattern());
    s=fixture(-80,40,-48,40); s.damage=4;
    s.bullets[0]=(sim_bullet){-48,40,0,0,240,true};
    tick(&s);
    assert(!s.enemies[0].active && s.kills==1 && s.gems[0].value==3);
    s.gems[0].active=false; ticks(&s,200); assert(shots(&s)==0);
    s=fixture(-80,0,-80,56); ticks(&s,20); s.ticks=SIM_BOSS_TICKS-1;
    tick(&s);
    assert(s.enemies[0].kind==SIM_BOSS && !s.enemies[0].pattern.pattern && shots(&s)==0);
    sim_init(&s);
    for(int i=0;i<SIM_MAX_ENEMIES;++i) assert(!s.enemies[i].pattern.pattern && !s.enemies[i].active);
    assert(s.ticks==0 && s.hp==3 && shots(&s)==0);
}
int main(void) { timing_and_aim(); movement_and_visibility(); pool_pause_partition(); spawn_kill_reset(); return 0; }
