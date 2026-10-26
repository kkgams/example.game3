#include "bulletml/pack.h"
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Independent golden fixture copied from game/patterns.c before pack migration.
#define NUMBER(n) {.kind=BM_NUMBER,.number=(n)}
#define DIRECTION(mode,n) {.kind=(mode),.value=NUMBER(n)}
#define SPEED(n) {.kind=BM_SPEED_ABSOLUTE,.value=NUMBER(n)}
static const bm_command top[] = {
    {.kind=BM_REPEAT,.repeat={.times=NUMBER(1000000),.action={.index=1}}},
};
static const bm_expr offsets[][1] = {{NUMBER(-10)},{NUMBER(0)},{NUMBER(10)}};
static const bm_command burst[] = {
    {.kind=BM_WAIT,.wait=NUMBER(30)},
    {.kind=BM_FIRE,.ref={.index=0,.params=offsets[0],.param_count=1}},
    {.kind=BM_FIRE,.ref={.index=0,.params=offsets[1],.param_count=1}},
    {.kind=BM_FIRE,.ref={.index=0,.params=offsets[2],.param_count=1}},
    {.kind=BM_WAIT,.wait=NUMBER(60)},
};
static const bm_action actions[] = {{top,1},{burst,5}};
static const bm_bullet bullets[] = {
    {.direction=DIRECTION(BM_DIRECTION_ABSOLUTE,0),.speed=SPEED(52.0 / 60)},
};
static const bm_fire fires[] = {
    {.direction={.kind=BM_AIM,.value={.kind=BM_EXPRESSION,.source="$1"}},
     .speed=SPEED(52.0 / 60),.bullet={.index=0}},
};
static const bm_pattern reference = {
    .bullets=bullets,.bullet_count=1,.actions=actions,.action_count=2,.fires=fires,.fire_count=1,
};
static bm_pack pack;
typedef struct { int tick, bullet; double direction, speed; } shot;
typedef struct { shot shots[128]; int count, tick, events[6]; } logbook;
static void emit(void *user, const bm_event *event) {
    logbook *log = user;
    assert(event->kind >= BM_SPAWN && event->kind <= BM_DONE);
    ++log->events[event->kind];
    if (event->kind != BM_SPAWN) return;
    assert(log->count < 128);
    log->shots[log->count++] = (shot){log->tick,event->bullet,event->direction,event->speed};
}
static void timeline(const bm_pattern *p, logbook *log) {
    bm_state s; bm_init(&s,p,0);
    for (log->tick = 0; log->tick < 500; ++log->tick)
        bm_tick(&s,(bm_context){.rank=.5,.random=.25,.aim_direction=log->tick*.75},emit,log);
}
static void real_pack(const char *path) {
    FILE *file = fopen(path,"rb"); assert(file);
    assert(fseek(file,0,SEEK_END) == 0); long size = ftell(file); assert(size > 0);
    rewind(file); unsigned char *bytes = malloc((size_t)size); assert(bytes);
    assert(fread(bytes,1,(size_t)size,file) == (size_t)size); assert(fclose(file) == 0);
    // Decode unaligned input, then destroy it: no wire pointer may survive.
    unsigned char *unaligned = malloc((size_t)size+1); assert(unaligned);
    memcpy(unaligned+1,bytes,(size_t)size);
    bm_pack_decode(&pack,unaligned+1,(size_t)size);
    memset(bytes,0xa5,(size_t)size); free(bytes);
    memset(unaligned,0xa5,(size_t)size+1); free(unaligned);
    assert(pack.pattern_count == 2);
    assert(pack.patterns[0].action_count == 2 && pack.patterns[0].fire_count == 1);
    assert(strcmp(pack.patterns[0].fires[0].direction.value.source,"$1") == 0);
    logbook actual = {0}, expected = {0};
    timeline(&pack.patterns[0],&actual); timeline(&reference,&expected);
    assert(actual.count > 12 && actual.count == expected.count);
    for (int i = 0; i < actual.count; ++i) {
        assert(actual.shots[i].tick == expected.shots[i].tick);
        assert(actual.shots[i].bullet == expected.shots[i].bullet);
        assert(actual.shots[i].direction == expected.shots[i].direction);
        assert(actual.shots[i].speed == expected.shots[i].speed);
    }
    const bm_pattern *aim = &pack.patterns[1];
    assert(aim->bullet_count == 1 && aim->action_count == 2 && aim->fire_count == 1);
    assert(aim->bullets[0].direction.kind == BM_AIM);
    assert(aim->bullets[0].speed.value.number == 1);
    assert(aim->actions[0].commands[0].repeat.times.number == 1000);
    assert(aim->actions[1].commands[1].wait.number == 100);
    assert(aim->fires[0].direction.kind == BM_AIM && aim->fires[0].bullet.index == 0);
    bm_state s; bm_init(&s,&pack.patterns[0],0);
    logbook log = {0};
    for (int i = 0; i < 40; ++i) bm_tick(&s,(bm_context){.aim_direction=90},emit,&log);
    assert(log.count == 3); bm_restart(&s,0); memset(&log,0,sizeof log);
    for (int i = 0; i < 31; ++i) bm_tick(&s,(bm_context){.aim_direction=180},emit,&log);
    assert(log.count == 0); bm_tick(&s,(bm_context){.aim_direction=180},emit,&log);
    assert(log.count == 3 && log.shots[0].direction == 170);
}

