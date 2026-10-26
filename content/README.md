# Authored content and GAMS tooling

`content/` is the canonical Project-owned authoring tree. The name is conventional,
not a Host requirement. Paths are Project-root-relative.

```text
content/bulletml/             canonical JSON pattern assets
content/gams/graphs/          editable packaging graph
content/gams/nodes/           Project-owned Lua node scripts
content/gams/schema/          BulletML RSPK wire schema
content/gams/compile-graph.lua imported Project graph compiler
content/gams/build.mjs        optional real GAMS CLI launcher
content/gams/pack.mjs         portable packaging adapter for ordinary builds/CI
content/gams/embed.mjs        generated C byte-array header writer
ng/compile-graph.lua          released View's required compatibility forwarder
build.nosync/content/         generated pack/header/Lua, never canonical or tracked
```

No Host widgets, released View source, sibling source tree or generated Odin
code is vendored here. See [provenance](PROVENANCE.md).

## Author and play

Reopen this Project in GAMS to register its configured published Units. Reloading
only an old View does not reread `gams.json`. The three-pane layout opens Content
Files, BulletML preview and Nodegraph. Existing installed Host launch:

```sh
GAMS_APP_CWD="$PWD" tools/gams.app/Contents/MacOS/gams
```

The config retains the existing theme/services/Files/Code Units and adds Lua and
respack v0.2.0, BulletML View v0.2.0 and Nodegraph/internal-node editor v0.1.0.
GAMS owns installation/cache. New cache files are ignored; historical already
tracked cache files remain untouched, not canonical editable source.

1. Edit `bulletml/ranger-fan.bulletml.json` using BulletML's Edit action, save,
   reload/reset its preview. The preview is JS, not the game's C VM; use the
   supported C expression/host subset below.
2. Run `gams/graphs/bulletml.ng.json` in Nodegraph, or `make content` using the
   installed Host and cached Units. This writes `build.nosync/content/bulletml.rspk`.
3. Run `make native web`; restart native or Reload the browser. Both now consume
   the authored pack, without C edits. Saving JSON and rebuilding also works
   without explicitly running GAMS's pack step.

The baseline fan has offsets -10/0/+10, waits 30/60, and speed 52/60 pixels per
60 Hz VM frame. The smaller aim example is packed second; ranger must appear
exactly once at index zero. Filename routing sends these two asset basenames to
BulletML and `bulletml.ng.json` to Nodegraph; other JSON opens in Code. Files
matches basename/final extension, not compound-extension globs. New pattern names
can use BulletML's Open dialog or an explicit basename route.

## Packaging and runtime boundary

The five-node graph packages explicit ordered source paths -> raw slots JSON ->
respack. It is not yet a palette of BulletML command-generating nodes. Its Lua
scripts preserve raw JSON, validate required inputs/output paths and propagate
errors. `ng/compile-graph.lua` forwards to the single content-owned compiler
because the released View hard-codes that entry path.

Ordinary Make builds/Pages do not require GAMS. The Node-only adapter encodes the
same schema/ordered assets into identical RSPK bytes when missing/stale. It is
strictly this registered packaging contract, not a Lua interpreter. Unsupported
topology, customized node scripts, output paths or reordered ranger binding fail
rather than silently interpreting only part of a custom graph. Script hashes
are local semantic-compatibility guards, not dependency locks/download integrity
checks. Changing node semantics requires updating/testing the portable adapter.
Value-port labels/coordinates are cosmetic, including empty labels saved by GAMS.

Make preserves a newer GAMS-built pack, incrementally regenerates its byte-array
header and recompiles both targets. Input validation also runs on no-op builds:
missing/malformed required JSON must not disappear from wildcard dependencies
and leave an apparently successful stale build. Pack/header/cache are ignored
build output; no binary is checked in or fetched from a sibling checkout.

`game/bulletml/pack.c` decodes into bounded, owned stationary arrays and copied
NUL-terminated strings. `game/patterns.c` initializes that content once and binds
the ranger; it no longer duplicates the pattern. The independent VM is unchanged.
The frozen wire contract is RSPK v1, one contiguous slot, a vector of documents;
little-endian u32 counts/enums, one-based u16 oneof tags, f64 numbers, u32-length
UTF-8 strings and u8 booleans. Field/variant order is part of the ABI. Changing
that schema requires decoder and compatibility-test review, not just regeneration.
Odin metadata in the imported schema is unused; no old decoder was imported.

The game currently supports straight child shots and repeat/action/fire/wait
commands only. Startup rejects unsupported ranger world commands/child actions;
the separate decoder/VM support the broader schema for later hosts. Expressions
use the existing VM grammar/guards, not arbitrary JS/Lua evaluation. Orientation
is checked metadata, not a new VM feature. Rebuild/restart replaces content;
there is no runtime pack hot reload or GAMS/Node/filesystem requirement.
Balance/wave data, boss migration and the director remain separate work.

## Verification

```sh
make test                 # ordinary suite, no installed Host required
make native
make smoke-native
make content              # optional actual GAMS compilation, then header embedding
GAMS_HOST_BIN=/Applications/GAMS.app/Contents/MacOS/gams make content
GAMS_MODULES_DIR=/absolute/cache make content
GAMS_INTEGRATION=1 node --test test/packed-game.test.mjs
GAMS_PACK_FIXTURE=/absolute/independent-gams.rspk node --test test/pack-build.test.mjs
```

Verified with installed GAMS 2.0.6 and published FS/Lua/respack components:
344-byte/two-pattern baseline; exact portable parity; isolated changed spread,
delay and speed -> real GAMS packs -> both actual native/WASM simulations without
C changes. Native/WASM clock/counts match exactly; existing float32 velocity
normalization differs by at most a few ulps, not gameplay-scale differences.
Decoder checks include original 500-tick trace parity, every command, ownership,
capacity/reference/tag/value failures and every truncated prefix. Make tests
cover incremental edits, newer-pack preservation and stale-output failure guards.
Chrome/WebGL2 showed the decoded ranger warning and live fan without errors.

The native three-pane GAMS GUI layout/edit/save/Run interactions still need owner
verification; CLI/preview-engine evidence is not a blanket GUI claim. Actual
hosted Pages execution/publication and human balance playtesting remain unverified.
