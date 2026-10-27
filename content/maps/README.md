# Collision tilemaps — version 1

`world.tilemap.json` is the active playable map. `arena.tilemap.json` preserves the
original 16x10 arena for combat/VM/render regression fixtures.

```json
{
  "version": 1,
  "width": 8,
  "height": 8,
  "tileSize": 16,
  "origin": {"x": -64, "y": -64},
  "spawn": {"x": -24, "y": 0},
  "collision": [
    [1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1]
  ]
}
```

This minimal example is a complete valid map. Every field is required; unknown
fields are rejected.

- `0`: walkable; `1`: wall. Booleans, strings and other tile IDs are invalid.
- Authored row zero is **topmost**; each row reads left-to-right. The builder
  reverses rows once into bottom-to-top C storage (`collision[y*width+x]`).
- World coordinates are Y-up. `origin` is the bottom-left outer corner in world
  pixels. Cell `(x,y)` occupies origin + `(x*16,y*16)` to origin + `((x+1)*16,(y+1)*16)`.
  A cell center adds half a cell. `spawn` is a world-space player center, not a
  tile index. Origin/spawn coordinates must be finite and within +/-32768 pixels
  to avoid unusable float32 tile/body precision.
- Width and height are integers 8..64. This first version fixes tile size to 16;
  actor bodies/placeholder art are not yet a variable-tile-size system.
- Outer border is solid. Outside the map is always solid. All walkable cells
  must be cardinally connected, and at least eight inner-perimeter cells free
  for the current deterministic enemy/boss spawner. Diagonal-only connections
  do not qualify. The whole 10x10 spawn body must fit without wall overlap.

## Build and play

Edit the JSON in GAMS Code (Files' default JSON route) or a text editor:

```sh
make native web
make run
# or make play, then Reload the browser
```

Make validates inputs even with newer generated output. Missing/invalid source
fails, never silently reuses an old map. `build.mjs` emits ignored
`build.nosync/content/world-map.h`; the test arena header is generated separately.
Both targets compile the same data. No runtime file fetch, Host, JSON parser or
Node interpreter ships with the game. There is one compiled active world, not
runtime scene selection/hot reload. The generated header is not canonical source.

The renderer maps collision to temporary checker-floor/wall atlas IDs. The
collision array never stores graphic tile IDs. Its LUT dimensions follow map
size, not the viewport. A clamped camera follows the player; smaller maps center.
HUD/reward coordinates and clicks remain screen-fixed independently of the world.
Movement/projectiles/blades/LOS use swept candidate tiles; BFS uses bounded
workspaces sized for 64x64. Enemy spawns currently remain map-inner-perimeter,
not authored spawn objects or a director.

## Next layers, deliberately not implemented here

Use the same grid/world coordinate system for separate graphic tile layers and
placed-object records (pickups, landmarks, entrances, special places). Do not add
extra meanings to collision `0/1` or infer gameplay from decorative tiles. A visual
map editor, external editor import, object behavior, authored waves and balance
changes are separate increments. This format is Project-owned, not a new Host or
Unit contract; adding those layers needs explicit schema/runtime work.

## Verification

`make test` checks schema/geometry/orientation, deterministic generated output,
invalid and deleted inputs despite stale headers, original-arena combat parity,
large-map and maximum-size swept collision, BFS detours, free perimeter spawns,
guaranteed boss entry, camera clamps and smaller-map centering. A JSON-only wall
edit changes actual native/WASM movement with identical C. The actual WASM app
checks camera/HUD projection and reward pointer mapping; Chrome/WebGL2 scrolling
was visually checked, and `make smoke-native` draws real Metal frames.
Human balance/exploration playtesting and native GAMS GUI editing are not claimed.
