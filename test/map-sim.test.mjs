import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const zig = process.env.ZIG || 'zig'
const sources = ['test/map-sim.c', 'game/map.c', 'game/sim.c', 'game/patterns.c',
  'game/bulletml/bulletml.c', 'game/bulletml/pack.c']
const includes = ['-Igame', '-Ibuild.nosync/content']
const guards = ['width', 'height', 'tile-size', 'binary', 'sealed', 'disconnected',
  'spawn-solid', 'spawn-body', 'spawn-outside', 'null-collision', 'perimeter', 'nan-origin', 'infinite-spawn', 'origin-range', 'spawn-range']

test('authored map and real simulation: dimensions, swept collision, BFS, spawns, boss and camera native/WASM', async t => {
  const build = path.join(root, 'build.nosync')
  await mkdir(build, {recursive: true})
  const folder = await mkdtemp(path.join(build, 'map-sim-'))
  t.after(() => rm(folder, {recursive: true, force: true}))
  const native = path.join(folder, 'map-sim')
  execFileSync(zig, ['cc', ...sources, ...includes, '-std=c11', '-Wall', '-Wextra', '-Werror', '-o', native],
    {cwd: root, encoding: 'utf8'})
  assert.match(execFileSync(native, [], {cwd: folder, encoding: 'utf8'}), /map simulation assertions passed/)
  for (const [guard, name] of guards.entries()) await t.test(`native rejects ${name}`, () => {
    const result = spawnSync(native, [String(guard)], {cwd: folder, encoding: 'utf8', timeout: 5000})
    assert.ifError(result.error)
    assert.equal(result.signal, 'SIGABRT', `${name}: ${result.stderr}`)
    assert.match(result.stderr, /assert/i)
  })
  const wasm = path.join(folder, 'map-sim.wasm')
  execFileSync(zig, ['build-exe', ...sources, ...includes, '-Igame/web/wasm-include',
    '-target', 'wasm32-freestanding', '-fno-entry', '-rdynamic', '-O', 'ReleaseSafe', `-femit-bin=${wasm}`],
  {cwd: root, encoding: 'utf8'})
  const module = await WebAssembly.compile(await readFile(wasm))
  const instance = await WebAssembly.instantiate(module, {})
  assert.equal(instance.exports.map_sim_probe(), 1)
  assert.equal(instance.exports.map_sim_probe(), 1, 'reinitialization keeps borrowed map valid')
  for (const [guard, name] of guards.entries()) await t.test(`WASM rejects ${name}`, async () => {
    const fresh = await WebAssembly.instantiate(module, {})
    assert.throws(() => fresh.exports.map_sim_guard(guard), WebAssembly.RuntimeError)
  })
  for (const source of ['game/map.c', 'game/sim.c']) await t.test(`${source} requires assertions`, () => {
    const result = spawnSync(zig, ['cc', '-c', source, ...includes, '-DNDEBUG',
      '-o', path.join(folder, `${path.basename(source)}.o`)], {cwd: root, encoding: 'utf8', timeout: 30000})
    assert.ifError(result.error)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /requires assertions enabled/)
  })
})
