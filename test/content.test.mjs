import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { componentPaths, verifyPack } from '../content/gams/build.mjs'

// Node + this checkout only: no installed Units, Lua, Host, siblings or network.
const root = fileURLToPath(new URL('../', import.meta.url))
const read = name => readFile(path.join(root, name), 'utf8')
const json = async name => JSON.parse(await read(name))
const config = await json('gams.json')
const graph = await json('content/gams/graphs/bulletml.ng.json')
const patterns = ['ranger-fan', 'aim'].map(name => `content/bulletml/${name}.bulletml.json`)
function localPath(name, prefix = 'content/') {
  assert.equal(typeof name, 'string')
  assert.ok(name.startsWith(prefix), `${name} must be under ${prefix}`)
  assert.ok(!path.isAbsolute(name) && !name.includes('\\'))
  assert.ok(!name.split('/').some(part => ['', '.', '..'].includes(part)), name)
  return path.join(root, name)
}
async function localFile(name, prefix) {
  assert.ok((await stat(localPath(name, prefix))).isFile(), name)
}
function finite(value, label) {
  assert.equal(typeof value, 'number', label)
  assert.ok(Number.isFinite(value), label)
}
function color(value, label) {
  assert.ok(Array.isArray(value), label)
  assert.equal(value.length, 4, label)
  value.forEach(channel => { finite(channel, label); assert.ok(channel >= 0 && channel <= 1, label) })
}
function uniqueIds(items, label) {
  const ids = items.map(item => item.id)
  ids.forEach(id => assert.ok(Number.isInteger(id) && id > 0, label))
  assert.equal(new Set(ids).size, ids.length, label)
}

test('Project authoring plugins, Views and source selectors are explicit and release-pinned', () => {
  const pluginNames = config.plugins.map(source => {
    const url = new URL(source)
    assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'github.com'); assert.equal(url.hash, '')
    assert.match(url.pathname, /^\/kkgams\/plugin\.[\w-]+\/releases\/download\/v\d+\.\d+\.\d+\/plugin\.[\w-]+\.wasm$/)
    return path.posix.basename(url.pathname, '.wasm')
  })
  for (const id of ['plugin.fs', 'plugin.layout', 'plugin.lua', 'plugin.respack']) assert.ok(pluginNames.includes(id), id)
  assert.equal(new Set(pluginNames).size, pluginNames.length)
  for (const id of ['view-files', 'view-code', 'view-bullet', 'view-ng', 'view-ng-node', 'files-rename', 'files-default']) {
    assert.ok(config.ui.views[id], id)
    assert.equal(typeof config.ui.views[id].internal, 'boolean', id)
  }
  for (const { url: source } of [config.ui.theme, ...Object.values(config.ui.services), ...Object.values(config.ui.views)]) {
    const url = new URL(source)
    assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'github.com')
    assert.match(url.pathname, /^\/kkgams\/[^/]+\/releases\/download\/v\d+\.\d+\.\d+\/[^/]+\.zip$/)
    assert.match(url.hash, /^#(?:views|ui-plugins|themes)\/[\w.-]+\.(?:js|css)$/)
  }
})

test('Bullet defaultSource and layout data-source files exist', async () => {
  const source = config.ui.views['view-bullet'].config.defaultSource
  assert.ok(patterns.includes(source)); await localFile(source)
  const layout = config.ui.services['ui-layout'].config.layout
  const sources = [...layout.matchAll(/data-source="([^"]+)"/g)].map(match => match[1])
  assert.ok(sources.includes(source))
  assert.ok(sources.includes('content/gams/graphs/bulletml.ng.json'))
  for (const name of sources) await localFile(name)
})

test('Files routes exact basenames before last extensions, not compound suffixes', () => {
  const routes = config.ui.views['view-files'].config.open
  const route = name => routes[path.posix.basename(name)] || routes[path.posix.extname(name).slice(1).toLowerCase()] || routes.default
  for (const source of patterns) assert.equal(route(source), 'view-bullet')
  assert.equal(route('content/gams/graphs/bulletml.ng.json'), 'view-ng')
  for (const source of ['schema/bulletml.rspk.json', 'other.bulletml.json', 'other.ng.json', 'nodes/code.lua', 'build.mjs', 'README.md']) assert.equal(route(source), 'view-code', source)
  assert.equal(route('unknown.bin'), 'files-default')
  for (const target of Object.values(routes)) assert.ok(config.ui.views[target], target)
})

