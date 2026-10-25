#include "bulletml.h"
#include <assert.h>
#include <float.h>
#include <limits.h>

static double checked(double v) { assert(v >= -DBL_MAX && v <= DBL_MAX); return v; }
static void context_check(bm_context c) { checked(c.rank); checked(c.random); checked(c.aim_direction); }
static void params_check(const double *p, int n) {
    assert(n >= 0 && n <= BM_MAX_PARAMS && (n == 0 || p));
    for (int i = 0; i < n; ++i) checked(p[i]);
}
typedef struct { const char *s; const double *params; int count, depth; bm_context context; } parser;
static void spaces(parser *p) {
    while (*p->s == ' ' || *p->s == '\n' || *p->s == '\r' || *p->s == '\t') ++p->s;
}
static bool take(parser *p, char c) {
    spaces(p); if (*p->s != c) return false; ++p->s; return true;
}
static bool digit(char c) { return c >= '0' && c <= '9'; }
static bool word(parser *p, const char *s) {
    const char *a = p->s;
    while (*s) if (*a++ != *s++) return false;
    p->s = a; return true;
}
static double expression(parser *p);
static double factor(parser *p) {
    assert(p->depth < BM_MAX_EXPR_DEPTH); ++p->depth;
    double v = 0;
    if (take(p, '+')) v = factor(p);
    else if (take(p, '-')) v = -factor(p);
    else if (take(p, '(')) { v = expression(p); assert(take(p, ')')); }
    else if (take(p, '$')) {
        if (word(p, "rank")) v = p->context.rank;
        else if (word(p, "rand")) v = p->context.random;
        else {
            int i = 0; assert(digit(*p->s));
            while (digit(*p->s)) {
                int d = *p->s++ - '0'; assert(i <= (INT_MAX - d) / 10); i = i * 10 + d;
            }
            assert(i > 0 && i <= p->count); v = p->params[i - 1];
        }
    } else {
        spaces(p); bool any = false;
        while (digit(*p->s)) { any = true; v = checked(v * 10 + (*p->s++ - '0')); }
        if (*p->s == '.') {
            ++p->s; double frac = 0, divisor = 1;
            while (digit(*p->s)) {
                any = true; frac = checked(frac * 10 + (*p->s++ - '0')); divisor = checked(divisor * 10);
            }
            v = checked(v + frac / divisor);
        }
        assert(any);
    }
    --p->depth; return checked(v);
}
static double term(parser *p) {
    double v = factor(p);
    for (;;) {
        if (take(p, '*')) v = checked(v * factor(p));
        else if (take(p, '/')) { double d = factor(p); assert(d != 0); v = checked(v / d); }
        else return v;
    }
}
static double expression(parser *p) {
    double v = term(p);
    for (;;) {
        if (take(p, '+')) v = checked(v + term(p));
        else if (take(p, '-')) v = checked(v - term(p));
        else return v;
    }
}
double bm_eval(bm_expr e, const double *params, int count, bm_context context) {
    params_check(params, count); context_check(context);
    if (e.kind == BM_NUMBER) return checked(e.number);
    assert(e.kind == BM_EXPRESSION && e.source);
    parser p = {.s=e.source, .params=params, .count=count, .context=context};
    double v = expression(&p); spaces(&p); assert(*p.s == '\0'); return v;
}
static double degrees(double v) {
    checked(v); bool negative = v < 0; if (negative) v = -v;
    // Binary reduction avoids libc fmod and unsafe huge integer quotients.
    double scale = 360;
    while (scale <= v / 2) scale *= 2;
    while (scale >= 360) { if (v >= scale) v -= scale; scale /= 2; }
    if (negative && v != 0) v = 360 - v;
    return v == 360 ? 0 : v;
}
static double direction(bm_direction d, double current, const double *p, int n, bm_context c) {
    double v = bm_eval(d.value, p, n, c);
    switch (d.kind) {
        case BM_AIM: return degrees(checked(c.aim_direction + v));
        case BM_DIRECTION_ABSOLUTE: return degrees(v);
        case BM_DIRECTION_RELATIVE: case BM_DIRECTION_SEQUENCE: return degrees(checked(current + v));
        default: assert(!"invalid direction kind"); return 0;
    }
}
static void speed_kind(bm_speed_kind k) {
    assert(k == BM_SPEED_ABSOLUTE || k == BM_SPEED_RELATIVE || k == BM_SPEED_SEQUENCE);
}
static double speed(bm_speed d, double current, const double *p, int n, bm_context c) {
    speed_kind(d.kind); double v = bm_eval(d.value, p, n, c);
    return d.kind == BM_SPEED_ABSOLUTE ? v : checked(current + v);
}
static int duration(bm_expr e, const double *p, int n, bm_context c) {
    double v = bm_eval(e, p, n, c); assert(v >= INT_MIN && v <= INT_MAX);
    return v <= 0 ? 0 : (int)v;
}
static void pattern_check(const bm_pattern *p) {
    assert(p);
    assert(p->action_count >= 0 && (p->action_count == 0 || p->actions));
    assert(p->bullet_count >= 0 && (p->bullet_count == 0 || p->bullets));
    assert(p->fire_count >= 0 && (p->fire_count == 0 || p->fires));
}
static bm_frame resolve(bm_ref r, int limit, const double *p, int n, bm_context c) {
    // Bounds first: never access a referred table through an unchecked index.
    assert(r.index >= 0 && r.index < limit);
    assert(r.param_count >= 0 && r.param_count <= BM_MAX_PARAMS && (r.param_count == 0 || r.params));
    bm_frame f = {.action=r.index, .remaining=1, .param_count=r.param_count};
    for (int i = 0; i < r.param_count; ++i) f.params[i] = bm_eval(r.params[i], p, n, c);
    return f;
}
static void push(bm_state *s, bm_frame f) {
    assert(f.action >= 0 && f.action < s->pattern->action_count);
    assert(s->depth >= 0 && s->depth < BM_MAX_FRAMES); s->frames[s->depth++] = f;
}
void bm_restart(bm_state *s, int action) {
    assert(s); pattern_check(s->pattern); s->depth = 0; s->wait = 0; s->done = false;
    push(s, (bm_frame){.action=action, .remaining=1});
}
void bm_init(bm_state *s, const bm_pattern *p, int action) {
    assert(s); pattern_check(p);
    *s = (bm_state){.pattern=p, .direction=180, .last_fire_direction=180, .last_fire_speed=1};
    bm_restart(s, action);
}
static void fire(bm_state *s, bm_ref r, const double *p, int n, bm_context c, bm_emit emit, void *user) {
    bm_frame fp = resolve(r, s->pattern->fire_count, p, n, c);
    const bm_fire *f = &s->pattern->fires[fp.action];
    bm_frame bp = resolve(f->bullet, s->pattern->bullet_count, fp.params, fp.param_count, c);
    const bm_bullet *b = &s->pattern->bullets[bp.action];
    double d = direction(f->direction, s->last_fire_direction, fp.params, fp.param_count, c);
    double v = speed(f->speed, s->last_fire_speed, fp.params, fp.param_count, c);
    bm_event e = {.kind=BM_SPAWN, .bullet=bp.action, .direction=d, .speed=v};
    // Original evaluates required bullet motion before the fire overrides it.
    e.child = (bm_state){.pattern=s->pattern,
        .direction=direction(b->direction, 0, bp.params, bp.param_count, c),
        .speed=speed(b->speed, 0, bp.params, bp.param_count, c)};
    assert(b->action_count >= 0 && b->action_count <= BM_MAX_FRAMES && (b->action_count == 0 || b->actions));
    // Reverse LIFO push preserves source action order; each frame owns params.
    for (int i = b->action_count; i > 0; --i)
        push(&e.child, resolve(b->actions[i-1], s->pattern->action_count, bp.params, bp.param_count, c));
    e.child.direction = e.child.last_fire_direction = s->last_fire_direction = d;
    e.child.speed = e.child.last_fire_speed = s->last_fire_speed = v; emit(user, &e);
}
void bm_tick(bm_state *s, bm_context c, bm_emit emit, void *user) {
    assert(s && emit); pattern_check(s->pattern); context_check(c);
    assert(s->depth >= 0 && s->depth <= BM_MAX_FRAMES && s->wait >= 0);
    checked(s->direction); checked(s->speed); checked(s->last_fire_direction); checked(s->last_fire_speed);
    if (s->done) return;
    if (s->wait > 0) { --s->wait; return; }
    int steps = 0;
    while (!s->done && s->wait == 0) {
        assert(steps++ < BM_MAX_STEPS);
        if (s->depth == 0) {
            s->done = true; bm_event e = {.kind=BM_DONE}; emit(user, &e); break;
        }
        bm_frame *f = &s->frames[s->depth - 1];
        assert(f->action >= 0 && f->action < s->pattern->action_count); params_check(f->params, f->param_count);
        const bm_action *a = &s->pattern->actions[f->action];
        assert(a->count >= 0 && (a->count == 0 || a->commands));
        assert(f->command >= 0 && f->command <= a->count && f->remaining > 0);
        if (f->command == a->count) {
            if (--f->remaining > 0) f->command = 0; else --s->depth;
            continue;
        }
        bm_command cmd = a->commands[f->command++]; const double *p = f->params; int n = f->param_count;
        bm_event e = {0};
        switch (cmd.kind) {
            case BM_FIRE: fire(s, cmd.ref, p, n, c, emit, user); break;
            case BM_ACTION: push(s, resolve(cmd.ref, s->pattern->action_count, p, n, c)); break;
            case BM_WAIT: s->wait = duration(cmd.wait, p, n, c); break;
            case BM_REPEAT: {
                int count = duration(cmd.repeat.times, p, n, c);
                if (count) {
                    bm_frame next = resolve(cmd.repeat.action, s->pattern->action_count, p, n, c);
                    next.remaining = count; push(s, next);
                }
                break;
            }
            case BM_VANISH: s->done = true; e.kind = BM_EVENT_VANISH; emit(user, &e); break;
            case BM_CHANGE_DIRECTION:
                e.kind = BM_EVENT_DIRECTION; e.previous_direction = s->direction;
                e.direction = direction(cmd.direction.value, s->direction, p, n, c);
                e.term = duration(cmd.direction.term, p, n, c);
                s->direction = e.direction; emit(user, &e); break;
            case BM_CHANGE_SPEED:
                e.kind = BM_EVENT_SPEED; e.previous_speed = s->speed;
                e.speed = speed(cmd.speed.value, s->speed, p, n, c);
                e.term = duration(cmd.speed.term, p, n, c);
                s->speed = e.speed; emit(user, &e); break;
            case BM_ACCEL:
                e.kind = BM_EVENT_ACCEL; speed_kind(cmd.accel.horizontal.kind); speed_kind(cmd.accel.vertical.kind);
                // Odin emits evaluated components, not mode-adjusted values;
                // acceleration modes/interpolation remain the host's concern.
                e.horizontal = bm_eval(cmd.accel.horizontal.value, p, n, c);
                e.vertical = bm_eval(cmd.accel.vertical.value, p, n, c);
                e.term = duration(cmd.accel.term, p, n, c); emit(user, &e); break;
            default: assert(!"invalid BulletML command");
        }
    }
}
