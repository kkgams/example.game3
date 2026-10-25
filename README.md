# example.game3

A fresh **C + Sokol** experiment based on your `gams3/plugins/game` setup.
Shared tilemap and instanced-sprite pipelines, two targets: **macOS Metal** and
**browser WebGL2/WASM**. Move a placeholder player around a fixed arena using
**WASD or arrow keys**. Attacks fire automatically at nearby visible enemies.
Chasers, runners and brutes hunt around the solid outer walls and central block;
contact costs health. Survive three 30-second waves, then defeat the final boss. Collect XP gems to fill the XP bar. Level-up pauses the world;
press **1–3** for shot damage, shot speed or movement speed; **4** unlocks
orbiting blades. Once unlocked, **4–6** upgrade blade damage, count or spin.
The HUD shows time remaining, wave, health, kills, level and XP, plus boss health
during the duel. After winning or dying, press **R** to restart.
Assets, the map and spawn timing remain procedural/hand-authored.

The minimal `gams.json` Project opens in GAMS (owner-verified). The rendering
fixture still runs standalone, not embedded in a GAMS View.

## Build and run

Prerequisites: Zig (native/web builds tested with 0.17.0), Make, Python 3, curl, and
Node.js 22+ for tests. First use of missing dependencies requires HTTPS access.
Native additionally requires macOS with Xcode SDK access and its license accepted
by you. No npm dependencies, Emscripten, Host or sibling builds.

```sh
cd example.game3
make web         # build standalone output in build.nosync/web/
make play        # serve http://127.0.0.1:8816 (PORT=… overrides)
make native      # build build.nosync/triangle using the Xcode macOS SDK
make run         # build and launch the native window
make             # build both targets
make test        # dependency, shader pipeline, native recipe and WASM ABI tests
make smoke-native # draw three real Metal frames, then exit (macOS GUI session)
make clean       # remove generated output
```

Browser controls: WASD/arrows while the canvas has focus (click it to refocus),
plus Pause/Resume and Reload. Select a reward card by clicking it or using its
number key (1–6; 4 unlocks blades).
R restarts after either win or loss; Reload resets the whole run. Pausing, losing focus,
hiding the tab or using shortcut modifiers releases held movement keys and resets
the browser frame clock (including macOS Command combinations with missing keyup).
Missing WASM, unsupported WebGL2,
Sokol errors and context loss appear explicitly in the status bar.
Reload cleans up GPU resources and instantiates fresh WASM memory.

## Optional GAMS Host

```sh
make tools/gams.app  # download the latest kkgams/gams release only if absent
```

Requires macOS Apple Silicon and `unzip`. Fetches release metadata from GitHub,
extracts the macOS ARM64 app and installs it at `tools/gams.app`. Existing apps
are untouched; remove that directory to download a newer release. Temporary
archives/extraction stay under `build.nosync/` and are cleaned on success/failure.
`make clean` preserves the installed app. No app launch or Host integration is
performed, and standalone builds do not require this target.

## Dependencies and shaders

```sh
make deps        # download only missing Sokol headers/compiler
make sokol       # game/vendor/*.h — intended for version control
make sokol-shdc  # tools/sokol-shdc/<host>/sokol-shdc — ignored
make shaders     # *.glsl → adjacent *.glsl.h — intended for version control
```

The files themselves are the snapshot: no lock file, checksum layer, dependency
script or update targets. Each required header and compiler binary is a normal
Make file target with no prerequisites. Existing files stay untouched, even after
editing the Makefile or changing download URLs. Missing files download from
upstream `master`; temporary files prevent failed downloads leaving partial targets.
Builds fetch missing dependencies automatically.

To refresh Sokol, remove the four headers and run `make sokol`. To refresh the
compiler, remove its binary and run `make sokol-shdc`. Then regenerate/build/test
and review the header diffs before committing. Fetching only one missing header
can mix upstream versions; a new upstream snapshot is not guaranteed compatible.
`SOKOL_URL` and `SHDC_URL` can select other upstream URLs when downloading.
Supported shader-tool hosts: macOS/Linux, ARM64/x86-64; native builds remain macOS.

