import assert from 'node:assert/strict'
import test from 'node:test'
import {cp, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'

const root = new URL('../', import.meta.url)

test('Make regenerates authored collision edits and rejects missing/invalid input despite newer output', async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'game3-map-make-'))
  t.after(() => rm(folder, {recursive:true, force:true}))
  await cp(new URL('Makefile', root), path.join(folder, 'Makefile'))
  await cp(new URL('content/maps', root), path.join(folder, 'content/maps'), {recursive:true})
  await mkdir(path.join(folder, 'game/web/wasm-include'), {recursive:true})
  const target = 'build.nosync/content/world-map.h'
  const output = path.join(folder, target), input = path.join(folder, 'content/maps/world.tilemap.json')
  const run = () => spawnSync('make', ['--no-print-directory', target], {cwd:folder, encoding:'utf8'})
  let result = run(); assert.equal(result.status, 0, result.stderr)
  const original = await readFile(output, 'utf8'), first = (await stat(output)).mtimeMs
  result = run(); assert.equal(result.status, 0, result.stderr)
  assert.equal((await stat(output)).mtimeMs, first, 'no-op validation preserves header')
  const map = JSON.parse(await readFile(input, 'utf8'))
  map.collision[map.height - 1 - 2][2] = 1
  await writeFile(input, JSON.stringify(map))
  result = run(); assert.equal(result.status, 0, result.stderr)
  const edited = await readFile(output, 'utf8')
  assert.notEqual(edited, original, 'collision cell edit regenerates embedded map')
  const future = new Date(Date.now()+60000)
  await utimes(output, future, future)
  await writeFile(input, '{broken')
  result = run(); assert.notEqual(result.status, 0, 'newer header cannot hide malformed source')
  assert.equal(await readFile(output, 'utf8'), edited)
  await rm(input)
  result = run(); assert.notEqual(result.status, 0, 'newer header cannot hide deleted source')
  assert.equal(await readFile(output, 'utf8'), edited)
})
