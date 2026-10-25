import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

test('ranged enemy: pattern timing, aim, movement, LOS, pools, pause, frame partitions, waves, XP and reset', async t => {
  const build = path.join(root, 'build.nosync')
  await mkdir(build, {recursive: true})
  const folder = await mkdtemp(path.join(build, 'ranger-test-'))
  t.after(() => rm(folder, {recursive: true, force: true}))
  const executable = path.join(folder, 'ranger-test')
  execFileSync(process.env.ZIG || 'zig', [
    'cc', 'test/ranger.c', 'game/sim.c', 'game/patterns.c', 'game/bulletml/bulletml.c', '-Igame',
    '-std=c11', '-Wall', '-Wextra', '-Werror', '-o', executable,
  ], {cwd: root, encoding: 'utf8'})
  execFileSync(executable, [], {cwd: folder, encoding: 'utf8'})
})