test('nodegraph config supplies all required finite geometry, layout and RGBA colors', () => {
  const ng = config.ui.views['view-ng'].config
  color(ng.background, 'background')
  const fields = {
    node: ['width', 'headerHeight', 'portRowHeight', 'padding', 'radius', 'borderWidth', 'portRadius'],
    edge: ['width', 'selectedWidth', 'curveOffset'], text: ['size'],
  }
  for (const [section, names] of Object.entries(fields)) for (const name of names) {
    finite(ng.renderer[section][name], `${section}.${name}`)
    assert.ok(ng.renderer[section][name] > 0, `${section}.${name}`)
  }
  assert.equal(typeof ng.renderer.text.font, 'string'); assert.ok(ng.renderer.text.font.trim())
  for (const name of ['node', 'nodeHover', 'nodeSelected', 'nodeBorder', 'header', 'requiredHeader', 'text', 'textMuted', 'port', 'portHover', 'edge', 'edgeSelected', 'edgePreviewInvalid']) color(ng.renderer.theme[name], `theme.${name}`)
  for (const name of ['gridOriginX', 'gridOriginY', 'gridStepX', 'gridStepY']) finite(ng.layout[name], name)
})

test('presets and graph codePaths point to Project Lua scripts', async () => {
  const presets = config.ui.views['view-ng-node'].config.presets
  assert.ok(presets.length >= 2)
  for (const preset of presets) {
    assert.equal(preset.kind, 'code'); assert.equal(path.extname(preset.codePath), '.lua')
    await localFile(preset.codePath, 'content/gams/nodes/')
    assert.ok(graph.some(node => node.codePath === preset.codePath), preset.codePath)
    for (const input of preset.inputs) if (input.defaultValue !== undefined) JSON.parse(input.defaultValue)
  }
  for (const node of graph.filter(node => node.kind === 2)) {
    await localFile(node.codePath, 'content/gams/nodes/')
    assert.ok(presets.some(preset => preset.codePath === node.codePath), node.codePath)
  }
})

test('graph IDs, acyclic connections, Value JSON literals and input/output paths are valid', async () => {
  uniqueIds(graph, 'nodes')
  const byId = new Map(graph.map(node => [node.id, node]))
  for (const node of graph) {
    assert.ok([1, 2, 4].includes(node.kind), 'fixture is flattened')
    finite(node.x, 'node.x'); finite(node.y, 'node.y')
    uniqueIds(node.inputs, `${node.id} inputs`); uniqueIds(node.outputs, `${node.id} outputs`)
    for (const input of node.inputs) {
      const source = byId.get(input.srcNodeId)
      assert.ok(source, `source for ${node.id}.${input.id}`)
      assert.ok(source.outputs.some(output => output.id === input.srcOutputId), 'source output')
    }
    if (node.kind === 4) for (const output of node.outputs) {
      assert.equal(typeof output.value, 'string', 'Value output must be JSON literal text')
      const value = JSON.parse(output.value)
      if (output.name === 'paths') {
        assert.deepEqual([...value].sort(), [...patterns].sort())
        for (const name of value) await localFile(name, 'content/bulletml/')
      } else if (output.name === 'schemaPath') await localFile(value, 'content/gams/schema/')
      else {
        assert.equal(output.name, 'outputPath'); localPath(value, 'build.nosync/content/')
        assert.equal(path.extname(value), '.rspk')
      }
    }
  }
  const visited = new Set(), visiting = new Set()
  function visit(node) {
    assert.ok(!visiting.has(node.id), 'no cycles')
    if (visited.has(node.id)) return
    visiting.add(node.id)
    for (const input of node.inputs) visit(byId.get(input.srcNodeId))
    visiting.delete(node.id); visited.add(node.id)
  }
  const goals = graph.filter(node => node.kind === 1)
  assert.equal(goals.length, 1); assert.deepEqual(goals[0].inputs.map(input => input.name), ['path'])
  visit(goals[0]); assert.equal(visited.size, graph.length, 'all nodes contribute to the pack goal')
})

