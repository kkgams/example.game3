#include "patterns.h"
#include "bulletml/pack.h"
#include "bulletml-pack.h"

#include <assert.h>

// One owned decode per process/WASM instance. Never move or replace this storage
// while emitter states borrow it. Retry resets actors, not immutable content.
static bm_pack content;
static bool ready;

void sim_patterns_init(void) {
    if (ready) return;
    bm_pack_decode(&content, sim_bulletml_pack_bytes, sizeof sim_bulletml_pack_bytes);
    assert(content.pattern_count > 0);
    // Pack slot order is a build contract: the registered ranger asset is first.
    // The embedding tool checks this binding against the graph before compiling.
    const bm_pattern *ranger = &content.patterns[0];
    assert(ranger->action_count > 0);
    // This game adapter supports straight shots only. Reject unsupported authored
    // world behavior at startup rather than waiting until wave two to discover it.
    for (int i = 0; i < ranger->bullet_count; ++i)
        assert(ranger->bullets[i].action_count == 0);
    for (int i = 0; i < ranger->action_count; ++i)
        for (int j = 0; j < ranger->actions[i].count; ++j) {
            bm_command_kind kind = ranger->actions[i].commands[j].kind;
            assert(kind == BM_FIRE || kind == BM_ACTION || kind == BM_WAIT || kind == BM_REPEAT);
        }
    ready = true;
}

const bm_pattern *sim_ranger_pattern(void) {
    assert(ready);
    return &content.patterns[0];
}
