#ifndef GAME_APP_H
#define GAME_APP_H

#include "vendor/sokol_app.h"

// Shared application boundary. Elapsed time is seconds, not a frame count.
void init(void);
void frame(double elapsed);
void cleanup(void);
void event(const sapp_event *e);
// Reward-card pointer input, normalized within the canvas/window (Y down).
// Gameplay/outside-card clicks are ignored; selection shares keyboard guards.
void app_choose_reward(float x, float y);

// Stable scalar browser key ABI; never pass browser keyCodes/Sokol enums.
enum {
    GAME_KEY_W, GAME_KEY_A, GAME_KEY_S, GAME_KEY_D,
    GAME_KEY_UP, GAME_KEY_LEFT, GAME_KEY_DOWN, GAME_KEY_RIGHT,
    GAME_KEY_COUNT
};

#endif