// A wire writer independent of the portable producer. Offsets mark corruption
// sites; all integer/oneof/enum widths are explicit, not C layout dependent.
static unsigned char wire[65536];
static size_t used, mark[32];
static void w8(unsigned v) { assert(used < sizeof wire); wire[used++] = (unsigned char)v; }
static void w16(unsigned v) { w8(v); w8(v >> 8); }
static void w32(uint32_t v) { w16(v); w16(v >> 16); }
static void patch(size_t at, uint32_t v) { for (int i=0;i<4;++i) wire[at+i]=(unsigned char)(v>>(8*i)); }
static void number(double v) {
    uint64_t bits; memcpy(&bits,&v,8); w16(1);
    for (int i=0;i<8;++i) w8((unsigned)(bits>>(8*i)));
}
static void string(const char *s) { w16(2); w32((uint32_t)strlen(s)); while (*s) w8((unsigned char)*s++); }
static void mode(unsigned m, double v) { w32(m); number(v); }
static void plain_ref(unsigned index) { w16(1); w32(index); }
static void param_ref(unsigned index, double a, double b) {
    w16(2); w32(index); w32(2); number(a); number(b);
}
static void finish(void) { patch(12,(uint32_t)(used-16)); }
static void fixture(void) {
    used=0; memset(mark,0,sizeof mark);
    w8('R');w8('S');w8('P');w8('K');w16(1);w16(1);w32(16);w32(0);
    mark[0]=used; w32(1); mark[1]=used; w32(2); // horizontal metadata
    mark[2]=used; w32(1); // bullets
    mark[3]=used; mode(1,0); mark[4]=used; mode(0,1);
    mark[5]=used; w32(2); // two adjacent refs with independent param spans
    param_ref(1,11,12); param_ref(2,21,22);
    mark[6]=used; w32(3); // actions
    mark[7]=used; w32(8); // reserve all eight commands before reading params
    mark[8]=used; w16(1); mark[9]=used; w16(2); mark[10]=used; w32(0);
    mark[11]=used; w32(2); number(15); string("$rank");
    w16(2); param_ref(1,31,32);
    w16(3); mark[12]=used; number(0);
    w16(4); number(1); plain_ref(2);
    w16(6); mode(2,30); number(3);
    w16(7); mode(1,2); number(4);
    w16(8); mode(0,0); mode(2,6); number(5);
    w16(5); mark[13]=used; w8(1);
    w32(0); w32(0); // empty referenced actions
    mark[14]=used; w32(1); // fires
    w32(0); mark[15]=used; string("$1"); mode(2,1);
    mark[16]=used; plain_ref(0);
    finish();
}
static void synthetic(void) {
    fixture(); bm_pack_decode(&pack,wire,used);
    memset(wire,0xa5,used);
    const bm_pattern *p=&pack.patterns[0];
    assert(p->bullets[0].direction.kind == BM_DIRECTION_ABSOLUTE);
    assert(p->bullets[0].speed.kind == BM_SPEED_ABSOLUTE);
    assert(p->bullets[0].speed.value.number == 1);
    assert(p->bullets[0].action_count == 2);
    assert(p->bullets[0].actions[0].params[1].number == 12);
    assert(p->bullets[0].actions[1].params[0].number == 21);
    assert(p->actions[0].count == 8);
    const bm_command *c=p->actions[0].commands;
    assert(c[0].ref.params[0].number == 15);
    assert(strcmp(c[0].ref.params[1].source,"$rank") == 0);
    assert(c[1].ref.params[0].number == 31);
    assert(c[2].kind == BM_WAIT && c[3].kind == BM_REPEAT);
    assert(c[4].kind == BM_CHANGE_DIRECTION && c[5].kind == BM_CHANGE_SPEED);
    assert(c[6].kind == BM_ACCEL && c[7].kind == BM_VANISH);
    bm_state s; bm_init(&s,p,0); logbook log={0};
    bm_tick(&s,(bm_context){.rank=.5,.aim_direction=90},emit,&log);
    assert(s.done && log.count == 1 && log.shots[0].direction == 105 && log.shots[0].speed == 2);
    assert(log.events[BM_EVENT_DIRECTION] == 1 && log.events[BM_EVENT_SPEED] == 1);
    assert(log.events[BM_EVENT_ACCEL] == 1 && log.events[BM_EVENT_VANISH] == 1);
    // Mode domain boundaries, including zero/false wire bool, all decode.
    for (unsigned d=0;d<4;++d) for (unsigned v=0;v<3;++v) {
        fixture(); patch(mark[3],d); patch(mark[4],v); wire[mark[13]]=0;
        bm_pack_decode(&pack,wire,used);
        assert((unsigned)pack.bullets[0].direction.kind == d);
        assert((unsigned)pack.bullets[0].speed.kind == v);
    }
}
static void capacity_fixture(const char *which) {
    used=0;
    w8('R');w8('S');w8('P');w8('K');w16(1);w16(1);w32(16);w32(0);
    int params = !strcmp(which,"param-arena"), strings = !strcmp(which,"string-arena");
    int bullet_cap = !strcmp(which,"shared-bullets");
    int action_cap = !strcmp(which,"shared-actions");
    int fire_cap = !strcmp(which,"shared-fires");
    int command_cap = !strcmp(which,"shared-commands");
    int patterns = params || strings ? 1 : 2;
    w32((unsigned)patterns);
    for (int p=0;p<patterns;++p) {
        w32(0);
        int nb = bullet_cap ? 40 : fire_cap ? 1 : 0;
        w32((unsigned)nb);
        for (int b=0;b<nb;++b) { mode(1,0); mode(0,1); w32(0); }
        int na = action_cap ? 80 : params || strings || command_cap ? 1 : 0;
        w32((unsigned)na);
        for (int a=0;a<na;++a) {
            int nc = params || strings ? 257 : command_cap ? 600 : 0;
            w32((unsigned)nc);
            for (int c=0;c<nc;++c) {
                if (params) {
                    w16(2); w16(2); w32(0); w32(BM_MAX_PARAMS);
                    for (int i=0;i<BM_MAX_PARAMS;++i) number(1);
                } else if (strings) {
                    w16(3); w16(2); w32(64);
                    for (int i=0;i<64;++i) w8('1');
                } else { w16(3); number(0); }
            }
        }
        int nf = fire_cap ? 80 : 0; w32((unsigned)nf);
        for (int f=0;f<nf;++f) { mode(1,0); mode(0,1); plain_ref(0); }
    }
    finish();
}
static void invalid(const char *which) {
    if (strstr(which,"-arena") || !strncmp(which,"shared-",7)) {
        capacity_fixture(which); bm_pack_decode(&pack,wire,used); return;
    }
    fixture();
    if (!strcmp(which,"null-output")) { bm_pack_decode(NULL,wire,used); return; }
    if (!strcmp(which,"null-input")) { bm_pack_decode(&pack,NULL,used); return; }
    if (!strcmp(which,"overlap")) { bm_pack_decode(&pack,(const unsigned char *)&pack,sizeof pack); return; }
    if (!strcmp(which,"magic")) wire[0]=0;
    else if (!strcmp(which,"version")) wire[4]=2;
    else if (!strcmp(which,"slots")) wire[6]=2;
    else if (!strcmp(which,"offset")) patch(8,17);
    else if (!strcmp(which,"length")) patch(12,(uint32_t)used);
    else if (!strcmp(which,"trailing")) { w8(0); finish(); }
    else if (!strcmp(which,"patterns")) patch(mark[0],BM_PACK_MAX_PATTERNS+1);
    else if (!strcmp(which,"orientation")) patch(mark[1],3);
    else if (!strcmp(which,"bullets")) patch(mark[2],BM_PACK_MAX_BULLETS+1);
    else if (!strcmp(which,"direction")) patch(mark[3],4);
    else if (!strcmp(which,"speed")) patch(mark[4],3);
    else if (!strcmp(which,"child-actions")) patch(mark[5],BM_MAX_FRAMES+1);
    else if (!strcmp(which,"actions")) patch(mark[6],BM_PACK_MAX_ACTIONS+1);
    else if (!strcmp(which,"commands")) patch(mark[7],BM_PACK_MAX_COMMANDS+1);
    else if (!strcmp(which,"command-tag")) wire[mark[8]]=9;
    else if (!strcmp(which,"ref-tag")) wire[mark[9]]=0;
    else if (!strcmp(which,"fire-ref")) patch(mark[10],1);
    else if (!strcmp(which,"params")) patch(mark[11],BM_MAX_PARAMS+1);
    else if (!strcmp(which,"expr-tag")) wire[mark[12]]=3;
    else if (!strcmp(which,"nan")) { patch(mark[12]+2,0); patch(mark[12]+6,0x7ff80000); }
    else if (!strcmp(which,"infinity")) { patch(mark[12]+2,0); patch(mark[12]+6,0x7ff00000); }
    else if (!strcmp(which,"bool")) wire[mark[13]]=2;
    else if (!strcmp(which,"fires")) patch(mark[14],BM_PACK_MAX_FIRES+1);
    else if (!strcmp(which,"string-length")) patch(mark[15]+2,UINT32_MAX);
    else if (!strcmp(which,"strings")) patch(mark[15]+2,BM_PACK_MAX_STRING_BYTES);
    else if (!strcmp(which,"nul")) wire[mark[15]+6]=0;
    else if (!strcmp(which,"expr-params")) wire[mark[15]+7]='9';
    else if (!strcmp(which,"expr-zero")) wire[mark[15]+7]='0';
    else if (!strcmp(which,"bullet-ref")) patch(mark[16]+2,1);
    else if (!strcmp(which,"action-ref")) patch(mark[5]+4+2,3);
    else if (!strcmp(which,"ref-overflow")) patch(mark[10],UINT32_MAX);
    else if (!strncmp(which,"truncate-",9)) {
        size_t n=(size_t)strtoul(which+9,NULL,10); assert(n<used);
        if (n >= 16) patch(12,(uint32_t)(n-16));
        bm_pack_decode(&pack,wire,n); return;
    } else { fprintf(stderr,"unknown guard %s\n",which); exit(2); }
    bm_pack_decode(&pack,wire,used);
}
int main(int argc, char **argv) {
    if (argc == 3 && !strcmp(argv[1],"guard")) { invalid(argv[2]); return 0; }
    if (argc == 2 && !strcmp(argv[1],"fixture-size")) { fixture(); printf("%zu\n",used); return 0; }
    assert(argc <= 2);
    real_pack(argc == 2 ? argv[1] : "build.nosync/content/bulletml.rspk");
    synthetic(); puts("pack tests passed"); return 0;
}