Shaders are discovered recursively under `game/`. The compiler runs with
`-f sokol -l glsl300es:metal_macos`, embedding WebGL2 and Metal shader sources,
uniform structs and binding constants in C headers. `make native`, `make web`
and `make run` regenerate headers when shader source, included files, compiler,
or generation recipe changes. Unchanged shaders are skipped. Include
depfiles live in `build.nosync/shader-deps/`; missing depfiles are regenerated.
Invalid shaders stop the build; no stale-header fallback. Generated headers
omit machine-specific command lines to keep output reproducible.

Keep `game/vendor/*.h`, `game/**/*.glsl` and `game/**/*.glsl.h` in version control. Keep `tools/` and `build.nosync/` ignored. `make clean` removes
build output and shader depfiles, preserving downloaded tools and generated shader
headers. The next build regenerates missing depfiles to restore include tracking.

## Movement

`game/sim.{h,c}` is platform/rendering independent. Both targets run the same
120 Hz fixed-step simulation at 64 world pixels/second, with normalized diagonals
and opposing inputs cancelling. Frame time accumulates; each call accepts at
most 0.25 seconds to bound catch-up after stalls. Collision sweeps a 10x10 player
AABB against solid 16x16 tiles, resolving X then Y for stable wall sliding.
Collision and rendered tile IDs share one hand-authored map source.

Native frames supply Sokol elapsed seconds. Browser `frame(elapsed)` receives
requestAnimationFrame elapsed seconds; `key(index,down)` uses the eight physical
bindings in `game/app.h`, and `release_keys()` clears held input. WASD and arrow
bindings are tracked independently. Simulation state is separate from rendering;
there is no asset decoder or director in this milestone.

## Timed run

The run clock counts down **90 seconds of active play**, excluding level-up
choices and browser pause time. Three hard-coded waves introduce enemy types:

| Time elapsed | Enemies | Spawn interval |
| --- | --- | --- |
| 0–30 seconds | Red square chasers | 0.75 seconds (first spawn at 1 second) |
| 30–60 seconds | Chasers + lime triangle runners | 0.625 seconds |
| 60–90 seconds | Chasers + runners + blue hollow-square brutes | 0.5 seconds |
| 90 seconds onward | Gold diamond boss, turning orange at half health | No ordinary spawns |

Chasers have 2 HP and move at 28 pixels/second; runners have 1 HP and move at 44;
brutes have 6 HP, move at 18 and drop 5 XP. All use cardinal BFS routing around
the central block and a common 10x10 collision body. Their sprite silhouettes
and colors differ. Spawn points are deterministic, unoccupied inner perimeter
tile centers. Full enemy pools/occupied spawn sites skip that ordinary attempt.

Pools are bounded: 16 enemies, 32 player shots, 32 hostile shots and 64 XP gems.
Hostile saturation cannot starve the player's weapon.

The player automatically targets the nearest visible enemy within 112 pixels,
initially firing every 0.5 seconds. Shots travel at 160 pixels/second, expire after two
seconds, stop at walls and hit only the first enemy on their swept path. Each
kill increments the HUD count. The player has three HP and
0.75 seconds of contact-damage invulnerability, shown by blinking. Death freezes
the simulation; R resets the whole run, including progression and input.

At zero on the countdown, ordinary enemies and all in-flight shots are cleared
for a guaranteed boss duel, even if the enemy pool was full. Player health,
XP and upgrades are retained, without a free heal. The boss has **120 HP**, moves
at 24 pixels/second and fires eight-direction rings every two seconds. At half
health it turns orange and fires every second. Pink hostile shots move at 52
pixels/second, expire after two seconds, stop at walls, and share the same damage
invulnerability window as contact hits.

The timer reaching zero is not victory: **kill the boss to win**. Victory clears
remaining threats, freezes the clock/world, and displays YOU WIN / R RETRY.
Boss death wins its simulation tick before hostile/contact damage. Loss also
freezes the run, and R fully restarts either result.

These are hard-coded encounters, not a scenario format or balance promise.
BulletML, further weapons, GAMS-authored scenarios and title/credits remain
deferred; the boss ring is a small authored C pattern, not a BulletML runner. The HUD uses a small authored bitmap font in the same atlas,
so native and browser show the same result/retry prompt without new libraries.

## XP and upgrades

