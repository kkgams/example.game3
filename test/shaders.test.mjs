import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const host = `${os.platform() === 'darwin' ? 'osx' : 'linux'}${os.arch() === 'arm64' ? '_arm64' : ''}`

async function fixture(t) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'game3-shaders-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  await copyFile(path.join(root, 'Makefile'), path.join(folder, 'Makefile'))
  await cp(path.join(root, 'game/vendor'), path.join(folder, 'game/vendor'), { recursive: true })
  await mkdir(path.join(folder, 'game/web/wasm-include'), { recursive: true })
  await copyFile(path.join(root, 'game/triangle-sapp.glsl'), path.join(folder, 'game/triangle-sapp.glsl'))
  const tool = `tools/sokol-shdc/${host}/sokol-shdc`
  await mkdir(path.dirname(path.join(folder, tool)), { recursive: true })
  await copyFile(path.join(root, tool), path.join(folder, tool))
  await chmod(path.join(folder, tool), 0o755)
  return folder
}

function make(folder, target = 'shaders') {
  return execFileSync('make', ['--no-print-directory', target], { cwd: folder, encoding: 'utf8' })
}

test('real shader generation: nested files, incremental builds, includes, failures and clean', async t => {
  const folder = await fixture(t)
  await mkdir(path.join(folder, 'game/nested'))
  await copyFile(path.join(folder, 'game/triangle-sapp.glsl'), path.join(folder, 'game/nested/triangle.glsl'))
  const source = path.join(folder, 'game/triangle-sapp.glsl')
  const header = `${source}.h`
  const include = path.join(folder, 'game/common.glslinc')
  await writeFile(include, '@block common\n#define ANGLE_SCALE 1.0\n@end\n')
  const original = await readFile(source, 'utf8')
  await writeFile(source, '@include common.glslinc\n' + original.replace('@vs vs', '@vs vs\n@include_block common').replace('sin(angle)', 'sin(angle * ANGLE_SCALE)'))
  make(folder)
  assert.match(await readFile(header, 'utf8'), /vs_source_glsl300es/)
  assert.match(await readFile(header, 'utf8'), /vs_source_metal_macos/)
  assert.match(await readFile(path.join(folder, 'game/nested/triangle.glsl.h'), 'utf8'), /triangle_shader_desc/)
  const before = await readFile(header, 'utf8')
  const modified = (await stat(header)).mtimeMs
  assert.doesNotMatch(make(folder), / -i /, 'unchanged shaders must not regenerate')
  assert.equal((await stat(header)).mtimeMs, modified)
  await writeFile(include, '@block common\n#define ANGLE_SCALE 0.5\n@end\n')
  assert.match(make(folder), / -i /, 'shader includes must invalidate generated headers')
  assert.notEqual(await readFile(header, 'utf8'), before)
  await rm(path.join(folder, 'build.nosync/shader-deps/game/triangle-sapp.glsl.d'))
  assert.match(make(folder), / -i /, 'missing include depfiles must be restored')
  await rm(header)
  make(folder)
  assert.match(await readFile(header, 'utf8'), /triangle_shader_desc/)
  make(folder, 'clean')
  await stat(header)
  await stat(path.join(folder, `tools/sokol-shdc/${host}/sokol-shdc`))
  await assert.rejects(stat(path.join(folder, 'build.nosync/shader-deps')), { code: 'ENOENT' })
  assert.match(make(folder), / -i /, 'clean must trigger regeneration of include depfiles')
  await stat(path.join(folder, 'build.nosync/shader-deps/game/triangle-sapp.glsl.d'))
  await assert.rejects(stat(path.join(folder, 'tools/shader-deps')), { code: 'ENOENT' })
  await writeFile(source, original.replace('@vs vs', '@vs vs\nINVALID GLSL!'))
  const result = spawnSync('make', ['--no-print-directory', 'shaders'], { cwd: folder, encoding: 'utf8' })
  assert.notEqual(result.status, 0, 'invalid shaders must fail instead of using stale output')
  assert.match(result.stdout + result.stderr, /error/i)
})
