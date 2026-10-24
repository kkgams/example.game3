import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

test('standalone simulation: movement, combat, XP/upgrades, timing, collision, death/retry and assertions', async t => {
  const build = path.join(root, 'build.nosync')
  await mkdir(build, { recursive: true })
  // Each test process owns its executable; concurrent runs never overwrite it.
  const folder = await mkdtemp(path.join(build, 'sim-test-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const executable = path.join(folder, 'sim-test')
  execFileSync(process.env.ZIG || 'zig', [
    'cc', 'test/sim.c', 'game/sim.c', '-Igame',
    '-std=c11', '-Wall', '-Wextra', '-Werror', '-o', executable,
  ], { cwd: root, encoding: 'utf8' })
  const output = execFileSync(executable, [], { cwd: folder, encoding: 'utf8' })
  assert.match(output, /simulation assertions passed/)
  for (const invalid of ['negative', 'nan', 'infinite', 'negative-infinite', 'axis-x', 'axis-y', 'upgrade-negative', 'upgrade-range']) {
    const result = spawnSync(executable, [invalid], { cwd: folder, encoding: 'utf8' })
    assert.ifError(result.error)
    assert.ok(result.status !== 0 || result.signal, `${invalid} must assert`)
    assert.match(result.stderr, /assert/i, `${invalid} must fail an assertion`)
  }
})