function validatePattern(pattern) {
  assert.ok(['none', 'vertical', 'horizontal'].includes(pattern.type))
  for (const name of ['bullets', 'actions', 'fires']) assert.ok(Array.isArray(pattern[name]) && pattern[name].length > 0, name)
  function expression(value) {
    assert.ok((typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.trim()), 'finite number or expression')
  }
  function reference(ref, targets) {
    const index = typeof ref === 'number' ? ref : ref.ref
    assert.ok(Number.isInteger(index) && index >= 0 && index < targets.length, `reference ${index}`)
    if (typeof ref === 'object') { assert.ok(Array.isArray(ref.params)); ref.params.forEach(expression) }
  }
  function motion(value, modes) { assert.ok(modes.includes(value.type)); expression(value.value) }
  for (const item of [...pattern.bullets, ...pattern.fires]) {
    motion(item.direction, ['aim', 'absolute', 'relative', 'sequence'])
    motion(item.speed, ['absolute', 'relative', 'sequence'])
  }
  for (const bullet of pattern.bullets) for (const ref of bullet.actionRefs ?? []) reference(ref, pattern.actions)
  for (const fire of pattern.fires) reference(fire.bulletRef, pattern.bullets)
  for (const action of pattern.actions) {
    assert.ok(Array.isArray(action) && action.length > 0)
    for (const command of action) {
      assert.equal(Object.keys(command).length, 1, 'oneof command')
      const [kind, value] = Object.entries(command)[0]
      if (kind === 'fireRef') reference(value, pattern.fires)
      else if (kind === 'actionRef') reference(value, pattern.actions)
      else if (kind === 'wait') expression(value)
      else if (kind === 'repeat') { expression(value.times); reference(value.actionRef, pattern.actions) }
      else assert.fail(`unexpected base fixture command: ${kind}`)
    }
  }
}

test('both base BulletML assets have valid actions, expressions and zero-based references', async () => {
  for (const name of patterns) validatePattern(await json(name))
  const schema = await json('content/gams/schema/bulletml.rspk.json')
  assert.deepEqual(schema.data, ['BulletPatterns'])
  assert.equal(schema.types.BulletPatterns.type, 'vector'); assert.equal(schema.types.BulletPatterns.value, 'BulletPattern')
})

test('ranger authored baseline retains its original cadence, parameters and 52 px/s speed', async () => {
  const ranger = await json(patterns[0])
  assert.deepEqual(ranger.actions[0], [{ repeat: { times: 1000000, actionRef: 1 } }])
  assert.deepEqual(ranger.actions[1], [{ wait: 30 }, { fireRef: { ref: 0, params: [-10] } }, { fireRef: { ref: 0, params: [0] } }, { fireRef: { ref: 0, params: [10] } }, { wait: 60 }])
  assert.deepEqual(ranger.fires[0].direction, { type: 'aim', value: '$1' })
  assert.equal(ranger.fires[0].bulletRef, 0)
  assert.deepEqual(ranger.bullets[0].actionRefs, [], 'host only accepts straight child bullets')
  for (const item of [ranger.bullets[0], ranger.fires[0]]) {
    assert.equal(item.speed.type, 'absolute'); assert.ok(Math.abs(item.speed.value * 60 - 52) < 1e-12)
  }
  const header = await read('game/patterns.h')
  assert.match(header, /SIM_PATTERN_HZ\s*=\s*60\b/)
  // Runtime timing/angles/speed parity against the original fixture is exercised
  // by pack.c and the native/WASM game integration, not C-source token snapshots.
})

test('content contains authored inputs, not generated packs/Odin or game/source trees', async () => {
  async function walk(directory) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const name = `${directory}/${entry.name}`
      assert.ok(!entry.isSymbolicLink(), `${name} must not pull in external content`)
      if (entry.isDirectory()) {
        assert.ok(!['game', 'source', 'build.nosync', 'gams_modules'].includes(entry.name), name)
        await walk(name)
      } else assert.ok(!/\.(?:rspk|odin|wasm|o|a)$|\.generated\.lua$/i.test(entry.name), name)
    }
  }
  await walk('content')
})

