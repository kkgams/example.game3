import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

test('orbiting blades: unlock/upgrades, caps, clock, sweeps, walls, cooldowns, XP, boss and reset', async t => {
  const build = path.join(root, 'build.nosync')
  await mkdir(build, {recursive: true})
  const folder = await mkdtemp(path.join(build, 'blades-test-'))
  t.after(() => rm(folder, {recursive: true, force: true}))
  const executable = path.join(folder, 'blades-test')
  execFileSync(process.env.ZIG || 'zig', [
    'cc', 'test/blades.c', 'game/sim.c', 'game/patterns.c', 'game/bulletml/bulletml.c', '-Igame',
    '-std=c11', '-Wall', '-Wextra', '-Werror', '-o', executable,
  ], {cwd: root, encoding: 'utf8'})
  execFileSync(executable, [], {cwd: folder, encoding: 'utf8'})
})
