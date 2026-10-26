#include "pack.h"
#include <assert.h>
#include <float.h>
#include <limits.h>
#include <stdint.h>
#include <string.h>

#ifdef NDEBUG
#error "bm_pack_decode requires assertions enabled"
#endif

_Static_assert(sizeof(double) == 8 && DBL_MANT_DIG == 53 && DBL_MAX_EXP == 1024,
               "RSPK f64 requires IEEE binary64");
typedef struct {
    bm_pack *out;
    const unsigned char *bytes;
    size_t cursor, length;
    int bullets, actions, commands, fires, refs, params, strings;
} reader;
static unsigned byte(reader *r) {
    assert(r->cursor < r->length);
    return r->bytes[r->cursor++];
}
static uint32_t u16(reader *r) {
    uint32_t lo = byte(r), hi = byte(r); return lo | hi << 8;
}
static uint32_t u32(reader *r) {
    uint32_t lo = u16(r), hi = u16(r); return lo | hi << 16;
}
static int reserve(int *used, uint32_t n, int capacity) {
    assert(*used >= 0 && *used <= capacity);
    assert(n <= (uint32_t)(capacity - *used));
    int start = *used; *used += (int)n; return start;
}
static int index_value(reader *r) {
    uint32_t n = u32(r); assert(n <= INT_MAX); return (int)n;
}
static bm_expr expr(reader *r) {
    unsigned tag = u16(r);
    bm_expr e = {0};
    if (tag == 1) {
        uint64_t bits = 0;
        for (unsigned i = 0; i < 8; ++i) bits |= (uint64_t)byte(r) << (i * 8);
        e.kind = BM_NUMBER; memcpy(&e.number, &bits, sizeof bits);
        assert(e.number >= -DBL_MAX && e.number <= DBL_MAX);
    } else {
        assert(tag == 2);
        uint32_t n = u32(r);
        assert(n <= r->length - r->cursor);
        assert(n < BM_PACK_MAX_STRING_BYTES);
        int start = reserve(&r->strings, n + 1, BM_PACK_MAX_STRING_BYTES);
        char *s = &r->out->strings[start];
        for (uint32_t i = 0; i < n; ++i) {
            unsigned c = byte(r); assert(c != 0); s[i] = (char)c;
        }
        s[n] = '\0';
        // This is deliberately not a second expression parser. Only bound numeric
        // parameter tokens; the VM validates grammar and call-scope availability.
        for (uint32_t i = 0; i < n; ++i) if (s[i] == '$') {
            unsigned param = 0; uint32_t j = i + 1;
            while (j < n && s[j] >= '0' && s[j] <= '9') {
                unsigned digit = (unsigned)(s[j++] - '0');
                assert(param <= BM_MAX_PARAMS / 10);
                param = param * 10 + digit; assert(param <= BM_MAX_PARAMS);
            }
            if (j != i + 1) assert(param > 0);
        }
        e.kind = BM_EXPRESSION; e.source = s;
    }
    return e;
}
static bm_ref ref(reader *r) {
    unsigned tag = u16(r); assert(tag == 1 || tag == 2);
    bm_ref v = {.index=index_value(r)};
    if (tag == 2) {
        uint32_t n = u32(r); assert(n <= BM_MAX_PARAMS);
        int start = reserve(&r->params, n, BM_PACK_MAX_PARAMS);
        v.params = &r->out->params[start]; v.param_count = (int)n;
        for (int i = 0; i < v.param_count; ++i) r->out->params[start+i] = expr(r);
    }
    return v;
}
static bm_direction direction(reader *r) {
    uint32_t kind = u32(r); assert(kind <= 3);
    static const bm_direction_kind modes[] = {BM_AIM, BM_DIRECTION_ABSOLUTE, BM_DIRECTION_RELATIVE, BM_DIRECTION_SEQUENCE};
    bm_direction d = {.kind=modes[kind]}; d.value = expr(r); return d;
}
static bm_speed speed(reader *r) {
    uint32_t kind = u32(r); assert(kind <= 2);
    static const bm_speed_kind modes[] = {BM_SPEED_ABSOLUTE, BM_SPEED_RELATIVE, BM_SPEED_SEQUENCE};
    bm_speed s = {.kind=modes[kind]}; s.value = expr(r); return s;
}
static bm_command command(reader *r) {
    unsigned tag = u16(r); assert(tag >= 1 && tag <= 8);
    static const bm_command_kind kinds[] = {
        BM_FIRE, BM_ACTION, BM_WAIT, BM_REPEAT, BM_VANISH,
        BM_CHANGE_DIRECTION, BM_CHANGE_SPEED, BM_ACCEL,
    };
    bm_command c = {.kind=kinds[tag-1]};
    switch (c.kind) {
        case BM_FIRE: case BM_ACTION: c.ref = ref(r); break;
        case BM_WAIT: c.wait = expr(r); break;
        case BM_REPEAT: c.repeat.times = expr(r); c.repeat.action = ref(r); break;
        // The schema carries a bool, but the existing VM's vanish IR is the
        // command tag alone (as in authored JSON). Validate either wire bool.
        case BM_VANISH: { unsigned value = byte(r); assert(value <= 1); break; }
        case BM_CHANGE_DIRECTION:
            c.direction.value = direction(r); c.direction.term = expr(r); break;
        case BM_CHANGE_SPEED:
            c.speed.value = speed(r); c.speed.term = expr(r); break;
        case BM_ACCEL:
            c.accel.horizontal = speed(r); c.accel.vertical = speed(r);
            c.accel.term = expr(r); break;
        default: assert(!"unreachable command");
    }
    return c;
}
static void check_ref(bm_ref v, int limit) { assert(v.index >= 0 && v.index < limit); }
static void validate(const bm_pattern *p) {
    for (int i = 0; i < p->bullet_count; ++i) {
        const bm_bullet *b = &p->bullets[i];
        for (int j = 0; j < b->action_count; ++j) check_ref(b->actions[j], p->action_count);
    }
    for (int i = 0; i < p->fire_count; ++i) check_ref(p->fires[i].bullet, p->bullet_count);
    for (int i = 0; i < p->action_count; ++i) {
        const bm_action *a = &p->actions[i];
        for (int j = 0; j < a->count; ++j) {
            const bm_command *c = &a->commands[j];
            if (c->kind == BM_FIRE) check_ref(c->ref, p->fire_count);
            if (c->kind == BM_ACTION) check_ref(c->ref, p->action_count);
            if (c->kind == BM_REPEAT) check_ref(c->repeat.action, p->action_count);
        }
    }
}
void bm_pack_decode(bm_pack *out, const unsigned char *bytes, size_t length) {
    assert(out && bytes);
    // Check integer address differences rather than performing relational pointer
    // comparisons between unrelated objects. Also prevent output/input aliasing.
    uintptr_t a = (uintptr_t)out, b = (uintptr_t)bytes;
    assert(a <= b ? b - a >= sizeof *out : a - b >= length);
    reader r = {.out=out,.bytes=bytes,.length=length};
    assert(byte(&r) == 'R'); assert(byte(&r) == 'S');
    assert(byte(&r) == 'P'); assert(byte(&r) == 'K');
    assert(u16(&r) == 1); assert(u16(&r) == 1);
    assert(u32(&r) == 16);
    uint32_t payload = u32(&r); assert((size_t)payload == length - r.cursor);
    memset(out, 0, sizeof *out);
    uint32_t patterns = u32(&r); assert(patterns <= BM_PACK_MAX_PATTERNS);
    out->pattern_count = (int)patterns;
    for (int i = 0; i < out->pattern_count; ++i) {
        bm_pattern *p = &out->patterns[i];
        assert(u32(&r) <= 2); // Pattern orientation is authoring metadata, not VM IR.
        uint32_t n = u32(&r);
        int start = reserve(&r.bullets, n, BM_PACK_MAX_BULLETS);
        p->bullets = &out->bullets[start]; p->bullet_count = (int)n;
        for (int j = 0; j < p->bullet_count; ++j) {
            bm_bullet *v = &out->bullets[start+j];
            v->direction = direction(&r); v->speed = speed(&r);
            uint32_t count = u32(&r); assert(count <= BM_MAX_FRAMES);
            int first = reserve(&r.refs, count, BM_PACK_MAX_REFS);
            v->actions = &out->refs[first]; v->action_count = (int)count;
            for (int k = 0; k < v->action_count; ++k) out->refs[first+k] = ref(&r);
        }
        n = u32(&r); start = reserve(&r.actions, n, BM_PACK_MAX_ACTIONS);
        p->actions = &out->actions[start]; p->action_count = (int)n;
        for (int j = 0; j < p->action_count; ++j) {
            bm_action *v = &out->actions[start+j];
            uint32_t count = u32(&r);
            int first = reserve(&r.commands, count, BM_PACK_MAX_COMMANDS);
            v->commands = &out->commands[first]; v->count = (int)count;
            for (int k = 0; k < v->count; ++k) out->commands[first+k] = command(&r);
        }
        n = u32(&r); start = reserve(&r.fires, n, BM_PACK_MAX_FIRES);
        p->fires = &out->fires[start]; p->fire_count = (int)n;
        for (int j = 0; j < p->fire_count; ++j) {
            bm_fire *v = &out->fires[start+j];
            v->direction = direction(&r); v->speed = speed(&r); v->bullet = ref(&r);
        }
        validate(p);
    }
    assert(r.cursor == r.length);
}