XP rewards use authored threat tiers, not a linear HP multiplier: chasers drop
**1 XP**, fast runners **2 XP**, and brutes **5 XP** despite having only three
times a chaser's health. Rewards depend on enemy kind, not remaining HP or overkill.
The final boss ends the run instead of dropping XP.

Gems show their stored value: **purple = 1 XP**, **blue = 2–4 XP**,
**gold = 5+ XP**. Merged gems update color to match their total value.
Gems within 32 pixels move toward
the player at 96 pixels/second, with wall-aware line of sight; distant or blocked
gems wait in place. Collection grants their value exactly once. If all 64 gem
slots are occupied, new XP merges into the nearest existing gem rather than being
lost. A level starts at 3 XP; each next threshold costs 2 more (3, 5, 7, ...).

Reaching the threshold pauses movement, enemies, shots, pickups, spawning and all
simulation timers. Rewards appear as individual numbered cards: a 2x2 grid
before unlocking blades, then a 3x2 grid. Each card separates its category,
upgrade and effect; unavailable capped cards are dimmed and marked MAX.
Click a card or press its top-row number to choose:

- **1 Shot damage:** +1 hit damage, also applied to shots already in flight.
- **2 Shot speed:** subtract 6 fixed ticks (0.05 seconds) from the fire interval,
  down to 12 ticks (0.1 seconds). At the cap it shows MAX and consumes no choice.
- **3 Movement speed:** +8 world pixels/second, retaining diagonal normalization
  and swept wall collision.
- **4 Unlock blades:** gain two orbiting blades. After unlocking, this key instead
  gives **+1 blade damage**. Shot and blade damage are independent.
- **5 Blade count:** +1 blade, capped at four; unavailable until unlocked.
- **6 Blade spin:** faster rotation, capped at three times the starting speed;
  unavailable until unlocked. Capped choices show MAX and consume no XP.

An accepted choice consumes its threshold, increments the level and resumes with
no accumulated pause time or held movement. Excess XP is preserved; if enough
remains for another level, the next choice stays open and requires another fresh
key press. Damage and movement upgrades stack; this is prototype tuning, not a
finished balance model. Retry clears gems, XP, levels and all stat upgrades.

## Orbiting blades

Blades are an optional second automatic weapon, not a replacement for shots.
They start at **1 damage**, **two blades**, **22-pixel radius** and **one revolution
every two seconds**. Blades are evenly spaced and follow player movement. Each
spin upgrade adds half the starting speed, down to a two-thirds-second orbit.
Count and spin caps leave damage/movement/shot upgrades available.

Swept blade hits can cleave multiple enemies. Each enemy has a shared **0.25-second
blade-hit cooldown**, preventing per-frame or simultaneous multi-blade damage;
shots ignore this cooldown. Walls clip the orbit: occluded blades are hidden and
cannot damage through walls. Blades damage enemies, **not hostile projectiles**.
They do not consume projectile slots, even when those pools are full.

Both weapons use the same kill/XP/victory handling, including boss-kill priority
over hostile/contact damage. Boss entry retains the weapon. Choices, death and
victory freeze the orbit; retry resets unlocks, stats, phase and hit cooldowns.
Positions are owned by the fixed-step simulation and shared with rendering via
sim_blade_position; a 32-point interpolated circle avoids host sin/cos dependencies.

## Rendering and verification

`game/render/render2d.{h,c}` owns the tilemap and sprite pipelines; authored
shaders and generated C bindings live alongside it. See
[the renderer contract](game/render/README.md) and
[import provenance](game/render/PROVENANCE.md). No decoder, director, resource
pack, BulletML or gameplay systems were imported. The original triangle shader
is retained as a shader-generation test fixture, not drawn by the app. Output
filenames (`triangle`, `triangle.wasm`) are retained for runner compatibility.

