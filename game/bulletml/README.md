# Independent BulletML VM

`bulletml.{h,c}` is an allocation-free C11 port of the original demo's event VM.
See [provenance](PROVENANCE.md). It depends only on standard assertions, float and
integer limits, and its own header: no Sokol, ECS, game simulation, allocator,
filesystem, GAMS, decoder or renderer. It lives in this repository, not a new
Git repository or a Host-owned SDK.

## Boundary and ownership

Input is a borrowed, immutable `bm_pattern` IR: action, fire and bullet tables,
references, numeric/string expressions. It is **not** an XML parser, JSON schema,
RSPK wire format, or the old generated decoder. Data must outlive every state
that references it. Future GAMS graph/respack loading should validate and create
this IR; no runtime loader or authoring tool is needed for the current fixture.

```c
bm_state emitter;
bm_init(&emitter, &pattern, 0);
bm_tick(&emitter, (bm_context){.rank=.5, .random=.3, .aim_direction=90}, on_event, user);
```

The caller owns the clock, aim, rank, random input and event handling. Directions
are degrees, **0 up / positive clockwise**. Speed/duration units belong to the
host. The game adapter runs the VM at 60 Hz, interprets speeds as pixels per VM
frame and converts them to pixels/second for the 120 Hz simulation.

The emit callback is synchronous; do not reenter/mutate its running state.
Spawn includes a child state, copied by value with owned frame parameter arrays.
Copy it before the callback returns if retaining it. The child still borrows its
pattern. There are no resources to destroy: discard/zero a state to release it.
`bm_restart` clears execution/wait state while preserving direction, speed and
previous-fire context, matching the demo.

## Supported demo semantics

- Action/fire references, explicit parameter expressions and repeat frames.
- Wait, vanish, spawn, done, direction/speed changes, and acceleration events.
- Aim/absolute/relative/sequence directions; absolute/relative/sequence speeds.
  Sequence fire uses the **previous shot**, not the emitter's motion direction.
- Decimal expressions, unary signs, parentheses, `+ - * /`, `$1` etc., `$rank`
  and `$rand`. Random is caller-supplied context, not a hidden random draw.
- Wait N suppresses the following N tick calls. Wait 0 continues immediately.
  Negative waits/terms/repeats clamp to zero within the accepted integer range.
- Motion commands update VM targets and emit previous/target values and terms;
  **the host performs motion interpolation**. As in the source, acceleration
  emits evaluated components; distinct acceleration-mode behavior is not added.

This is a demo-compatible VM, **not a claim of full BulletML-spec compliance**.
No XML/text BulletML loader, exponent/modulo expressions, resource decoding or
motion interpolation is included.

All state is bounded: 16 frames, eight parameters per reference, 1,024 execution
steps per tick and 32 nested expression factors. Malformed internal data,
invalid references, non-finite values, division by zero, integer overflows,
stack/depth overflow and non-yielding scripts assert. Keep assertions enabled.
The IR and expression strings are trusted internal inputs, not an untrusted
external-data validation API.

## First game adapter

`../patterns.c` contains a hand-authored parameterized three-shot fan. It uses
repeat/wait/fire references and the `$1` evaluator through real native/WASM code.
`../sim.c` owns aim, velocity conversion, walls, collisions, XP and lifecycle.
It accepts spawn/done events and **linear child bullets with no actions**;
unsupported world-integration features assert instead of being silently ignored.
The boss's existing C ring remains unchanged.

The fixed hostile pool may discard shots when full. The VM still advances, so
saturation neither stalls a pattern nor replays missed fire after a slot opens.

## Test independently

From the repository root:

```sh
node --test test/bulletml.test.mjs
# Or compile without any game/platform source:
mkdir -p build.nosync
zig cc test/bulletml.c game/bulletml/bulletml.c -Igame -std=c11 \
  -Wall -Wextra -Werror -o build.nosync/bulletml-test
./build.nosync/bulletml-test
```

The original sequence-fire regression expects 175,220,265,310,355,40,85,130,
then 125,170,215,260,305,350,35,80 after two suppressed calls. Other checks cover
scope/child ownership, restart, modes/motion events and assertion guards.
`test/ranger.c` verifies the host slice, including timing, aim, movement, LOS,
pool saturation, pause, frame partitions, waves, XP, boss entry and reset.
