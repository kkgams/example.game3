import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync, spawnSync} from 'node:child_process'
import {mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const folder = path.join(root, 'build.nosync', 'pack-test')
const executable = path.join(folder, 'pack-test')
const packPath = process.env.BM_TEST_PACK ?? path.join(root, 'build.nosync/content/bulletml.rspk')

test('standalone owned RSPK decoder, real ranger timeline and full synthetic schema', async t => {
  mkdirSync(folder, {recursive: true})
  execFileSync(process.env.ZIG ?? 'zig', [
    'cc', 'test/pack.c', 'game/bulletml/pack.c', 'game/bulletml/bulletml.c', '-Igame',
    '-std=c11', '-Wall', '-Wextra', '-Werror', '-o', executable,
  ], {cwd: root, encoding: 'utf8'})
  assert.match(execFileSync(executable, [packPath], {cwd: folder, encoding: 'utf8'}), /pack tests passed/)
  const guards = [
    'null-output', 'null-input', 'overlap',
    'magic', 'version', 'slots', 'offset', 'length', 'trailing', 'patterns',
    'orientation', 'bullets', 'direction', 'speed', 'child-actions', 'actions',
    'commands', 'command-tag', 'ref-tag', 'fire-ref', 'params', 'expr-tag',
    'nan', 'infinity', 'bool', 'fires', 'string-length', 'strings', 'nul',
    'expr-params', 'expr-zero', 'bullet-ref', 'action-ref', 'ref-overflow',
    'param-arena', 'string-arena', 'shared-bullets', 'shared-actions',
    'shared-fires', 'shared-commands',
  ]
  for (const guard of guards) await t.test(`asserts ${guard}`, () => {
    const result = spawnSync(executable, ['guard', guard], {cwd: folder, encoding: 'utf8', timeout: 5000})
    assert.ifError(result.error)
    assert.equal(result.signal, 'SIGABRT', `${guard}: ${result.stderr}`)
    assert.match(result.stderr, /Assertion failed|Assertion .*failed/i)
  })
  await t.test('refuses builds without assertions', () => {
    const result = spawnSync(process.env.ZIG ?? 'zig', [
      'cc', '-c', 'game/bulletml/pack.c', '-Igame', '-DNDEBUG',
      '-o', path.join(folder, 'disabled.o'),
    ], {cwd: root, encoding: 'utf8', timeout: 30000})
    assert.ifError(result.error)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /requires assertions enabled/)
  })
  await t.test('asserts every truncated prefix', () => {
    const size = Number(execFileSync(executable, ['fixture-size'], {encoding: 'utf8'}).trim())
    assert.ok(size > 200)
    for (let n = 0; n < size; ++n) {
      const result = spawnSync(executable, ['guard', `truncate-${n}`], {cwd: folder, encoding: 'utf8', timeout: 5000})
      assert.ifError(result.error)
      assert.equal(result.signal, 'SIGABRT', `prefix ${n}: ${result.stderr}`)
    }
  })
})
