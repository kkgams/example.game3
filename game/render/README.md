# Tilemap and sprite pipelines

This is rendering infrastructure, not a game/world, asset decoder or director.
`render2d.h` is the shared C API for Metal and WebGL2. Shaders are adapted from
the original demo; see PROVENANCE.md. Never edit generated `.glsl.h` files.

## Lifetime and submission

1. After `sg_setup`, create a 2D atlas and an RGBA8 tile lookup image.
2. Pass a zeroed `r2_renderer` and those images to `r2_init`.
3. Begin a swapchain-compatible render pass; clear depth to 1.
4. Submit tilemaps, then sprites, at most one call per batch per frame.
5. End the pass and `sg_commit`.
6. Call `r2_destroy` before destroying borrowed images and before `sg_shutdown`.

The renderer owns its shaders, pipelines, shared indexed quad, two streaming
instance buffers, two texture views and nearest/clamped sampler. It does not own
images. No allocations occur in draw calls. Empty batches are no-ops; invalid
counts, missing resources and invalid flip flags assert instead of truncating.
Capacities: 64 tilemap instances and 8192 sprite instances. They are limits, not
a promised performance budget. One atlas/LUT pair per renderer; no sorting or
multi-atlas batching is hidden inside the API.

Both pipelines use straight-alpha blending (RGB: SRC_ALPHA / ONE_MINUS_SRC_ALPHA;
alpha: ONE / ONE_MINUS_SRC_ALPHA), with culling disabled. Tilemaps use submission
order without depth writes. Sprites test LESS_EQUAL and write depth. Submit
translucent sprites back-to-front; transparency does not imply automatic sorting.

## Coordinates and camera

World coordinates are pixels with Y up. `r2_camera_make(x,y,width,height,zoom)`
centers a column-major orthographic projection on `(x,y)`, using framebuffer
pixel dimensions. Zoom is world pixels per framebuffer pixel. The projection
and camera fields must agree, especially for repeating tilemaps. A sprite's
`z` is portable normalized depth (0 near, 1 far); use 0 for ordinary 2D.
The camera maps this to GL's -1..1 clip depth or Metal's 0..1 clip depth.

The arena preserves a minimum 320x240 world viewport across resize. Player
coordinates come from the platform-independent simulation, not pointer position.
It skips simulation and rendering for frames with a zero-sized framebuffer.

## Tilemaps

Each instance defines bottom-left world position, tile dimensions in world
pixels, normalized atlas/LUT rectangles, parallax factors and repeat flags.
LUT rectangle dimensions in texels determine map dimensions in tiles. Rectangles
must follow texel/tile boundaries; tile dimensions and rectangle extents must be
positive. Tileset dimensions must be whole multiples of tile size. Use RGBA8,
not sRGB, for tile lookup values.

A lookup texel stores a 24-bit ID in R/G/B, low byte first. Alpha is ignored.
ID 0 discards; ID 1 selects the bottom-left tileset tile; subsequent IDs run
left-to-right, then bottom-to-top. IDs must fit the selected tileset rectangle.
The shader samples texel centers with nearest filtering. This preserves the
original demo's orientation/encoding; it is not a new GAMS asset format.

Repeating axes wrap independently; non-repeating axes discard outside bounds.
A repeating instance draws a viewport quad, deriving world position from camera
position, viewport and zoom. Parallax adds `camera.pos * instance.parallax` to
the instance position. Ordinary finite maps use zero parallax/repeat.

## Sprites

An instance contains center position, normalized depth, opacity, scalar uint32 flip
flags, normalized UV rectangle, RGB tint/strength and signed integer pixel offset.
The atlas rectangle size determines world sprite size. The original shader's
UV orientation is preserved. Offsets affect geometry, not atlas lookup.

Flip bits are H=1, V=2 and anti-diagonal=4 (values 0..7). C layouts use explicit
strides/`offsetof`; flip uses `SG_VERTEXFORMAT_UINT`, offset uses
`SG_VERTEXFORMAT_INT2`, never normalized float attributes.

Opacity multiplies source alpha; alpha below .001 discards. `color_add` retains
the old name, but the shader actually mixes source RGB toward a luminance-scaled
tint by its fourth component. Strength 0 leaves source RGB unchanged.

## Fixture and checks

`game/main.c` generates its own 128x64 RGBA8 atlas and 16x11 lookup texture.
The original tile area occupies the first 32x32 texels; tilemap instances use
that atlas subrectangle to preserve tile IDs. Extra cells hold an enemy, bullet,
health pip, XP gem, bar segment, dark panel tile and authored 5x7 bitmap glyphs.
All game objects, XP bar, HUD text and level-up panel share one sprite batch,
with HUD/panel submitted last. The lookup texture is built from
`sim_tile`, the same hand-authored source used by collision. The combat arena
replaces the earlier flips/opacity/tint gallery; those features remain available. No packed resources, external art or generated GAMS
models are required.

`make test` checks shader generation and real WASM submission through a mock GPU,
including integer attributes, upload sizes, projection, movement input, a full
combat/XP/choice/death/retry run, minimize, cleanup and reinitialization. Separate C tests
cover movement/collision, combat and progression; runner tests cover browser
keys, upgrade choices, retry,
clock and focus/pause lifecycle. These do not
prove shader pixels. Chrome visual/movement checks and a three-frame real Metal
smoke run were performed. Native/web builds and tests pass with Zig 0.17.0;
see root README.md for verification details.
