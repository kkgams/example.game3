import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

const web = new URL('../build.nosync/web/', import.meta.url)

test('Pages artifact contains only the game and resolves assets under a repository subpath', async () => {
  const files = ['gl-bridge.js', 'index.html', 'runner.js', 'triangle.wasm']
  assert.deepEqual((await readdir(web)).filter(name => !name.startsWith('.')).sort(), files,
    'test fixtures, source, tools and debug pages must not enter the Pages artifact')
  const base = new URL('https://kkgams.github.io/example.game3/')
  async function asset(reference, parent) {
    const url = new URL(reference, parent)
    assert.equal(url.origin, base.origin)
    assert.ok(url.pathname.startsWith(base.pathname), `asset escapes repository subpath: ${reference}`)
    const name = url.pathname.slice(base.pathname.length)
    assert.ok(files.includes(name), `missing deployed asset: ${name}`)
    return {url, bytes: await readFile(new URL(name, web))}
  }
  const html = (await readFile(new URL('index.html', web))).toString()
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)]
  assert.equal(scripts.length, 1)
  const runner = await asset(scripts[0][1], base)
  const source = runner.bytes.toString()
  const imports = [...source.matchAll(/\bimport\s+[^'"\n]*from\s*['"]([^'"]+)['"]/g)]
  assert.equal(imports.length, 1)
  await asset(imports[0][1], runner.url)
  const fetches = [...source.matchAll(/\bfetch\(\s*['"]([^'"]+)['"]/g)]
  assert.equal(fetches.length, 1)
  const wasm = await asset(fetches[0][1], runner.url)
  assert.ok(WebAssembly.validate(wasm.bytes))
  assert.equal(wasm.url.pathname, '/example.game3/triangle.wasm')
})
