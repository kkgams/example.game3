# example.game3

A fresh **C + Sokol** experiment based on your `gams3/plugins/game` setup.
One shared triangle demo, two targets: **macOS Metal** and **browser WebGL2/WASM**.
Move the pointer vertically to rotate the triangle. No gameplay yet.

## Build and run

Prerequisites: Zig (web build tested with 0.16.0), Make, Python 3, curl, and
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

Browser controls: Pause/Resume and Reload. Missing WASM, unsupported WebGL2,
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

## Verification status

- Clean native/browser builds and `make test`: passed (9 Node tests).
  Dependency tests cover missing-file downloads, preserving existing edits,
  changed URLs, failed downloads and retries, plus GAMS release installation,
  staging cleanup and unsupported hosts. Real shader-compiler tests cover nested sources,
  incremental generation, includes, missing output/cache, invalid GLSL and clean.
  Real WASM is exercised with a mock GPU, including rotation uniform, resize,
  draw and cleanup. This is not browser pixel proof.
- `make native` and `make smoke-native`: passed with Zig 0.16.0 and the Xcode
  macOS 27.0 SDK. The smoke test initializes Metal, draws three frames and exits.
  Normal `make run` also stayed alive for five seconds before the test launch
  was deliberately stopped; native visual/input inspection remains manual.
- Native build uses Zig's `--sysroot` flag and rejects non-prototype C functions.
  The imported `init_with_gl()` was corrected to `init_with_gl(void)` to match
  Sokol's callback type; Zig ReleaseSafe previously trapped on the indirect call.
- Interactive browser/pixel verification: blocked because no browser was running
  for the browser harness. Open Chrome and retry browser verification.

## Boundaries and provenance

`game/` is self-contained; no absolute source path is used by builds.
`SOURCE.json` retains historical original inputs and hashes before adaptation,
not a dependency lock. Sokol's embedded zlib notices remain intact. Source licensing/redistribution approval
is not established; this is a local experiment, not a release.

The prototype WebGL bridge and freestanding allocator have limitations; see
`CONTEXT.md`. Start here with verified rendering before expanding gameplay.
GAMS editor integration is a later milestone: no `gams.json`, downloaded Units,
art pack or release workflow has been added. The independent repository uses
`main` and origin `git@github.com:kkgams/example.game3.git`, matching sibling
examples. No hosted repository creation or push has been performed.
Previous experiments and the source gams3 checkout remain unchanged.
