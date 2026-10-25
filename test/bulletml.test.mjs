import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

test('independent BulletML VM: Odin parity, scopes, events, guards', async t => {
  const build = path.join(root, 'build.nosync')
  await mkdir(build, {recursive: true})
  const folder = await mkdtemp(path.join(build, 'bulletml-test-'))
  t.after(() => rm(folder, {recursive: true, force: true}))
  const executable = path.join(folder, 'bulletml-test')
  execFileSync(process.env.ZIG || 'zig', [
    'cc', 'test/bulletml.c', 'game/bulletml/bulletml.c', '-Igame',
    '-std=c11', '-Wall', '-Wextra', '-Werror', '-o', executable,
  ], {cwd: root, encoding: 'utf8'})
  assert.match(execFileSync(executable, [], {cwd: folder, encoding: 'utf8'}), /tests passed/)
  const modes = [
    ...Array.from({length: 12}, (_, i) => `syntax-${i}`),
    'null-expression', 'invalid-expression-kind', 'nan', 'infinity',
    'arithmetic-overflow', 'expr-depth', 'unary-depth', 'bad-init',
    'null-table', 'recursion', 'steps', 'bad-action', 'bad-fire',
    'bad-command', 'duration-overflow', 'param-limit', 'null-params',
    'null-commands', 'negative-count', 'bad-bullet', 'child-limit',
    'bad-direction', 'bad-speed',
  ]
  for (const mode of modes) {
    await t.test(`asserts: ${mode}`, () => {
      const result = spawnSync(executable, [mode], {cwd: folder, encoding: 'utf8', timeout: 5000})
      assert.ifError(result.error)
      assert.equal(result.signal, 'SIGABRT', `expected assertion for ${mode}: ${result.stderr}`)
      assert.match(result.stderr, /Assertion failed|Assertion .*failed/i)
    })
  }
})
