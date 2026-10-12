import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

// Inspect the actual recipe without requiring macOS SDK access on web-only hosts.
test('native recipe passes the SDK with Zig driver options', () => {
  const recipe = execFileSync('make', ['--no-print-directory', '-Bn', 'native'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8',
  })
  assert.match(recipe, /xcrun --sdk macosx --show-sdk-path/)
  assert.match(recipe, /--sysroot "\$SDK"/)
  assert.doesNotMatch(recipe, /-isysroot/)
  assert.match(recipe, /-cflags -Werror=strict-prototypes --/)
})
