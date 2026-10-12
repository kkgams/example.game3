# example.game3

Read README.md and CONTEXT.md before changing this experiment.
Owns the standalone game experiment; not the GAMS Host or shared Units.
Keep native and browser builds on the same game/main.c and shader contract.
Do not edit sibling experiments or the original gams3 checkout.
Preserve imported Sokol license notices and SOURCE.json original input hashes.
Binaries and shader include depfiles belong in ignored build.nosync/.
Downloaded shader tools belong in ignored tools/. Exception: generated *.glsl.h headers
are intentionally version-controlled next to their authored *.glsl sources.
Sokol headers themselves are the version-controlled snapshot. Dependency file
targets download only missing files; do not add a lock/checksum/update layer.
To refresh, remove the desired dependency files, then rebuild and review the diff.
Preserve embedded notices and verify both targets. Fail loudly on broken wiring.
Run make test and make native; report environmental blockers separately.
No remote creation, publication, commits or pushes without owner authorization.
