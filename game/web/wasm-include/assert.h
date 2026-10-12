#ifndef GAME3_ASSERT_H
#define GAME3_ASSERT_H
#define assert(condition) ((condition) ? (void)0 : __builtin_trap())
#endif
