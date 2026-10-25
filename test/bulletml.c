#include "bulletml/bulletml.h"
#include <assert.h>
#include <float.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#define N(v) { .kind=BM_NUMBER, .number=(v) }
#define X(s) { .kind=BM_EXPRESSION, .source=(s) }
#define D(k,v) { .kind=(k), .value=N(v) }
#define S(k,v) D(k,v)
#define R(i) { .index=(i) }
#define FIRE(i) { .kind=BM_FIRE, .ref=R(i) }
#define WAIT(v) { .kind=BM_WAIT, .wait=N(v) }
#define REPEAT(n,i) { .kind=BM_REPEAT, .repeat={.times=N(n), .action=R(i)} }
#define ACTION(a) { .commands=(a), .count=(int)(sizeof(a)/sizeof((a)[0])) }
static const bm_context ctx={.rank=.5,.random=.3,.aim_direction=10};
typedef struct { bm_event events[64]; int count; } event_log;
static void record(void *u,const bm_event *e) { event_log *l=u;assert(l->count<64);l->events[l->count++]=*e; }
static void ignore(void *u,const bm_event *e) { (void)u;(void)e; }
static event_log tick(bm_state *s) { event_log l={0};bm_tick(s,ctx,record,&l);return l; }
static void expressions(void) {
    double p[]={4,2};
    double v=bm_eval((bm_expr)X(" -(2+$1)*+.5 + $2/2 + $rank + $rand "),p,2,ctx);
    assert(v > -1.200001 && v < -1.199999);
    assert(bm_eval((bm_expr)X("1+2*3-8/4/2"),0,0,ctx)==6);
    assert(bm_eval((bm_expr)X("--2.5+5."),0,0,ctx)==7.5);
}
static void sequence(void) {
    const bm_bullet b[]={
        {.direction=D(BM_DIRECTION_ABSOLUTE,0),.speed=S(BM_SPEED_ABSOLUTE,1)},
        {.direction=D(BM_DIRECTION_ABSOLUTE,0),.speed=S(BM_SPEED_ABSOLUTE,1)}};
    const bm_command a0[]={REPEAT(999,1)},a1[]={FIRE(0),REPEAT(7,2),WAIT(2)},a2[]={FIRE(1)};
    const bm_action a[]={ACTION(a0),ACTION(a1),ACTION(a2)};
    const bm_fire f[]={
        {.direction=D(BM_DIRECTION_SEQUENCE,-5),.speed=S(BM_SPEED_ABSOLUTE,1),.bullet=R(0)},
        {.direction=D(BM_DIRECTION_SEQUENCE,45),.speed=S(BM_SPEED_ABSOLUTE,1),.bullet=R(1)}};
    const bm_pattern p={.bullets=b,.bullet_count=2,.actions=a,.action_count=3,.fires=f,.fire_count=2};
    bm_state s;bm_init(&s,&p,0);assert(s.direction==180 && s.speed==0 && s.last_fire_speed==1);
    event_log l=tick(&s);const double first[]={175,220,265,310,355,40,85,130};assert(l.count==8);
    for(int i=0;i<8;++i) {
        assert(l.events[i].kind==BM_SPAWN && l.events[i].direction==first[i]);
        assert(l.events[i].speed==1 && l.events[i].child.last_fire_direction==first[i]);
        assert(l.events[i].bullet==(i!=0));
    }
    assert(tick(&s).count==0 && tick(&s).count==0);
    l=tick(&s);const double shifted[]={125,170,215,260,305,350,35,80};assert(l.count==8);
    for(int i=0;i<8;++i) assert(l.events[i].direction==shifted[i]);
    assert(s.direction==180);s.direction=23;s.speed=7;bm_restart(&s,0);
    assert(s.wait==0 && !s.done && s.direction==23 && s.speed==7 && s.last_fire_direction==80);
    l=tick(&s);assert(l.events[0].direction==75);
}
static void scopes(void) {
    bm_expr ten[]={N(10)},nested[]={X("$1+2")},fp[]={X("$1*2")},bp[]={X("$1+1")},cp[]={X("$1+3")};
    bm_ref refs[]={{.index=3,.params=cp,.param_count=1},{.index=4}};
    const bm_command a0[]={{.kind=BM_ACTION,.ref={.index=1,.params=ten,.param_count=1}},WAIT(1)};
    const bm_command a1[]={{.kind=BM_ACTION,.ref={.index=2,.params=nested,.param_count=1}},
        {.kind=BM_CHANGE_SPEED,.speed={.value={.kind=BM_SPEED_ABSOLUTE,.value=X("$1")},.term=N(0)}}};
    const bm_command a2[]={{.kind=BM_FIRE,.ref={.index=0,.params=fp,.param_count=1}}};
    const bm_command a3[]={WAIT(1),{.kind=BM_CHANGE_SPEED,.speed={.value={.kind=BM_SPEED_ABSOLUTE,.value=X("$1")},.term=N(2)}}};
    const bm_command a4[]={{.kind=BM_CHANGE_SPEED,.speed={.value=S(BM_SPEED_RELATIVE,1),.term=N(3)}}};
    const bm_action a[]={ACTION(a0),ACTION(a1),ACTION(a2),ACTION(a3),ACTION(a4)};
    const bm_bullet b={.direction=D(BM_AIM,0),.speed=S(BM_SPEED_ABSOLUTE,1),.actions=refs,.action_count=2};
    const bm_fire f={.direction={.kind=BM_DIRECTION_ABSOLUTE,.value=X("$1")},
        .speed={.kind=BM_SPEED_ABSOLUTE,.value=X("$1/2")},.bullet={.index=0,.params=bp,.param_count=1}};
    bm_pattern p={.actions=a,.action_count=5,.bullets=&b,.bullet_count=1,.fires=&f,.fire_count=1};
    bm_state s;bm_init(&s,&p,0);event_log l=tick(&s);
    assert(l.count==2 && l.events[0].direction==24 && l.events[0].speed==12 && l.events[1].speed==10);
    bm_state child=l.events[0].child;memset(&s,0,sizeof s);memset(&l,0,sizeof l);ten[0].number=999;
    assert(tick(&child).count==0 && tick(&child).count==0);l=tick(&child);assert(l.count==3);
    assert(l.events[0].kind==BM_EVENT_SPEED && l.events[0].speed==28 && l.events[0].previous_speed==12);
    assert(l.events[1].speed==29 && l.events[1].previous_speed==28);
    assert(l.events[2].kind==BM_DONE && child.done && tick(&child).count==0);
}
static void motion(void) {
    const bm_command c[]={
        {.kind=BM_CHANGE_DIRECTION,.direction={.value=D(BM_AIM,-20),.term=N(2.9)}},
        {.kind=BM_CHANGE_DIRECTION,.direction={.value=D(BM_DIRECTION_RELATIVE,30),.term=N(-3)}},
        {.kind=BM_CHANGE_DIRECTION,.direction={.value=D(BM_DIRECTION_SEQUENCE,-50),.term=N(4)}},
        {.kind=BM_CHANGE_DIRECTION,.direction={.value=D(BM_DIRECTION_ABSOLUTE,1085),.term=N(1)}},
        {.kind=BM_CHANGE_SPEED,.speed={.value=S(BM_SPEED_ABSOLUTE,3),.term=N(2)}},
        {.kind=BM_CHANGE_SPEED,.speed={.value=S(BM_SPEED_RELATIVE,2),.term=N(3)}},
        {.kind=BM_CHANGE_SPEED,.speed={.value=S(BM_SPEED_SEQUENCE,-1),.term=N(4)}},
        {.kind=BM_ACCEL,.accel={.horizontal=S(BM_SPEED_RELATIVE,7),.vertical=S(BM_SPEED_SEQUENCE,-8),.term=N(5)}},
        REPEAT(0,0),WAIT(-2),WAIT(0),{.kind=BM_VANISH},{.kind=0}};
    const bm_action a[]={ACTION(c)};const bm_pattern p={.actions=a,.action_count=1};
    bm_state s;bm_init(&s,&p,0);event_log l=tick(&s);assert(l.count==9);
    const double d[]={350,20,330,5},prev[]={180,350,20,330};const int terms[]={2,0,4,1};
    for(int i=0;i<4;++i) assert(l.events[i].direction==d[i] && l.events[i].previous_direction==prev[i] && l.events[i].term==terms[i]);
    assert(l.events[4].speed==3 && l.events[4].previous_speed==0 && l.events[4].term==2);
    assert(l.events[5].speed==5 && l.events[5].previous_speed==3 && l.events[5].term==3);
    assert(l.events[6].speed==4 && l.events[6].previous_speed==5 && l.events[6].term==4);
    assert(l.events[7].kind==BM_EVENT_ACCEL && l.events[7].horizontal==7 && l.events[7].vertical==-8 && l.events[7].term==5);
    assert(l.events[8].kind==BM_EVENT_VANISH && s.done && tick(&s).count==0);
    const bm_action empty={0};const bm_pattern ep={.actions=&empty,.action_count=1};
    bm_init(&s,&ep,0);l=tick(&s);assert(l.count==1 && l.events[0].kind==BM_DONE);
}
static void fire_modes(void) {
    const bm_command c[]={FIRE(0),FIRE(1),FIRE(2),FIRE(3),FIRE(4)};const bm_action a[]={ACTION(c)};
    const bm_bullet b={.direction=D(BM_AIM,0),.speed=S(BM_SPEED_RELATIVE,0)};
    const bm_fire f[]={
        {.direction=D(BM_AIM,15),.speed=S(BM_SPEED_ABSOLUTE,3),.bullet=R(0)},
        {.direction=D(BM_DIRECTION_ABSOLUTE,-15),.speed=S(BM_SPEED_RELATIVE,2),.bullet=R(0)},
        {.direction=D(BM_DIRECTION_RELATIVE,30),.speed=S(BM_SPEED_SEQUENCE,4),.bullet=R(0)},
        {.direction=D(BM_DIRECTION_SEQUENCE,-20),.speed=S(BM_SPEED_ABSOLUTE,-1),.bullet=R(0)},
        {.direction=D(BM_DIRECTION_ABSOLUTE,DBL_MAX),.speed=S(BM_SPEED_ABSOLUTE,0),.bullet=R(0)}};
    const bm_pattern p={.actions=a,.action_count=1,.bullets=&b,.bullet_count=1,.fires=f,.fire_count=5};
    bm_state s;bm_init(&s,&p,0);s.direction=99;event_log l=tick(&s);
    const double ds[]={25,345,15,355},vs[]={3,5,9,-1};assert(l.count==6);
    for(int i=0;i<4;++i) assert(l.events[i].direction==ds[i] && l.events[i].speed==vs[i]);
    assert(l.events[4].direction>=0 && l.events[4].direction<360);
    bm_state child=l.events[0].child;l=tick(&child);assert(l.count==1 && l.events[0].kind==BM_DONE);
}
static void boundaries(void) {
    double params[BM_MAX_PARAMS]={0};params[BM_MAX_PARAMS-1]=42;
    assert(bm_eval((bm_expr)X("$8"),params,BM_MAX_PARAMS,ctx)==42);
    char text[BM_MAX_EXPR_DEPTH*2+1];int n=0;
    for(int i=1;i<BM_MAX_EXPR_DEPTH;++i)text[n++]='(';
    text[n++]='1';
    for(int i=1;i<BM_MAX_EXPR_DEPTH;++i)text[n++]=')';
    text[n]=0;
    assert(bm_eval((bm_expr){.kind=BM_EXPRESSION,.source=text},0,0,ctx)==1);
    bm_ref refs[BM_MAX_FRAMES];
    for(int i=0;i<BM_MAX_FRAMES;++i)refs[i]=(bm_ref)R(1);
    const bm_command c[]={FIRE(0)};const bm_action a[]={ACTION(c),{0}};
    const bm_bullet b={.direction=D(BM_DIRECTION_ABSOLUTE,0),.speed=S(BM_SPEED_ABSOLUTE,1),.actions=refs,.action_count=BM_MAX_FRAMES};
    const bm_fire f={.direction=D(BM_DIRECTION_ABSOLUTE,-DBL_MAX),.speed=S(BM_SPEED_ABSOLUTE,1),.bullet=R(0)};
    const bm_pattern p={.actions=a,.action_count=2,.bullets=&b,.bullet_count=1,.fires=&f,.fire_count=1};
    bm_state s;bm_init(&s,&p,0);event_log l=tick(&s);
    assert(l.count==2 && l.events[0].child.depth==BM_MAX_FRAMES);
    assert(l.events[0].direction>=0 && l.events[0].direction<360);
    bm_state child=l.events[0].child;l=tick(&child);
    assert(l.count==1 && l.events[0].kind==BM_DONE);
}
static void death(const char *m) {
    const char *bad[]={"","1/0",".","1..2","(1+2","$0","$1","$2147483648","$rankx","1 2","NaN","1e2"};
    for(int i=0;i<(int)(sizeof bad/sizeof *bad);++i) {
        char name[32];snprintf(name,sizeof name,"syntax-%d",i);
        if(!strcmp(m,name)) { bm_eval((bm_expr){.kind=BM_EXPRESSION,.source=bad[i]},0,0,ctx);return; }
    }
    if(!strcmp(m,"null-expression")) { bm_eval((bm_expr){.kind=BM_EXPRESSION},0,0,ctx);return; }
    if(!strcmp(m,"invalid-expression-kind")) { bm_eval((bm_expr){0},0,0,ctx);return; }
    if(!strcmp(m,"nan")) { bm_eval((bm_expr)N(__builtin_nan("")),0,0,ctx);return; }
    if(!strcmp(m,"infinity")) { bm_eval((bm_expr)N(__builtin_inf()),0,0,ctx);return; }
    if(!strcmp(m,"arithmetic-overflow")) { double d=DBL_MAX;bm_eval((bm_expr)X("$1*2"),&d,1,ctx);return; }
    if(!strcmp(m,"expr-depth") || !strcmp(m,"unary-depth")) {
        char t[256];int n=0;bool par=!strcmp(m,"expr-depth");
        for(int i=0;i<BM_MAX_EXPR_DEPTH+1;++i)t[n++]=par?'(':'-';t[n++]='1';
        if(par)for(int i=0;i<BM_MAX_EXPR_DEPTH+1;++i)t[n++]=')';t[n]=0;
        bm_eval((bm_expr){.kind=BM_EXPRESSION,.source=t},0,0,ctx);return;
    }
    bm_command cmd=WAIT(0);bm_action a={.commands=&cmd,.count=1};bm_pattern p={.actions=&a,.action_count=1};bm_state s;
    if(!strcmp(m,"bad-init")) { bm_init(&s,&p,-1);return; }
    if(!strcmp(m,"null-table")) { p.actions=0;bm_init(&s,&p,0);return; }
    if(!strcmp(m,"recursion"))cmd=(bm_command){.kind=BM_ACTION,.ref=R(0)};
    else if(!strcmp(m,"steps"))cmd=(bm_command)REPEAT(BM_MAX_STEPS+1,1);
    else if(!strcmp(m,"bad-action"))cmd=(bm_command){.kind=BM_ACTION,.ref=R(1)};
    else if(!strcmp(m,"bad-fire"))cmd=(bm_command)FIRE(0);
    else if(!strcmp(m,"bad-command"))cmd.kind=0;
    else if(!strcmp(m,"duration-overflow"))cmd.wait=(bm_expr)N((double)INT_MAX+1);
    else if(!strcmp(m,"param-limit"))cmd=(bm_command){.kind=BM_ACTION,.ref={.index=0,.param_count=BM_MAX_PARAMS+1}};
    else if(!strcmp(m,"null-params"))cmd=(bm_command){.kind=BM_ACTION,.ref={.index=0,.param_count=1}};
    else if(!strcmp(m,"null-commands"))a.commands=0;
    else if(!strcmp(m,"negative-count"))a.count=-1;
    else if(!strcmp(m,"bad-bullet") || !strcmp(m,"child-limit") || !strcmp(m,"bad-direction") || !strcmp(m,"bad-speed")) {
        bm_bullet b={.direction=D(BM_AIM,0),.speed=S(BM_SPEED_ABSOLUTE,1)};
        bm_fire f={.direction=D(BM_AIM,0),.speed=S(BM_SPEED_ABSOLUTE,1),.bullet=R(0)};
        cmd=(bm_command)FIRE(0);p.fires=&f;p.fire_count=1;p.bullets=&b;p.bullet_count=1;
        if(!strcmp(m,"bad-bullet"))f.bullet.index=1;
        if(!strcmp(m,"child-limit"))b.action_count=BM_MAX_FRAMES+1;
        if(!strcmp(m,"bad-direction"))f.direction.kind=(bm_direction_kind)99;
        if(!strcmp(m,"bad-speed"))f.speed.kind=(bm_speed_kind)99;
        bm_init(&s,&p,0);bm_tick(&s,ctx,ignore,0);return;
    } else assert(!"unknown death mode");
    bm_action acts[2]={a,{0}};
    if(!strcmp(m,"steps")) { p.actions=acts;p.action_count=2; }
    bm_init(&s,&p,0);bm_tick(&s,ctx,ignore,0);
}
int main(int argc,char **argv) {
    if(argc==2) { death(argv[1]);return 0; }
    expressions();sequence();scopes();motion();fire_modes();boundaries();puts("BulletML VM tests passed");return 0;
}
