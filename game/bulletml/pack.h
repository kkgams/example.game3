#ifndef GAME3_BULLETML_PACK_H
#define GAME3_BULLETML_PACK_H

#include "bulletml.h"
#include <stddef.h>

#define BM_PACK_MAX_PATTERNS 8
#define BM_PACK_MAX_BULLETS 64
#define BM_PACK_MAX_ACTIONS 128
#define BM_PACK_MAX_COMMANDS 1024
#define BM_PACK_MAX_FIRES 128
#define BM_PACK_MAX_REFS 1024
#define BM_PACK_MAX_PARAMS 2048
#define BM_PACK_MAX_STRING_BYTES 16384

// All capacities are shared across the pack. IR pointers refer into this object:
// input bytes may be discarded after decode, but the pack must NOT be moved or
// overwritten while states use it. No allocation, platform or filesystem API.
typedef struct bm_pack {
    bm_pattern patterns[BM_PACK_MAX_PATTERNS];
    int pattern_count;
    bm_bullet bullets[BM_PACK_MAX_BULLETS];
    bm_action actions[BM_PACK_MAX_ACTIONS];
    bm_command commands[BM_PACK_MAX_COMMANDS];
    bm_fire fires[BM_PACK_MAX_FIRES];
    bm_ref refs[BM_PACK_MAX_REFS];
    bm_expr params[BM_PACK_MAX_PARAMS];
    char strings[BM_PACK_MAX_STRING_BYTES];
} bm_pack;

// Strict one-slot RSPK v1 / content/gams/schema/bulletml.rspk.json decoder.
// Assertions MUST be enabled. Rejects malformed wire data, impossible references,
// nonfinite numbers and parameter indices beyond BM_MAX_PARAMS. Expression syntax,
// actual parameter availability, execution depth and arithmetic remain VM guards.
// bytes must not overlap out; length is the exact file length (no trailing bytes).
void bm_pack_decode(bm_pack *out, const unsigned char *bytes, size_t length);

#endif
