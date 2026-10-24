# example.game3 context

Started from the owner's gams3/plugins/game C/Sokol triangle, adapted into an
independent experiment with native macOS/Metal and browser WASM/WebGL2 targets.
Current milestone: a first survivor combat loop in a fixed tilemap arena, using
shared tilemap/sprite pipelines and procedural textures. Movement, tile collision,
one chasing enemy type, automatic aimed shots, contact damage, health/kills HUD,
death and R retry are implemented. XP, upgrades and authored scenarios are not. A minimal gams.json provides
Files/Code editing and opens in GAMS (owner-verified); the game renderer is not
embedded in a Host View.

Planned game direction: survivor-style free movement, automatic attacks and XP
upgrades, authored encounters and a final boss, with title/game/result/credits.
Decoder and director resources are created using GAMS and are explicitly deferred
to a separate task; do not port the old generated decoders or director now.

Ownership:
- game/main.c: procedural textures, shared keyboard state and simulation/render
  integration; rendered tiles come from the collision map source.
- game/sim.{h,c}: platform-independent 120 Hz movement and swept tile collision;
  normalized diagonal movement, 64 pixels/second, 0.25-second frame-time cap.
  Also owns bounded enemy/projectile pools, deterministic perimeter spawns,
  BFS chase routing, nearest-visible auto-fire, swept projectile hits, damage
  cooldowns, kills and frozen death state. sim_init fully resets a run.
- game/font.h: small authored 5x7 uppercase/digit HUD glyphs, rasterized into
  the procedural atlas; no downloaded font or new rendering dependency.
- game/app.h: shared app callbacks and eight-binding scalar browser key ABI.
  App frame accepts elapsed seconds. Native uses Sokol duration; browser uses
  requestAnimationFrame timestamps, resetting its clock/input on focus loss,
  visibility changes and pause. WASD/arrows remain separate held bindings.
  Browser retry() translates to the same R key event as native; retry applies
  only to dead runs and clears held movement and facing.
- game/render/: C renderer API, instanced tilemap/sprite pipelines and adapted
  shaders; README.md documents the contract, PROVENANCE.md records original
  inputs. No external artwork or packed resources.
- game/triangle-sapp.glsl: retained shader-generation fixture, no longer drawn.
- gams.json and gams_modules/: minimal Project configuration and installed Units.
- game/osx/: Sokol native application entry point and Metal implementation.
- game/web/: freestanding WASM entry point, libc/GL shims, tracked JS bridge,
  and standalone runner. Movement input crosses the scalar key/release ABI;
  frame time is supplied in seconds. Legacy pointer/layout exports are retained
  but unused by player movement.
- game/vendor/: version-control-ready Sokol header snapshots, including official
  sokol_glue.h; embedded licenses preserved. Existing files are never downloaded
  again by ordinary builds.
- Makefile and test/: independent build and WASM/JS ABI verification.
- SOURCE.json: original source locations/revision and pre-adaptation hashes.
- game/**/*.glsl.h: generated C shader bindings intentionally kept with source
  for version control. No manual edits; generated with -f sokol for WebGL2/Metal.
- tools/: ignored downloaded compiler and optional GAMS Host at gams.app;
  not build output.
- build.nosync/: generated binaries, standalone web output and shader-include
  depfiles under shader-deps/.

Renderer scope excludes asset loading, decoder/director generation, copied
game1/game2 code or content, release machinery, and new rendering libraries. The original
absolute /game/clear-color.rgb dependency is removed for this triangle milestone.
The JS bridge is taken from gams3's tracked examples/demo/game/web source;
the original plugins/game Makefile's cmd/browser/util bridge path is absent.

The legacy web shims/bridge are prototype infrastructure, not a general-purpose
runtime: bump allocation has no reclamation (reload uses fresh WASM memory),
and several GL operations are incomplete. Validate/implement each new graphics
capability before gameplay uses it. WASM assertions now trap instead of disappearing.
Native launch verification: Zig 0.16.0 with Xcode macOS 27.0 SDK builds and
passes make smoke-native (three real Metal frames followed by normal shutdown).
The native SDK uses the Zig driver --sysroot option. Callback definitions must
have explicit prototypes: init_with_gl(void) matches Sokol's void (*)(void);
the old unspecified-argument definition trapped in ReleaseSafe's function-type
check. Native compilation enforces -Werror=strict-prototypes. A recipe regression
runs in make test; the GPU smoke test is separate because it needs a macOS GUI.

Current renderer validation with Zig 0.17.0: make native, make smoke-native,
web build and make test pass; Chrome/WebGL2 fixture verified visually.
The native recipe uses -F/System/Library/Frameworks alongside --sysroot:
Zig prefixes framework search paths with the SDK itself. The earlier absolute
SDK-prefixed -F path was prefixed twice under Zig 0.17 and failed framework
lookup; a recipe regression now guards against that duplication. The native
smoke test draws three Metal frames and shuts down successfully.

Dependency policy: the files themselves are the snapshot. Each Sokol header
and the host's shader compiler is an ordinary Make target with no prerequisites.
Only missing files download, by default from upstream master. Existing bytes,
including local changes, are untouched; no lock, checksum verification, downloader
script or update targets exist. SOKOL_URL/SHDC_URL may override download sources,
but changing a URL does not refresh existing files. Remove desired files to fetch
again, then review and test the new snapshot; fetching one header may mix upstream
versions. Downloads use temporary files so failed requests leave no partial target.
Generated headers are adjacent to shader sources; normal builds handle regeneration
and include dependencies. make clean removes build metadata as well as binaries,
preserving tools and headers; the next build restores missing shader depfiles.

Optional Host download: make tools/gams.app queries the latest published release
of kkgams/gams, selects its macOS Apple Silicon ZIP and installs GAMS.app as
tools/gams.app. This ordinary directory target has no prerequisites: an existing
app stays untouched. Download/extraction staging lives under build.nosync/ and is
removed on success or failure. The target rejects unsupported hosts and malformed
releases/archives. It does not launch the app or integrate this experiment with
the Host, and is not required by all/deps or standalone builds. make clean retains
it; remove the app explicitly to fetch the latest release again.

No source/distribution license approval or publication has been inferred.
This is an independent Git repository on main with origin
git@github.com:kkgams/example.game3.git, matching sibling examples.
Remote configuration does not create the hosted repository or authorize a push.
