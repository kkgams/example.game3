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
this IR. The separate `pack.{h,c}` decoder now does so for authored resources;
the VM itself has no decoder dependency.

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
No XML/text BulletML loader, exponent/modulo expressions or motion interpolation
is included in the VM. Resource decoding is a separate module.

All state is bounded: 16 frames, eight parameters per reference, 1,024 execution
steps per tick and 32 nested expression factors. Malformed internal data,
invalid references, non-finite values, division by zero, integer overflows,
stack/depth overflow and non-yielding scripts assert. Keep assertions enabled.
The IR and expression strings are trusted internal inputs, not an untrusted
external-data validation API.

## First game adapter

`../../content/bulletml/ranger-fan.bulletml.json` authors the three-shot fan.
`../patterns.c` decodes the embedded RSPK once into owned stationary storage and
returns const IR through `sim_ranger_pattern()`. It no longer duplicates pattern
data in C. Repeat/wait/fire references and `$1` run through real native/WASM code.
Startup rejects child actions/unsupported world commands for the selected ranger.
`../sim.c` owns aim, velocity conversion, walls, collisions, XP and lifecycle.
It accepts spawn/done events and **linear child bullets with no actions**;
unsupported world-integration features assert instead of being silently ignored.
The boss's existing C ring remains unchanged.

The fixed hostile pool may discard shots when full. The VM still advances, so
saturation neither stalls a pattern nor replays missed fire after a slot opens.

## Separate resource decoder

`bm_pack_decode(out, bytes, length)` in `pack.{h,c}` accepts the exact one-slot,
contiguous RSPK v1 layout of the Project's BulletML schema. It copies all arrays
and expression strings, appending NUL terminators, into caller-owned `bm_pack`.
Input bytes can be discarded; **do not move/copy/overwrite the pack while states
borrow its IR**. There is no allocator, filesystem, renderer or Host dependency.
Wire ordinals map explicitly to VM enums, not pointer/struct casts. Orientation
is checked authoring metadata, not retained by the existing VM IR.

Capacities shared across all patterns: 8 patterns, 64 bullets, 128 actions,
1,024 commands, 128 fires, 1,024 action refs, 2,048 parameter expressions and
16,384 string bytes including terminators. Per-ref/frame limits also apply.
Headers, exact length, tags/enums, references, counts, nonfinite numbers, embedded
NULs and arena overflow assert. Compiling this decoder with NDEBUG is refused.
Expression syntax, actual call-scope availability, arithmetic and execution
bounds remain the VM's guards when evaluated; this is not a second evaluator or
a security-audited arbitrary external file API. Keep the checked-in schema's
field/variant order frozen unless updating this decoder and compatibility tests.

Only generated bytes/header under `build.nosync/content/` enter either binary;
no GAMS, Node, runtime file fetch or JSON parser ships with the game. See
[content workflow](../../content/README.md). Existing boss C rings remain unchanged.

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
`test/pack.test.mjs` separately verifies full-schema decode, copied ownership,
the prior C fixture's first 500 ticks, malformed inputs/capacities and every
truncated prefix. `test/packed-game.test.mjs` compiles actual simulation + pack
adapter natively and as WASM, then changes spread/wait/speed in isolated source
copies to prove both targets consume authored edits without changing C.
