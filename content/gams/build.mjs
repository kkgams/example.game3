#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))

// Mirrors the Host's documented direct-file URL cache naming, not an installer.
// Open the Project in GAMS first to install these explicitly configured Units.
export function componentPaths(config, modulesDir) {
  assert.ok(Array.isArray(config.plugins), 'gams.json plugins must be an array')
  return ['plugin.fs', 'plugin.lua', 'plugin.respack'].map(name => {
    const sources = config.plugins.filter(source => new URL(source).pathname.endsWith(`/${name}.wasm`))
    assert.equal(sources.length, 1, `gams.json must configure exactly one ${name}.wasm`)
    const source = sources[0], url = new URL(source)
    assert.equal(url.protocol, 'https:', 'content build expects direct HTTPS Unit URLs')
    assert.equal(url.hash, '', 'content build expects direct WASM files, not archives')
    return join(modulesDir, `${createHash('sha256').update(source).digest('hex')}.wasm`)
  })
}

export function verifyPack(bytes) {
  assert.ok(bytes.length >= 20 && bytes.subarray(0,4).toString() === 'RSPK', 'missing RSPK header')
  assert.equal(bytes.readUInt16LE(4), 1, 'unsupported RSPK version')
  assert.equal(bytes.readUInt16LE(6), 1, 'BulletML schema must produce one slot')
  const offset = bytes.readUInt32LE(8), length = bytes.readUInt32LE(12)
  assert.ok(offset >= 16 && length >= 4 && offset + length <= bytes.length, 'invalid RSPK slot bounds')
  const count = bytes.readUInt32LE(offset)
  assert.ok(count > 0, 'BulletML pack must contain patterns')
  return count
}

export async function buildContent() {
  const configuredHost = process.env.GAMS_HOST_BIN
  assert.ok(configuredHost === undefined || configuredHost.trim().length > 0, 'GAMS_HOST_BIN must be non-empty when set')
  const host = resolve(root, configuredHost ?? 'tools/gams.app/Contents/MacOS/gams')
  await access(host, constants.X_OK).catch(() => {
    throw new Error(`Missing GAMS Host: ${host}; run make tools/gams.app or set GAMS_HOST_BIN to an executable path`)
  })
  let modulesDir = join(root, 'gams_modules')
  if (process.env.GAMS_MODULES_DIR !== undefined) {
    assert.ok(process.env.GAMS_MODULES_DIR && isAbsolute(process.env.GAMS_MODULES_DIR), 'GAMS_MODULES_DIR must be non-empty and absolute')
    modulesDir = process.env.GAMS_MODULES_DIR
  }
  const config = JSON.parse(await readFile(join(root,'gams.json'),'utf8'))
  const plugins = componentPaths(config, modulesDir)
  for (const path of plugins) await access(path).catch(() => {
    throw new Error(`Missing configured component: ${path}; reopen this Project in GAMS to install its Units`)
  })
  const outputDir = join(root,'build.nosync/content')
  await mkdir(outputDir,{recursive:true})
  const graph = await readFile(join(root,'content/gams/graphs/bulletml.ng.json'),'utf8')
  const entry = await readFile(join(root,'ng/compile-graph.lua'),'utf8')
  function invoke(source) {
    const result = spawnSync(host, ['run', ...plugins.flatMap(path => ['--plug',path]), 'lua/lua::run', JSON.stringify([source])], {
      cwd:root, encoding:'utf8', timeout:120000, maxBuffer:16*1024*1024,
      env:{...process.env,GAMS_APP_CWD:root,GAMS_WASMTIME_CACHE_DIR:join(root,'build.nosync/wasmtime-cache-content')},
    })
    assert.ifError(result.error)
    assert.equal(result.status,0,`GAMS CLI failed: ${result.stderr}\n${result.stdout}`)
    const response = JSON.parse(result.stdout)
    assert.equal(response.err,undefined,`GAMS Lua failed: ${response.err}`)
    assert.equal(typeof response.ok,'string','GAMS Lua must return a string')
    return response.ok
  }
  const generated = invoke(`_G.input = ${JSON.stringify(graph)}\n${entry}`)
  await writeFile(join(outputDir,'bulletml.generated.lua'),generated)
  const goals = JSON.parse(invoke(generated))
  assert.equal(Object.keys(goals).length,1,'content graph must produce one explicit pack goal')
  const goal = Object.values(goals)[0]
  assert.equal(goal.active.path,true,'pack goal path must be active')
  assert.equal(typeof goal.inputs.path,'string','pack goal must return a path')
  const pack = resolve(root,goal.inputs.path)
  assert.ok(pack.startsWith(join(root,'build.nosync')+sep),'pack must stay in ignored build output')
  const bytes = await readFile(pack), patterns = verifyPack(bytes)
  return {path:goal.inputs.path,patterns,bytes:bytes.length}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await buildContent(),null,2))
