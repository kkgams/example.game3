# GAMS authoring input provenance

The source reference is the read-only `/Users/gook/Repos/gams3` checkout,
remote `git@github.com:justgook/gamectl.git`, revision
`6fbc4f97e2894e8496c94be3999e31c3abc353e5`.
Original input hashes (before any adaptation):

| Original path | SHA-256 | Use |
| --- | --- | --- |
| `examples/demo/gams.json` | `f33cacf1b7e2535ec7e747ccda40f000fe3b04e5f96f282bcb040452d84ea28a` | Relevant BulletML/Nodegraph configuration reference only; full config not copied |
| `examples/demo/ng/compile-graph.lua` | `660a93647fd3e17331488b921ac176179ffd7db14c552e278450875f3d34bc32` | Copied unchanged to `content/gams/compile-graph.lua` |
| `examples/demo/ng/presets/bulletml-slots-json.lua` | `ebc5f3f01d12c16a147b45e0db0f36b8316e545f50b174304095d3d27631b6b5` | Adapted into the focused slots node: explicit content paths, dense-array/document checks and fail-loud errors |
| `examples/demo/CYBERPUNK/bullet.rspk.json` | `3082e5b2dac43a79263f0689a00b20211abde5144dbbaa9244801c4a3b63b9e3` | Copied unchanged as the resource schema |
| `examples/demo/bulletML-json/mini/aim.bulletml.json` | `d3dd37ebbfaf1f40b1561f1e0161f6b31014715d5482847a6e8b81ae3d74cb86` | Adapted example with explicit aim/speed on Fire, avoiding preview/schema default ambiguity |

`ranger-fan.bulletml.json` is newly authored from the existing game3 C fixture,
not copied from the demo's third-party named pattern collection. The graph,
respack-build node, compatibility entry and CLI launcher are authored for this
Project. Old decoder generation, director, unrelated plugins/Views, third-party
pattern corpora, fonts/images and Host helper source were not imported.

The referenced content files have no embedded license notice; no notice was
removed. This inventory does not establish new source/redistribution clearance.
Published Project Unit URLs are configured in root `gams.json`; their distributed
LICENSE/NOTICE metadata remains with Host-installed packages. Neither sibling
repositories nor original `SOURCE.json` historical hashes were changed.

The later `content/gams/pack.mjs`, `embed.mjs`, `game/bulletml/pack.{h,c}` and game
startup adapter are newly authored integration code. Wire facts were checked
against the existing schema, read-only `plugin.respack/src/encode.odin` and actual
published v0.2.0 component output through GAMS 2.0.6. Portable/GAMS baseline and
edited-pattern bytes matched. No Odin/generated decoder or sibling implementation
was copied. The old game3 C ranger fixture survives only as a test oracle for
500-tick parity, not as production data. Historical input hash entries above and
`SOURCE.json` remain unchanged.

The collision map JSON, `content/maps/build.mjs`, `game/map.{h,c}` and related
camera/simulation integration are newly authored in this experiment. The small
arena JSON transcribes game3's original procedural border/central block exactly;
the larger world is new placeholder collision geometry, not imported artwork or
an external map format. No new third-party assets, dependencies, sibling code or
historical input hash changes were introduced.
