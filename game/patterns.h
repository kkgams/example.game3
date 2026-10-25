#ifndef GAME3_PATTERNS_H
#define GAME3_PATTERNS_H

#include "bulletml/bulletml.h"

// Hand-authored fixture IR. Future GAMS/respack decoding replaces this data,
// not the independent VM or its host interface.
enum { SIM_PATTERN_HZ = 60, SIM_PATTERN_SUBSTEPS = 2 };
extern const bm_pattern sim_ranger_pattern;

#endif
