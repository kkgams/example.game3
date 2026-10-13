import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
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
case "$url" in
  https://example.invalid/release) cp release.json "$output" ;;
  https://example.invalid/GAMS-fixture-macos-aarch64.zip) cp gams.zip "$output" ;;
esac
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

async function gamsFixture(t) {
  const folder = await fixture(t)
  const contents = path.join(folder, 'archive/GAMS.app/Contents')
  await mkdir(path.join(contents, 'MacOS'), { recursive: true })
  await writeFile(path.join(contents, 'Info.plist'), '<plist/>')
  await writeFile(path.join(contents, 'MacOS/gams'), '#!/bin/sh\nexit 0\n')
  await chmod(path.join(contents, 'MacOS/gams'), 0o755)
  execFileSync('zip', ['-qr', '../gams.zip', 'GAMS.app'], { cwd: path.join(folder, 'archive') })
  await writeFile(path.join(folder, 'release.json'), JSON.stringify({ assets: [{
    name: 'GAMS-fixture-macos-aarch64.zip',
    browser_download_url: 'https://example.invalid/GAMS-fixture-macos-aarch64.zip'
  }] }))
  return folder
}

const gamsArgs = ['UNAME_S=Darwin', 'UNAME_M=arm64', 'GAMS_RELEASE_API=https://example.invalid/release', 'tools/gams.app']

test('GAMS app file target installs the release once and survives clean', async t => {
  const folder = await gamsFixture(t)
  make(folder, ...gamsArgs)
  const executable = path.join(folder, 'tools/gams.app/Contents/MacOS/gams')
  assert.ok((await stat(executable)).mode & 0o111)
  assert.equal((await downloads(folder)).length, 2)
  assert.deepEqual(await readdir(path.join(folder, 'build.nosync')), [])
  await writeFile(executable, 'local app snapshot')
  make(folder, ...gamsArgs, 'GAMS_RELEASE_API=https://example.invalid/changed')
  assert.equal((await downloads(folder)).length, 2)
  assert.equal(await readFile(executable, 'utf8'), 'local app snapshot')
  make(folder, 'clean')
  await stat(executable)
})

test('GAMS download failures leave no app or staging files and allow retries', async t => {
  const folder = await gamsFixture(t)
  const release = await readFile(path.join(folder, 'release.json'))
  const archive = await readFile(path.join(folder, 'gams.zip'))
  for (const failure of ['network', 'missing asset', 'invalid archive']) {
    if (failure === 'network') await writeFile(path.join(folder, 'fail-download'), '')
    if (failure === 'missing asset') await writeFile(path.join(folder, 'release.json'), '{"assets":[]}')
    if (failure === 'invalid archive') await writeFile(path.join(folder, 'gams.zip'), 'not a zip')
    const result = spawnSync('make', ['--no-print-directory', 'CURL=./fake-curl', ...gamsArgs], { cwd: folder, encoding: 'utf8' })
    assert.notEqual(result.status, 0, failure)
    await assert.rejects(stat(path.join(folder, 'tools/gams.app')), { code: 'ENOENT' })
    assert.deepEqual(await readdir(path.join(folder, 'build.nosync')), [])
    await rm(path.join(folder, 'fail-download'), { force: true })
    await writeFile(path.join(folder, 'release.json'), release)
    await writeFile(path.join(folder, 'gams.zip'), archive)
  }
  make(folder, ...gamsArgs)
  await stat(path.join(folder, 'tools/gams.app/Contents/Info.plist'))
})

test('GAMS download rejects unsupported hosts before making network requests', async t => {
  const folder = await fixture(t)
  for (const [system, arch] of [['Linux', 'aarch64'], ['Darwin', 'x86_64']]) {
    const result = spawnSync('make', ['CURL=./fake-curl', `UNAME_S=${system}`, `UNAME_M=${arch}`, 'tools/gams.app'], { cwd: folder, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /requires macOS Apple Silicon/)
  }
  await assert.rejects(stat(path.join(folder, 'downloads.log')), { code: 'ENOENT' })
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
