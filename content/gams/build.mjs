#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))

// Paths come only from a completed native Host preparation, never cache internals.
export function componentPaths(config, snapshot) {
  assert.deepEqual(snapshot.sourcePlugins, config.plugins, 'prepared snapshot is stale: sourcePlugins differ from gams.json; prepare and export again')
  const prepared = snapshot.config
  assert.ok(prepared && typeof prepared === 'object', 'prepared snapshot must contain config')
  assert.ok(Array.isArray(config.plugins), 'gams.json plugins must be an array')
  assert.ok(Array.isArray(prepared.plugins) && prepared.plugins.length === config.plugins.length,
    'prepared config must contain the same plugin list as gams.json')
  return ['plugin.fs', 'plugin.lua', 'plugin.respack'].map(name => {
    const indexes = config.plugins.flatMap((source, index) => {
      const resource = typeof source === 'object' && source !== null ? source.$file : source
      return typeof resource === 'string' && resource.endsWith(`/${name}.wasm`) ? [index] : []
    })
    assert.equal(indexes.length, 1, `gams.json must configure exactly one ${name}.wasm`)
    const path = prepared.plugins[indexes[0]]
    assert.ok(typeof path === 'string' && path.length > 0 && !isAbsolute(path) &&
      !path.includes('\\') && !path.includes(':') && !path.includes('\0') &&
      path.split('/').every(part => part !== '' && part !== '.' && part !== '..'),
      'prepared plugin must be a Project-relative guest path; export runtime.config after runtime.ready')
    return path
  })
}

export function replResults(stdout, count) {
  const responses = stdout.trim().split('\n').map(line => JSON.parse(line))
  assert.equal(responses.length, count, 'GAMS REPL returned an unexpected response count')
  return responses.map(response => {
    assert.equal(response.error, undefined, `GAMS REPL failed: ${JSON.stringify(response.error)}`)
    assert.ok(Object.hasOwn(response, 'ok'), 'GAMS REPL response must contain ok')
    return response.ok
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
  assert.ok(process.env.GAMS_PREPARED_CONFIG && isAbsolute(process.env.GAMS_PREPARED_CONFIG),
    'GAMS_PREPARED_CONFIG must name an absolute JSON snapshot of runtime.config from a completed native Host prepare; REPL does not prepare Projects')
  const config = JSON.parse(await readFile(join(root,'gams.json'),'utf8'))
  const snapshot = JSON.parse(await readFile(process.env.GAMS_PREPARED_CONFIG,'utf8'))
  assert.equal(snapshot.modulesDir, modulesDir, 'GAMS_MODULES_DIR must equal the exported runtime.modulesDir')
  const plugins = componentPaths(config, snapshot)
  const localPlugins = plugins.map(path => path.startsWith('gams_modules/') ? join(modulesDir, path.slice('gams_modules/'.length)) : join(root, path))
  for (const local of localPlugins) {
    await access(local).catch(() => {
      throw new Error(`Missing prepared component: ${local}; reopen this Project in GAMS and export runtime.config with its actual runtime.modulesDir`)
    })
  }
  const outputDir = join(root,'build.nosync/content')
  await mkdir(outputDir,{recursive:true})
  const graphPath = 'content/gams/graphs/bulletml.ng.lua'
  const source = await readFile(join(root, graphPath),'utf8')
  const calls = [
    `gams/host::load-plugins ${JSON.stringify(localPlugins)}`,
    `lua/lua::run ${[source, 'main', '[]', graphPath].map(value => JSON.stringify(value)).join(' ')}`,
  ]
  const result = spawnSync(host, ['--runtime', 'repl', '--format=json', '--project-dir', root], {
    input: calls.join('\n') + '\n', cwd:root, encoding:'utf8', timeout:120000, maxBuffer:16*1024*1024,
    env:{...process.env,GAMS_APP_CWD:root,GAMS_MODULES_DIR:modulesDir,GAMS_WASMTIME_CACHE_DIR:join(root,'build.nosync/wasmtime-cache-content')},
  })
  assert.ifError(result.error)
  assert.equal(result.status,0,`GAMS REPL failed: ${result.stderr}\n${result.stdout}`)
  const [, response] = replResults(result.stdout, 2)
  assert.equal(response.err,undefined,`GAMS Lua failed: ${response.err}`)
  assert.equal(typeof response.ok,'string','GAMS Lua must return a string')
  const goals = JSON.parse(response.ok)
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
