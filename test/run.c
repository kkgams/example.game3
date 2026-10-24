#include "sim.h"
#include <assert.h>
#include <string.h>

static sim_state fixture(void) {
    sim_state s;
    sim_init(&s);
    s.spawn_ticks = s.shot_ticks = 1000000;
    return s;
}
static void tick(sim_state *s) { sim_advance(s, (sim_input){0,0}, SIM_STEP); }
static void ticks(sim_state *s, int n) { for (int i = 0; i < n; ++i) tick(s); }
static int enemies(const sim_state *s) {
    int n = 0;
    for (int i = 0; i < SIM_MAX_ENEMIES; ++i) n += s->enemies[i].active;
    return n;
}
static int hostiles(const sim_state *s) {
    int n = 0;
    for (int i = 0; i < SIM_MAX_HOSTILE_BULLETS; ++i) n += s->hostile_bullets[i].active;
    return n;
}
static void wave_boundaries(void) {
    sim_state s = fixture();
    s.ticks = SIM_WAVE_TICKS - 1; s.spawn_ticks = 1;
    s.choosing = true; s.xp = 3;
    sim_state paused = s;
    sim_advance(&s, (sim_input){1,0}, .25);
    assert(memcmp(&s, &paused, sizeof s) == 0 && sim_wave(&s) == 1);
    assert(sim_choose_upgrade(&s, SIM_UPGRADE_SPEED));
    tick(&s);
    assert(sim_wave(&s) == 2 && s.enemies[0].kind == SIM_RUNNER);
    assert(s.enemies[0].hp == 1 && s.spawn_ticks == 75);
    s = fixture(); s.ticks = 2 * SIM_WAVE_TICKS - 1; s.spawn_ticks = 1;
    tick(&s);
    assert(sim_wave(&s) == 3 && s.enemies[0].kind == SIM_BRUTE);
    assert(s.enemies[0].hp == 6 && s.spawn_ticks == 60);
    const float speeds[] = {28,44,18};
    for (int kind = SIM_CHASER; kind <= SIM_BRUTE; ++kind) {
        s = fixture();
        s.enemies[0] = (sim_enemy){.x=-72,.y=40,.hp=6,.active=true,.kind=kind};
        tick(&s);
        float distance = 40 - s.enemies[0].y;
        assert(distance > speeds[kind] / 120 - .00001f && distance < speeds[kind] / 120 + .00001f);
    }
    s = fixture();
    s.enemies[0] = (sim_enemy){.x=-48,.y=0,.hp=1,.active=true,.kind=SIM_BRUTE};
    s.bullets[0] = (sim_bullet){-48,0,0,0,240,true};
    tick(&s);
    assert(s.kills == 1 && s.gems[0].active && s.gems[0].value == 3);
}
static void boss_arrival_and_attacks(void) {
    sim_state s = fixture();
    s.ticks = SIM_BOSS_TICKS - 1; s.hp = 2; s.xp = 2; s.hurt_ticks = 1000000;
    for (int i = 0; i < SIM_MAX_ENEMIES; ++i)
        s.enemies[i] = (sim_enemy){.x=80,.y=40,.hp=6,.active=true,.kind=SIM_BRUTE};
    s.bullets[0] = (sim_bullet){-80,0,0,0,240,true};
    s.hostile_bullets[0] = s.bullets[0];
    tick(&s);
    assert(s.boss_started && sim_wave(&s) == 4 && enemies(&s) == 1);
    assert(s.enemies[0].kind == SIM_BOSS && s.enemies[0].hp == SIM_BOSS_HP);
    assert(s.enemies[0].attack_ticks == 239 && s.hp == 2 && s.xp == 2);
    assert(!s.bullets[0].active && hostiles(&s) == 0);
    ticks(&s, 238);
    assert(hostiles(&s) == 0 && s.enemies[0].attack_ticks == 1);
    tick(&s);
    assert(hostiles(&s) > 0 && hostiles(&s) <= 8 && s.enemies[0].attack_ticks == 240);
    s.enemies[0].hp = SIM_BOSS_HP / 2;
    tick(&s);
    assert(s.enemies[0].attack_ticks == 119);
    ticks(&s, 119);
    assert(s.enemies[0].attack_ticks == 120);
    // Hostile saturation cannot consume the separate player projectile pool.
    for (int i = 0; i < SIM_MAX_HOSTILE_BULLETS; ++i)
        s.hostile_bullets[i] = (sim_bullet){80,48,0,0,1000,true};
    s.enemies[0].attack_ticks = 1;
    s.shot_ticks = 0;
    tick(&s);
    assert(hostiles(&s) == SIM_MAX_HOSTILE_BULLETS && s.shot_ticks == s.shot_interval);
    assert(s.hostile_bullets[0].vx == 0 && s.hostile_bullets[0].ticks_left == 999);
}
static void projectile_damage(void) {
    sim_state s = fixture();
    s.hostile_bullets[0] = (sim_bullet){40,0,-12000,0,240,true};
    tick(&s);
    assert(s.hp == 3 && !s.hostile_bullets[0].active); // Wall shields player.
    s.hostile_bullets[0] = (sim_bullet){-100,0,12000,0,240,true};
    s.hostile_bullets[1] = s.hostile_bullets[0];
    tick(&s);
    assert(s.hp == 2 && s.hurt_ticks == SIM_HURT_TICKS && hostiles(&s) == 0);
    s.hostile_bullets[0] = (sim_bullet){80,48,0,0,1,true};
    tick(&s);
    assert(!s.hostile_bullets[0].active && s.hostile_bullets[0].ticks_left == 0);
}
static void results(void) {
    sim_state s = fixture();
    s.boss_started = true; s.ticks = SIM_BOSS_TICKS + 5;
    s.enemies[0] = (sim_enemy){.x=-48,.y=0,.hp=1,.active=true,.kind=SIM_BOSS,.attack_ticks=1};
    s.bullets[0] = (sim_bullet){-48,0,0,0,240,true};
    s.hostile_bullets[0] = (sim_bullet){s.x,s.y,0,0,240,true};
    tick(&s);
    assert(s.won && !s.dead && !s.choosing && s.hp == 3 && s.kills == 1);
    assert(enemies(&s) == 0 && hostiles(&s) == 0 && !s.bullets[0].active);
    sim_state won = s;
    ticks(&s, 60);
    assert(memcmp(&s, &won, sizeof s) == 0);
    assert(!sim_choose_upgrade(&s, SIM_UPGRADE_DAMAGE));
    sim_init(&s);
    assert(!s.won && !s.boss_started && !s.dead && s.ticks == 0 && sim_wave(&s) == 1);
    assert(s.hp == 3 && s.level == 1 && s.spawn_ticks == SIM_FIRST_SPAWN_TICKS);
    s.hp = 1; s.shot_ticks = 1000; s.boss_started = true;
    s.enemies[0] = (sim_enemy){.x=s.x,.y=s.y,.hp=60,.active=true,.kind=SIM_BOSS,.attack_ticks=240};
    tick(&s);
    assert(s.dead && !s.won);
}
static void complete_run(void) {
    sim_state s;
    sim_init(&s);
    // Invulnerability isolates run progression from playtest/balance choices.
    s.hurt_ticks = 1000000; s.damage = 3; s.shot_interval = 24;
    bool kinds[SIM_ENEMY_KIND_COUNT] = {0};
    for (int i = 0; i < 150 * 120 && !s.won; ++i) {
        if (s.choosing) assert(sim_choose_upgrade(&s, SIM_UPGRADE_DAMAGE));
        tick(&s);
        for (int j = 0; j < SIM_MAX_ENEMIES; ++j)
            if (s.enemies[j].active) kinds[s.enemies[j].kind] = true;
    }
    assert(s.won && !s.dead && s.ticks >= SIM_BOSS_TICKS && s.ticks < 150 * 120);
    for (int i = 0; i < SIM_ENEMY_KIND_COUNT; ++i) assert(kinds[i]);
}
int main(void) {
    wave_boundaries();
    boss_arrival_and_attacks();
    projectile_damage();
    results();
    complete_run();
    return 0;
}
