// Test-only application fixture: the production binary has no staging hooks.
// Include the app in this translation unit to stage real simulation/render state
// without exporting internals or adding cheats to game/main.c.
#include "../game/main.c"

__attribute__((export_name("test_native_click"))) void test_native_click(float nx, float ny) {
    // Native mouse coordinates use logical window points, not framebuffer pixels.
    sapp_event e = {.type=SAPP_EVENTTYPE_MOUSE_DOWN,.mouse_button=SAPP_MOUSEBUTTON_LEFT,
        .window_width=320,.window_height=240,.mouse_x=nx*320,.mouse_y=ny*240};
    event(&e);
}

__attribute__((export_name("test_offer"))) void test_offer(void) {
    assert(!state.simulation.choosing && !state.simulation.dead && !state.simulation.won);
    state.simulation.gems[0] = (sim_gem){state.simulation.x,state.simulation.y,state.simulation.xp_next,true};
    frame(SIM_STEP); // Enter the menu via actual XP collection.
}

__attribute__((export_name("test_blade_target"))) void test_blade_target(int kind) {
    assert(kind >= SIM_CHASER && kind <= SIM_BOSS);
    float x,y;
    assert(sim_blade_position(&state.simulation, 0, &x, &y));
    state.simulation.shot_ticks = state.simulation.spawn_ticks = 1000000;
    state.simulation.enemies[0] = (sim_enemy){.x=x,.y=y,.hp=1,.active=true,.kind=kind};
    if (kind == SIM_BOSS) {
        state.simulation.boss_started = true;
        state.simulation.ticks = SIM_BOSS_TICKS;
    }
    frame(SIM_STEP);
}

__attribute__((export_name("test_gems"))) void test_gems(void) {
    sim_init(&state.simulation);
    const int values[] = {1,2,4,5,69};
    for (int i = 0; i < 5; ++i)
        state.simulation.gems[i] = (sim_gem){-96 + i * 32.0f,40,values[i],true};
    frame(0);
}

__attribute__((export_name("test_drop"))) void test_drop(int kind) {
    assert(kind >= SIM_CHASER && kind <= SIM_BRUTE);
    sim_init(&state.simulation);
    state.simulation.spawn_ticks = state.simulation.shot_ticks = 1000000;
    state.simulation.enemies[0] = (sim_enemy){.x=-48,.y=0,.hp=1,.active=true,.kind=kind};
    state.simulation.bullets[0] = (sim_bullet){-48,0,0,0,240,true};
    frame(SIM_STEP); // Actual enemy kill -> drop -> app sprite submission.
}

__attribute__((export_name("test_wave"))) void test_wave(int wave) {
    assert(wave >= 1 && wave <= 3);
    sim_init(&state.simulation);
    state.simulation.ticks = (unsigned)(wave - 1) * SIM_WAVE_TICKS;
    state.simulation.spawn_ticks = 1;
    state.simulation.shot_ticks = 1000000;
    frame(SIM_STEP);
}

__attribute__((export_name("test_ranger"))) void test_ranger(void) {
    sim_init(&state.simulation);
    state.simulation.ticks = SIM_WAVE_TICKS + 149;
    state.simulation.spawn_ticks = 1;
    state.simulation.shot_ticks = state.simulation.hurt_ticks = 1000000;
    frame(SIM_STEP); // Actual wave mix and spawn initialization, not an empty VM fixture.
    assert(state.simulation.enemies[0].kind == SIM_RANGER);
    state.simulation.enemies[0].x = -80;
    state.simulation.enemies[0].y = 56;
    state.simulation.spawn_ticks = 1000000;
    frame(0);
}

__attribute__((export_name("test_ranger_defeat"))) void test_ranger_defeat(void) {
    sim_enemy *enemy = &state.simulation.enemies[0];
    assert(enemy->active && enemy->kind == SIM_RANGER);
    state.simulation.damage = 4;
    state.simulation.bullets[0] = (sim_bullet){enemy->x,enemy->y,0,0,240,true};
    frame(SIM_STEP);
}

__attribute__((export_name("test_boss"))) void test_boss(void) {
    sim_init(&state.simulation);
    state.simulation.ticks = SIM_BOSS_TICKS - 1;
    state.simulation.shot_ticks = 1000000;
    state.simulation.hurt_ticks = 1000000;
    frame(SIM_STEP);
}

__attribute__((export_name("test_enrage"))) void test_enrage(void) {
    assert(state.simulation.boss_started);
    state.simulation.enemies[0].hp = SIM_BOSS_HP / 2;
    state.simulation.enemies[0].attack_ticks = 1;
    frame(SIM_STEP);
}

__attribute__((export_name("test_win"))) void test_win(void) {
    sim_enemy *boss = &state.simulation.enemies[0];
    assert(boss->active && boss->kind == SIM_BOSS);
    boss->hp = 1;
    state.simulation.bullets[0] = (sim_bullet){boss->x,boss->y,0,0,240,true};
    frame(SIM_STEP);
}

__attribute__((export_name("test_loss"))) void test_loss(void) {
    state.simulation.hp = 1;
    state.simulation.hurt_ticks = 0;
    state.simulation.hostile_bullets[0] = (sim_bullet){
        state.simulation.x,state.simulation.y,0,0,240,true,
    };
    frame(SIM_STEP);
}
