import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const host = `${os.platform() === 'darwin' ? 'osx' : 'linux'}${os.arch() === 'arm64' ? '_arm64' : ''}`
const headers = ['sokol_app.h', 'sokol_gfx.h', 'sokol_glue.h', 'sokol_log.h']

async function fixture(t) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'game3-deps-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  await copyFile(path.join(root, 'Makefile'), path.join(folder, 'Makefile'))
  await mkdir(path.join(folder, 'game/web/wasm-include'), { recursive: true })
  const curl = path.join(folder, 'fake-curl')
  await writeFile(curl, `#!/bin/sh
set -eu
url=''
output=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output="$2"; shift ;;
    https://*) url="$1" ;;
  esac
  shift
done
printf '%s\\n' "$url" >> downloads.log
printf '%s\\n' "$url" > "$output"
if [ -f fail-download ]; then exit 22; fi
`)
  await chmod(curl, 0o755)
  return folder
}

function make(folder, ...targets) {
  return execFileSync('make', ['--no-print-directory', 'CURL=./fake-curl', ...targets], { cwd: folder, encoding: 'utf8' })
}

async function downloads(folder) {
  return (await readFile(path.join(folder, 'downloads.log'), 'utf8')).trim().split('\n')
}

test('ordinary Make file targets download only missing dependencies and preserve existing edits', async t => {
  const folder = await fixture(t)
  make(folder, '-j4', 'deps')
  assert.equal((await downloads(folder)).length, 5)
  for (const header of headers) await stat(path.join(folder, 'game/vendor', header))
  const tool = path.join(folder, `tools/sokol-shdc/${host}/sokol-shdc`)
  assert.ok((await stat(tool)).mode & 0o111)
  const edited = path.join(folder, 'game/vendor/sokol_app.h')
  await writeFile(edited, 'local committed snapshot')
  const modified = (await stat(edited)).mtimeMs
  make(folder, 'deps')
  assert.equal((await downloads(folder)).length, 5)
  assert.equal(await readFile(edited, 'utf8'), 'local committed snapshot')
  assert.equal((await stat(edited)).mtimeMs, modified)
  // Neither a changed recipe nor a changed URL refreshes existing snapshots.
  await writeFile(path.join(folder, 'Makefile'), (await readFile(path.join(folder, 'Makefile'), 'utf8')) + '\n# changed recipe\n')
  make(folder, 'deps', 'SOKOL_URL=https://example.invalid/new-version')
  assert.equal((await downloads(folder)).length, 5)
  await rm(path.join(folder, 'game/vendor/sokol_log.h'))
  make(folder, 'sokol', 'SOKOL_URL=https://example.invalid/new-version')
  assert.equal((await downloads(folder)).length, 6)
  assert.match((await downloads(folder)).at(-1), /new-version\/sokol_log.h$/)
  await rm(tool)
  make(folder, 'sokol-shdc')
  assert.equal((await downloads(folder)).length, 7)
  make(folder, 'clean')
  await stat(tool)
  await stat(edited)
})

test('failed downloads leave no partial target and can be retried', async t => {
  const folder = await fixture(t)
  await writeFile(path.join(folder, 'fail-download'), '')
  const result = spawnSync('make', ['--no-print-directory', 'CURL=./fake-curl', 'game/vendor/sokol_app.h'], { cwd: folder, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  await assert.rejects(stat(path.join(folder, 'game/vendor/sokol_app.h')), { code: 'ENOENT' })
  await assert.rejects(stat(path.join(folder, 'game/vendor/sokol_app.h.tmp')), { code: 'ENOENT' })
  await rm(path.join(folder, 'fail-download'))
  make(folder, 'game/vendor/sokol_app.h')
  await stat(path.join(folder, 'game/vendor/sokol_app.h'))
})
