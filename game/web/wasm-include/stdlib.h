#ifndef _STDLIB_H_
#define _STDLIB_H_

#include <stddef.h>
#include <stdint.h>

// abort function - just trap in WASM
static inline void abort(void) {
    __builtin_trap();
}

// Simple bump allocator for freestanding WASM
// You can replace this with a proper allocator or import from JS
#define HEAP_SIZE (1024 * 1024)  // 1MB heap

static uint8_t heap[HEAP_SIZE];
static size_t heap_offset = 0;

static inline void *malloc(size_t size) {
    if (size == 0) return NULL;
    
    // Align to 8 bytes
    size = (size + 7) & ~7;
    
    if (heap_offset + size > HEAP_SIZE) {
        return NULL;  // Out of memory
    }
    
    void *ptr = &heap[heap_offset];
    heap_offset += size;
    return ptr;
}

static inline void free(void *ptr) {
    // Bump allocator doesn't support free
    // For production, use a proper allocator or import from JS
    (void)ptr;
}

static inline void *calloc(size_t nmemb, size_t size) {
    size_t total = nmemb * size;
    void *ptr = malloc(total);
    if (ptr) {
        uint8_t *p = ptr;
        for (size_t i = 0; i < total; i++) {
            p[i] = 0;
        }
    }
    return ptr;
}

static inline void *realloc(void *ptr, size_t size) {
    if (!ptr) return malloc(size);
    if (size == 0) {
        free(ptr);
        return NULL;
    }
    // Simple implementation: always allocate new
    void *new_ptr = malloc(size);
    if (new_ptr && ptr) {
        // Copy old data (we don't know old size, so this is unsafe)
        // For production use, track allocation sizes
    }
    return new_ptr;
}

void qsort(void *base, size_t nmemb, size_t size,
           int (*compar)(const void *, const void *));

#endif
