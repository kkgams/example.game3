# BulletML runtime provenance

Adapted from the read-only `/Users/gook/Repos/gams3` checkout, remote
`git@github.com:justgook/gamectl.git`, revision
`6fbc4f97e2894e8496c94be3999e31c3abc353e5`.
The referenced paths were clean when inspected. Original input SHA-256 hashes:

| Original path | SHA-256 | Use |
| --- | --- | --- |
| `examples/demo/game/world/bullet/bullet.odin` | `46fa54f632b97a636f291fa9a86c8039b0d1244baf144120bf43d198d65a17d2` | VM/expression semantics ported to C |
| `examples/demo/game/world/bullet/bullet_test.odin` | `56217059b5139cee57ab9b646199e0ed3fb83b0d622747cf2f75266a73214d29` | Sequence-fire regression ported |
| `examples/demo/game/world/sys_bullet.odin` | `d2df9667fe7e191b65b30b6232152c89fee5090875ffa83e12b0c880db7cb060` | Event boundary and Y-up aiming reference only |
| `examples/demo/game/data_bullet/decoder.odin` | `7e55d9c3d4746d84a7b20edef8ac28831e1aaa067c741bc9a92e8cb37e5a5920` | Type vocabulary reference only; decoder not copied |

Authored adaptations:

- Odin dynamic frames/parameter arrays/events become bounded C value storage
  and a synchronous callback. No allocations or destruction API are required.
- Define independent immutable C IR types instead of importing generated
  decoder structs. This is an in-process API, not an RSPK ABI commitment.
- Preserve prior-shot sequence state, reference scopes, reverse LIFO child
  action order, wait/restart semantics and motion-event targets.
- Add explicit finite/arithmetic/reference/stack/depth/execution guards.
- Normalize directions without libc `fmod`, keeping the freestanding WASM
  build free of platform math imports.
- Author a new ranged-enemy fixture/host adapter using the game's existing
  pools, collision and interpolated circle. Do not import ECS, director, old
  world motion systems, packed resources or generated decoder code.

The input Odin files contain no embedded license notice. No notice was removed;
this record does not establish licensing or redistribution clearance. Existing
`SOURCE.json` historical hashes and the original checkout are unchanged.
