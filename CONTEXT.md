# example.game3 context

First milestone: the owner's gams3/plugins/game C/Sokol triangle, adapted into
an independent standalone experiment with native macOS/Metal and browser
WASM/WebGL2 targets. Gameplay and GAMS editor integration are not implemented.
No gams.json exists yet: this is not currently a loadable external GAMS Project.

Ownership:
- game/main.c and triangle-sapp.glsl: shared rendering/input logic.
- game/osx/: Sokol native application entry point and Metal implementation.
- game/web/: freestanding WASM entry point, libc/GL shims, tracked JS bridge,
  and standalone runner. Input crosses a scalar ABI in framebuffer pixels.
- game/vendor/: version-control-ready Sokol header snapshots, including official
  sokol_glue.h; embedded licenses preserved. Existing files are never downloaded
  again by ordinary builds.
- Makefile and test/: independent build and WASM/JS ABI verification.
- SOURCE.json: original source locations/revision and pre-adaptation hashes.
- game/**/*.glsl.h: generated C shader bindings intentionally kept with source
  for version control. No manual edits; generated with -f sokol for WebGL2/Metal.
- tools/: ignored downloaded compiler; not build output.
- build.nosync/: generated binaries, standalone web output and shader-include
  depfiles under shader-deps/.

Scope intentionally excludes asset loading, Project Units, copied game1/game2
code or content, release machinery, and new rendering libraries. The original
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

No source/distribution license approval or publication has been inferred.
This is an independent Git repository on main with origin
git@github.com:kkgams/example.game3.git, matching sibling examples.
Remote configuration does not create the hosted repository or authorize a push.
