#ifndef GAME3_PATTERNS_H
#define GAME3_PATTERNS_H

#include "bulletml/bulletml.h"

// Authored RSPK bytes are embedded at build time and decoded once into owned IR.
// Initialize before spawning actors; returned patterns live for the instance.
enum { SIM_PATTERN_HZ = 60, SIM_PATTERN_SUBSTEPS = 2 };
void sim_patterns_init(void);
const bm_pattern *sim_ranger_pattern(void);

#endif
