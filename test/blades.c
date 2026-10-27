#include "arena.h"
#include <assert.h>
#include <string.h>

static void tick(sim_state *s) { sim_advance(s, (sim_input){0,0}, SIM_STEP); }
static bool upgrade(sim_state *s, int option) {
    s->xp = s->xp_next; s->choosing = true;
    return sim_choose_upgrade(s, option);
}
static sim_state fixture(void) {
    sim_state s;
    sim_init(&s);
    s.spawn_ticks = s.shot_ticks = s.hurt_ticks = 1000000;
    assert(upgrade(&s, SIM_UPGRADE_BLADES));
    return s;
}
static void target(sim_state *s, int slot, int hp, sim_enemy_kind kind) {
    float x,y;
    assert(sim_blade_position(s, 0, &x, &y));
    s->enemies[slot] = (sim_enemy){.x=x,.y=y,.hp=hp,.active=true,.kind=kind};
}
static void choices(void) {
    sim_state s; sim_init(&s);
    s.xp = 3; s.choosing = true;
    sim_state before = s;
    assert(!sim_choose_upgrade(&s, SIM_UPGRADE_BLADE_DAMAGE));
    assert(!sim_choose_upgrade(&s, SIM_UPGRADE_BLADE_COUNT));
    assert(!sim_choose_upgrade(&s, SIM_UPGRADE_BLADE_SPEED));
    assert(memcmp(&s, &before, sizeof s) == 0);
    assert(sim_choose_upgrade(&s, SIM_UPGRADE_BLADES));
    assert(s.blade_count == 2 && s.blade_damage == 1 && s.blade_speed == 4);
    assert(s.blade_phase == 0 && s.level == 2 && s.xp == 0);
    assert(s.damage == 1 && s.shot_interval == 60 && s.move_speed == 64);
    s.xp = s.xp_next; s.choosing = true; before = s;
    assert(!sim_choose_upgrade(&s, SIM_UPGRADE_BLADES));
    assert(memcmp(&s, &before, sizeof s) == 0);
    assert(upgrade(&s, SIM_UPGRADE_BLADE_DAMAGE) && s.blade_damage == 2 && s.damage == 1);
    while (s.blade_count < SIM_MAX_BLADES) assert(upgrade(&s, SIM_UPGRADE_BLADE_COUNT));
    s.xp = s.xp_next; s.choosing = true; before = s;
    assert(!sim_choose_upgrade(&s, SIM_UPGRADE_BLADE_COUNT));
    assert(memcmp(&s, &before, sizeof s) == 0);
    while (s.blade_speed < SIM_BLADE_MAX_SPEED) assert(upgrade(&s, SIM_UPGRADE_BLADE_SPEED));
    s.xp = s.xp_next; s.choosing = true; before = s;
    assert(!sim_choose_upgrade(&s, SIM_UPGRADE_BLADE_SPEED));
    assert(memcmp(&s, &before, sizeof s) == 0);
    assert(sim_choose_upgrade(&s, SIM_UPGRADE_SPEED)); // Capped blades do not trap choices.
}
static void orbit_and_clock(void) {
    sim_state s = fixture(); float x,y;
    assert(sim_blade_position(&s, 0, &x, &y) && x == -58 && y == 0);
    assert(sim_blade_position(&s, 1, &x, &y) && x == -102 && y == 0);
    for (int count = 2; count <= SIM_MAX_BLADES; ++count) {
        s.blade_count = count;
        for (unsigned phase = 0; phase < SIM_BLADE_PERIOD; phase += 7) {
            s.blade_phase = phase;
            for (int i = 0; i < count; ++i) {
                assert(sim_blade_position(&s, i, &x, &y));
                float dx=x-s.x,dy=y-s.y,r2=dx*dx+dy*dy;
                assert(r2 > 21.8f*21.8f && r2 < 22.01f*22.01f);
            }
        }
    }
    s = fixture();
    sim_advance(&s, (sim_input){1,0}, .25);
    assert(s.x > -64.001f && s.x < -63.999f && s.blade_phase == 120);
    assert(sim_blade_position(&s, 0, &x, &y));
    assert(x > -49 && x < -48 && y > 15 && y < 16);
    s.choosing = true; s.xp = s.xp_next;
    sim_state paused = s;
    sim_advance(&s, (sim_input){1,1}, .25);
    assert(memcmp(&s, &paused, sizeof s) == 0);
    s.choosing = false; s.dead = true; paused = s;
    tick(&s); assert(memcmp(&s, &paused, sizeof s) == 0);
    sim_state partitions[3]; const int fps[] = {30,60,144};
    for (int i = 0; i < 3; ++i) {
        partitions[i] = fixture(); target(&partitions[i], 0, 10000, SIM_BRUTE);
        for (int frame = 0; frame < fps[i]*4; ++frame)
            sim_advance(&partitions[i], (sim_input){0,0}, 1.0/fps[i]);
        assert(partitions[i].ticks == 480 && partitions[i].blade_phase == 0);
        assert(partitions[i].enemies[0].hp == partitions[0].enemies[0].hp);
        assert(partitions[i].enemies[0].blade_hurt_ticks == partitions[0].enemies[0].blade_hurt_ticks);
    }
}
static void hits(void) {
    sim_state s = fixture(); s.damage = 100;
    target(&s, 0, 100, SIM_BRUTE); target(&s, 1, 100, SIM_BRUTE);
    tick(&s);
    assert(s.enemies[0].hp == 99 && s.enemies[1].hp == 99); // Cleaves; independent from shot damage.
    assert(s.enemies[0].blade_hurt_ticks == SIM_BLADE_HIT_TICKS);
    for (int i = 1; i <= SIM_BLADE_HIT_TICKS; ++i) {
        float x,y; assert(sim_blade_position(&s, 0, &x, &y));
        s.enemies[0].x=x; s.enemies[0].y=y;
        tick(&s);
        assert(s.enemies[0].hp == (i == SIM_BLADE_HIT_TICKS ? 98 : 99));
    }
    s.enemies[0].active = false; s.enemies[1].active = false; s.spawn_ticks = 1;
    tick(&s);
    assert(s.enemies[0].active && s.enemies[0].blade_hurt_ticks == 0); // Reused spawn slot is fresh.
    s = fixture(); s.y = 40; s.move_speed = 6000;
    s.enemies[0] = (sim_enemy){.x=-33,.y=40,.hp=10,.active=true,.kind=SIM_BRUTE};
    sim_advance(&s, (sim_input){1,0}, SIM_STEP);
    assert(s.enemies[0].hp == 9); // Swept hit: neither endpoint overlaps the enemy.
    s = fixture(); s.x = -24; s.y = 24; s.blade_phase = 900;
    float x,y; assert(!sim_blade_position(&s, 0, &x, &y)); // Blade clipped at the wall corner.
    // Valid enemy above the wall overlaps the blade's box, but cannot be hit
    // by a blade hidden in the wall. Center-to-enemy LOS alone is insufficient.
    s.enemies[0] = (sim_enemy){.x=-8,.y=21,.hp=10,.active=true,.kind=SIM_BRUTE};
    tick(&s); assert(s.enemies[0].hp == 10);
    const int rewards[] = {1,2,5};
    for (int kind = SIM_CHASER; kind <= SIM_BRUTE; ++kind) {
        s = fixture(); s.blade_damage = 100; target(&s, 0, 6, kind);
        for (int i = 0; i < SIM_MAX_BULLETS; ++i)
            s.bullets[i] = (sim_bullet){80,48,0,0,240,true};
        tick(&s);
        assert(s.kills == 1 && !s.enemies[0].active && s.gems[0].value == rewards[kind]);
        assert(s.bullets[SIM_MAX_BULLETS-1].active); // Independent of a full shot pool.
        if (kind == SIM_BRUTE) {
            for (int i = 0; i < 60 && !s.choosing; ++i) tick(&s);
            assert(s.choosing && s.xp == 5 && s.level == 2);
            assert(sim_choose_upgrade(&s, SIM_UPGRADE_BLADE_DAMAGE));
            assert(s.level == 3 && s.xp == 0 && s.blade_damage == 101);
        }
    }
}
static void boss_and_reset(void) {
    sim_state s = fixture();
    s.ticks = SIM_BOSS_TICKS-1;
    tick(&s);
    assert(s.boss_started && s.blade_count == 2 && s.blade_damage == 1 && s.blade_speed == 4);
    target(&s, 0, 1, SIM_BOSS);
    s.hp = 1; s.hurt_ticks = 0;
    s.hostile_bullets[0] = (sim_bullet){s.x,s.y,0,0,240,true};
    tick(&s);
    assert(s.won && !s.dead && s.hp == 1 && s.kills == 1);
    assert(!s.hostile_bullets[0].active);
    sim_state won = s;
    tick(&s); assert(memcmp(&s, &won, sizeof s) == 0);
    sim_init(&s);
    assert(!s.blade_count && !s.blade_damage && !s.blade_speed && !s.blade_phase);
    assert(!s.enemies[0].blade_hurt_ticks && !s.won && !s.dead && s.level == 1);
}
int main(void) {
    choices(); orbit_and_clock(); hits(); boss_and_reset();
    return 0;
}