test('released View shim loads the canonical Project-owned compiler', async () => {
  const shim = await read('ng/compile-graph.lua')
  await localFile('content/gams/compile-graph.lua')
  assert.match(shim, /local\s+path\s*=\s*"content\/gams\/compile-graph\.lua"/)
  assert.match(shim, /host\.call\("fs\/fs::read-text",\s*path\)/)
  assert.match(shim, /load\(source,\s*"@"\s*\.\.\s*path,\s*"t",\s*_ENV\)/)
  assert.match(shim, /chunk\(\)/); assert.doesNotMatch(shim, /function\s+main\s*\(/)
  assert.match(await read('content/gams/compile-graph.lua'), /function\s+main\s*\(/)
})

test('componentPaths reproduces SHA256 URL cache names without installed modules', () => {
  const modules = path.join(tmpdir(), 'not-installed-content-components')
  const sources = ['plugin.fs', 'plugin.lua', 'plugin.respack'].map(name => config.plugins.find(source => new URL(source).pathname.endsWith(`/${name}.wasm`)))
  assert.deepEqual(componentPaths(config, modules), sources.map(source => path.join(modules, `${createHash('sha256').update(source).digest('hex')}.wasm`)))
  assert.deepEqual(componentPaths({ ...config, plugins: [...config.plugins].reverse() }, modules), componentPaths(config, modules))
})

test('componentPaths rejects missing, ambiguous and malformed required sources', () => {
  const source = config.plugins.find(source => source.endsWith('/plugin.fs.wasm'))
  const replace = value => ({ plugins: config.plugins.map(item => item === source ? value : item) })
  for (const invalid of [
    {}, { plugins: null }, { plugins: [] }, { plugins: config.plugins.filter(item => item !== source) },
    { plugins: [...config.plugins, source] }, { plugins: [...config.plugins, source.replace('/v0.2.0/', '/v9.9.9/')] },
    replace('not a URL'), replace(null), replace({ url: source }), replace(source.replace('https:', 'http:')),
    replace(`${source}#member`), replace(source.replace('.wasm', '.zip#plugin.fs.wasm')),
  ]) assert.throws(() => componentPaths(invalid, '/unused/modules'))
})

function minimalPack() {
  const bytes = Buffer.alloc(20)
  bytes.write('RSPK'); bytes.writeUInt16LE(1, 4); bytes.writeUInt16LE(1, 6)
  bytes.writeUInt32LE(16, 8); bytes.writeUInt32LE(4, 12); bytes.writeUInt32LE(2, 16)
  return bytes
}

test('verifyPack accepts minimal one-slot RSPK and bounded non-default offsets', () => {
  assert.equal(verifyPack(minimalPack()), 2)
  const padded = Buffer.alloc(28)
  minimalPack().copy(padded); padded.writeUInt32LE(24, 8); padded.writeUInt32LE(7, 24)
  assert.equal(verifyPack(padded), 7)
})

test('verifyPack rejects bad header/version/slot count/bounds and empty pattern count', () => {
  for (const length of [0, 4, 16, 19]) assert.throws(() => verifyPack(minimalPack().subarray(0, length)), /header/)
  const cases = [[0, 0], [4, 0], [4, 2], [6, 0], [6, 2], [8, 0], [8, 15], [8, 20], [8, 0xffffffff], [12, 0], [12, 3], [12, 5], [12, 0xffffffff], [16, 0]]
  for (const [offset, value] of cases) {
    const bytes = minimalPack()
    if (offset === 4 || offset === 6) bytes.writeUInt16LE(value, offset)
    else bytes.writeUInt32LE(value, offset)
    assert.throws(() => verifyPack(bytes), undefined, `offset ${offset}, value ${value}`)
  }
})

test('buildContent diagnoses missing Host/components using isolated temporary paths', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'game3-content-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  function run(host, modules) {
    const result = spawnSync(process.execPath, ['content/gams/build.mjs'], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, GAMS_HOST_BIN: host, GAMS_MODULES_DIR: modules },
    })
    assert.ifError(result.error); assert.notEqual(result.status, 0)
    return result.stderr
  }
  const modules = path.join(directory, 'missing-modules'), host = path.join(directory, 'missing-host')
  const hostError = run(host, modules)
  assert.ok(hostError.includes(`Missing GAMS Host: ${host}`)); assert.match(hostError, /GAMS_HOST_BIN/)
  // Node is executable but never invoked as a Host: missing components must
  // fail first, without reading or writing the user's gams_modules/config.
  const componentError = run(process.execPath, modules)
  assert.ok(componentError.includes(`Missing configured component: ${componentPaths(config, modules)[0]}`))
  assert.match(componentError, /reopen this Project in GAMS/)
  for (const invalid of ['', 'relative/modules']) assert.match(run(process.execPath, invalid), /GAMS_MODULES_DIR must be non-empty and absolute/)
})