- `make test`: passed (15 Node tests). Includes standalone C movement/collision
  assertions (movement, fixed-step timing, collision, spawning, chase paths,
  targeting/line of sight, swept projectile hits, pool saturation, contact damage,
  death/reset, XP drops/attraction, blocked pickups, pool merging, exact collection,
  level-up freeze/overflow, all upgrades and invalid inputs), browser runner
  key/focus/pause/clock/choice/retry tests, and real WASM submission/input through
  a mock GPU, including XP/level-up, choice/resume, death and retry.
  Timed-run tests cover exact wave boundaries, pause-clock behavior, type stats,
  guaranteed boss entry from a full pool, both boss phases, hostile sweeps/pool
  saturation, victory/loss, full reset and a full timeline-to-victory simulation.
  Reward tests verify each enemy tier, overkill independence, exact collection,
  five-XP pool merging, surplus/queued choices and gem-color tier boundaries.
  Blade tests cover unlock/upgrade guards and caps, independent damage, orbit
  radius/spacing, moving origins, 30/60/144 Hz timing, pause/result freeze,
  swept hits, cleaving, cooldowns, walls, spawn-slot reuse, full projectile pools,
  tiered XP, boss entry/kill and full reset. The real WASM app checks XP-to-menu,
  4-to-unlock/4–6-to-upgrade mapping, animation, capped menus, melee kill-to-gem
  submission, blade boss victory and retry. Reward-card tests check all label
  and body bounds at 320x240, portrait, ultrawide and tiny framebuffer sizes;
  keyboard/click parity, gap/outside/MAX rejection, and native logical-point vs
  HiDPI framebuffer coordinates. Browser runner tests cover CSS-relative pointer
  coordinates and ignore paused/hidden/modified/secondary clicks.
  Real enemy-kill-to-render checks ensure chasers produce purple, runners blue,
  and brutes gold without requiring pool-overflow merges.
  That last test uses invulnerability to isolate flow from balance, not to claim
  that an automated player or a human has beaten the new encounter tuning.
  `test/scene.c` builds a separate test-only WASM to exercise real app rendering
  of each wave, boss health/shots, victory freeze and retry. Staging hooks are
  absent from the production WASM; all fixture artifacts stay in build.nosync/.
- Chrome/WebGL2: verified arena/player, enemy and projectile rendering, HUD,
  automatic kills, purple gems, XP bar, paused choice panel, damage selection,
  level/XP update, death/result and R retry. A staged, test-only Chrome fixture
  also verified the boss silhouette, ring shots, health bar and victory screen.
  Blade unlock/upgrade menus and the orbiting sword silhouettes were also
  visually verified in a separate staged Chrome fixture. The new four/six-card
  layouts and a real pointer unlock were checked at desktop and 375x667 @2x.
  `test/card-pixels.mjs` is a headed WebGL pixel regression, separate from the
  Node suite: stage the six-card app fixture at that portrait size and call
  assertCardPixelSeams(canvas, wasmExports.frame). Its 21 background samples
  reproduced atlas-edge transparency before the shader fix and pass afterward.
  Full human weapon
  balance playtesting remains outstanding. Earlier checks verified obstacle
  sliding, outer-wall collision, focus release, sprite flips, opacity and tint.
- Zig 0.17.0: `make native`, `make smoke-native` and `make test` pass.
  The native recipe uses `--sysroot "$SDK" -F/System/Library/Frameworks`:
  Zig prefixes the framework path with the SDK itself. A recipe regression
  rejects adding the SDK prefix twice. The smoke test draws three Metal frames
  and exits; native visual inspection remains manual.
- Earlier triangle milestone: `make native` and `make smoke-native` passed with
  Zig 0.16.0 / Xcode macOS 27.0 SDK. Native compilation enforces explicit C
  prototypes, including `init_with_gl(void)`.

## Boundaries and provenance

`game/` is self-contained; no absolute source path is used by builds.
`SOURCE.json` retains historical original inputs and hashes before adaptation,
not a dependency lock. Sokol's embedded zlib notices remain intact. Source licensing/redistribution approval
is not established; this is a local experiment, not a release.

The prototype WebGL bridge and freestanding allocator have limitations; see
`CONTEXT.md`. Start here with verified rendering before expanding gameplay.
GAMS game integration is a later milestone. The minimal `gams.json` and installed
Units provide Files/Code editing; there is no embedded game View, art pack or
release workflow. Decoder/director generation through GAMS is a separate task. The independent repository uses
`main` and origin `git@github.com:kkgams/example.game3.git`, matching sibling
examples. No hosted repository creation or push has been performed.
Previous experiments and the source gams3 checkout remain unchanged.
