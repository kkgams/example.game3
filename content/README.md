# Authored content and GAMS tooling

`content/` is the canonical Project-owned authoring tree. Pattern assets and the
scripts that build them are separated so gameplay data is not mixed with UI Units.
No sibling source, Host widgets or released View code is vendored into this tree.

```text
content/
  bulletml/                 JSON BulletML source assets
    ranger-fan.bulletml.json current ranger fixture, expressed as JSON
    aim.bulletml.json        small demo-derived aimed-shot example
  gams/
    graphs/bulletml.ng.json  editable JSON -> slots -> respack pipeline
    nodes/                  Project-owned Lua node scripts
    schema/bulletml.rspk.json resource-pack schema
    compile-graph.lua        imported Project graph compiler
    build.mjs               optional native GAMS CLI launcher
ng/compile-graph.lua         compatibility forwarder, not another compiler copy
build.nosync/content/        generated packs/Lua; ignored, never authored here
```

The `content` name is conventional, not a GAMS requirement. Configured paths are
Project-root-relative. Renaming it requires updating `gams.json`, graph paths,
node scripts, the compiler forwarder and CLI launcher together.

## Open in GAMS

Reopen this Project in GAMS, rather than merely reloading an already-open View.
The Host must reread the updated `gams.json` to install/register the added Units.
The initial three-pane layout is Content Files, BulletML preview and Nodegraph.
A terminal launch with the existing installed Host is:

```sh
GAMS_APP_CWD="$PWD" tools/gams.app/Contents/MacOS/gams
```

`gams.json` retains the existing theme, shell services and Files/Code Units,
adding only published release sources:

- `plugin.lua` and `plugin.respack`: v0.2.0 direct WASM.
- `view.bullet`: v0.2.0 ZIP.
- `view.ng` and its internal `view.ng-node`: v0.1.0 ZIP, the published versions
  available when this setup was prepared. Unpublished sibling candidates are
  not silently substituted.

GAMS installs missing Units through its normal `gams_modules` cache and preserves
their notices. No new installer, Unit source copy or automatic dependency upgrade
is added. New cache contents are ignored. Some older cache files were already
tracked by an earlier checkpoint; they remain untouched, not canonical sources.

### Pattern preview/editing

The default asset is `content/bulletml/ranger-fan.bulletml.json`. Use the BulletML
View's Edit action for JSON editing, then save/reload/reset the preview. The JSON
matches the existing C ranger fixture: three aim offsets -10/0/+10, wait 30 then
60, speed 52/60 pixels per 60 Hz frame. `aim.bulletml.json` is the smaller example.
The preview is the released View's JS engine, not the game's C VM; their coverage
and supported commands are not assumed identical.

Files routes these two basenames to BulletML and `bulletml.ng.json` to Nodegraph;
other JSON opens in Code. The current Files Unit matches basename or final
extension, not compound-extension globs. For a newly named pattern, use BulletML's
Open dialog or add an explicit basename route. Do not invent a `.bulletml.json`
route that that Unit does not support.

### Nodegraph pipeline

Open `content/gams/graphs/bulletml.ng.json` and press Run in Nodegraph. It packs
both patterns in a deterministic, explicit order (ranger first). The value nodes
hold source/schema/output paths; the two registered code-node presets assemble
raw slots JSON and build the pack. This graph is a **packaging pipeline**, not
yet a palette of BulletML command-generating nodes.

Output is `build.nosync/content/bulletml.rspk`: RSPK v1, one slot containing a
vector of BulletML documents. The builder creates missing output directories,
rejects paths outside ignored build output, propagates errors, and preserves raw
pattern JSON through slot assembly. It generates **no Odin or C decoder**. The
imported schema retains its original Odin metadata, unused by this build.

The released Nodegraph View hard-codes `ng/compile-graph.lua`; the tiny root
forwarder loads `content/gams/compile-graph.lua` into the same Lua environment.
This avoids modifying or copying the View/Host just to relocate Project scripts.
See [provenance](PROVENANCE.md) for the compiler/schema/example origin.

## Optional CLI build

After opening the Project once so its configured WASM Units are installed:

```sh
make content
# Or use another installed Host / shared module cache:
GAMS_HOST_BIN=/Applications/GAMS.app/Contents/MacOS/gams make content
GAMS_MODULES_DIR=/absolute/path/to/gams_modules make content
```

The launcher reads the same graph, invokes the same compiler forwarder through
`lua/lua::run`, runs its generated program, and verifies the resulting RSPK header,
slot bounds and non-empty pattern vector. Generated Lua and Wasmtime cache stay
under `build.nosync/`. It resolves configured direct-file component URLs to their
documented Host cache names; it does not download Units or use a sibling checkout.
A missing Host/component fails with setup instructions.

## Current boundary and verification

**The game still uses `game/patterns.c`.** Editing JSON or building this pack does
not change gameplay yet. Next slice: decode this authored pack into the independent
C VM's immutable IR and replace the C fixture for both native and web. A C loader,
Pages content build, enemy balance/wave data and director integration are not part
of this authoring setup. Ordinary `make test`, native/web builds and Pages remain
independent from an installed GAMS Host.

Validation performed with the installed GAMS 2.0.6 Host CLI and published FS,
Lua/respack components: compiler-forwarder -> generated Lua -> two-pattern pack
(344 bytes), including repeat builds. Both source assets also ran for 180 frames
in the released BulletML View engine (six fan shots / two aimed shots).
The published Views' absolute imports were also checked against the v2.0.6
Host source tree. Node tests cover config/data/graph/cache/header contracts
without network/GAMS.
The native three-pane GUI layout, interactive preview editing/save and Nodegraph
Run button still need owner verification after reopening the Project; CLI success
is not a blanket GUI claim.
