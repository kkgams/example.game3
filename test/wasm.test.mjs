import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { GLBridge } from '../game/web/gl-bridge.js'

const bytes = await readFile(new URL('../build.nosync/web/triangle.wasm', import.meta.url))
const module = await WebAssembly.compile(bytes)

test('WASM imports and exports match the standalone runner', () => {
  const exports = new Set(WebAssembly.Module.exports(module).map(x => x.name))
  for (const name of ['memory', 'init', 'frame', 'cleanup', 'resize', 'key', 'release_keys', 'retry', 'choose_upgrade']) {
    assert.ok(exports.has(name), `missing export ${name}`)
  }
  const imports = new GLBridge({}, null).createImportObject()
  for (const entry of WebAssembly.Module.imports(module)) {
    assert.equal(entry.module, 'env')
    assert.ok(entry.name in imports || ['js_canvas_width', 'js_canvas_height', 'js_webgl_framebuffer', 'game_log'].includes(entry.name), `missing import ${entry.name}`)
  }
})

test('real WASM initializes, draws, resizes and cleans up through a mock GPU', async () => {
  // This exercises C/WASM/JS ABI, not a real shader compiler or pixel rendering.
  const header = await readFile(new URL('../game/web/wasm-include/GLES3/gl3.h', import.meta.url), 'utf8')
  const constants = Object.fromEntries([...header.matchAll(/#define GL_(\w+)\s+(0x[\da-fA-F]+|\d+)/g)].map(m => [m[1], Number(m[2])]))
  const calls = []
  let currentProgram = null
  const gl = new Proxy(constants, {
    get(target, name) {
      if (name in target) return target[name]
      return (...args) => {
        // Snapshot uploads: WASM may reuse stack memory after this call.
        calls.push([name, ...args.map(a => ArrayBuffer.isView(a) ? Array.from(a) : a)])
        if (name.startsWith('create')) return { kind: name }
        if (name === 'getError') return 0
        if (name === 'getParameter') return args[0] === constants.CURRENT_PROGRAM ? currentProgram : 16
        if (name === 'getShaderParameter' || name === 'getProgramParameter') return true
        if (name === 'getShaderInfoLog' || name === 'getProgramInfoLog') return ''
        if (name === 'getUniformLocation') return { name: args[1] }
        if (name === 'shaderSource') args[0].source = args[1]
        if (name === 'attachShader') (args[0].shaders ??= []).push(args[1])
        if (name === 'getAttribLocation') {
          const attrs = args[0].shaders.flatMap(s => [...s.source.matchAll(/layout\(location = (\d+)\) in \w+ (\w+);/g)])
          const attr = attrs.find(m => m[2] === args[1])
          assert.ok(attr, `shader attribute ${args[1]} must be present`)
          return Number(attr[1])
        }
        if (name === 'getSupportedExtensions') return []
        if (name === 'useProgram') currentProgram = args[0]
      }
    },
  })
  const bridge = new GLBridge(gl, null)
  let width = 640, height = 480
  const instance = await WebAssembly.instantiate(module, { env: {
    ...bridge.createImportObject(),
    js_canvas_width: () => width,
    js_canvas_height: () => height,
    js_webgl_framebuffer: () => 0,
    game_log: (level, pointer, item) => assert.ok(level > 2, `Sokol error/warning ${item} at ${pointer}`),
  } })
  bridge.memory = instance.exports.memory
  instance.exports.init()
  instance.exports.resize(width, height)
  instance.exports.frame(0)
  const draws = calls.filter(c => c[0] === 'drawElementsInstanced')
  assert.equal(draws.length, 2, 'tilemap batch and player/HUD sprite batch')
  assert.deepEqual(draws.map(c => [c[2], c[5]]), [[6, 2], [6, 45]])
  const uniforms = calls.filter(c => c[0] === 'uniform4fv')
  assert.equal(uniforms.length, 2)
  assert.ok(Math.abs(uniforms[0][2][0] - 2 / 320) < 0.00001, 'pixel-space projection')
  assert.ok(Math.abs(uniforms[0][2][5] - 2 / 240) < 0.00001)
  assert.equal(uniforms[1][2][10], 2, 'WebGL remaps portable 0..1 depth into -1..1 clip Z')
  assert.equal(uniforms[1][2][14], -1)
  const tileAttrs = calls.filter(c => c[0] === 'vertexAttribPointer' && c[5] === 64)
  assert.deepEqual(tileAttrs.map(c => [c[1], c[2], c[6]]), [
    [1, 2, 0], [2, 2, 8], [3, 4, 16], [4, 4, 32], [5, 2, 48], [6, 2, 56],
  ], 'all tilemap instance attributes have the correct slot, size and byte offset')
  // Integer attributes must not pass through normalized float pointers.
  assert.ok(calls.some(c => c[0] === 'vertexAttribIPointer' && c[2] === 1 && c[3] === constants.UNSIGNED_INT && c[4] === 60 && c[5] === 16))
  assert.ok(calls.some(c => c[0] === 'vertexAttribIPointer' && c[2] === 2 && c[3] === constants.INT && c[4] === 60 && c[5] === 52))
  assert.ok(calls.some(c => c[0] === 'vertexAttribDivisor' && c[2] === 1))
  const uploads = calls.filter(c => c[0] === 'bufferSubData').slice(-2)
  assert.deepEqual(uploads.map(c => c[3].length), [2 * 64, 45 * 60])
  function player() {
    const upload = calls.filter(c => c[0] === 'bufferSubData').at(-1)
    const view = new DataView(Uint8Array.from(upload[3]).buffer)
    return { x: view.getFloat32(0, true), y: view.getFloat32(4, true), flip: view.getUint32(16, true) }
  }
  const start = player()
  assert.deepEqual(start, {x: -80, y: 0, flip: 0})
  // WASD + arrow aliases remain independent, opposing directions cancel,
  // repeated keydown is idempotent, blur clears held keys.
  instance.exports.key(0, 1) // W
  instance.exports.key(4, 1) // Up
  instance.exports.key(0, 0)
  instance.exports.frame(.125)
  assert.ok(Math.abs(player().y - 8) < .001, 'arrow still held after releasing W')
  instance.exports.key(2, 1) // S opposes Up
  instance.exports.frame(.125)
  assert.ok(Math.abs(player().y - 8) < .001, 'opposing bindings cancel')
  instance.exports.release_keys()
  instance.exports.key(3, 1) // D
  instance.exports.key(3, 1) // repeat
  instance.exports.frame(.125)
  assert.ok(Math.abs(player().x - (start.x + 8)) < .001)
  instance.exports.release_keys()
  const stopped = player()
  instance.exports.frame(.125)
  assert.deepEqual(player(), stopped, 'focus loss releases all keys')
  instance.exports.key(1, 1) // A
  instance.exports.frame(.125)
  assert.equal(player().flip, 1, 'player faces left')
  instance.exports.release_keys()
  instance.exports.retry()
  instance.exports.frame(0)
  assert.equal(player().flip, 1, 'retry does not reset a living run')
  assert.throws(() => instance.exports.key(8, 1), WebAssembly.RuntimeError, 'invalid internal key ABI traps')
  assert.throws(() => instance.exports.frame(-1), WebAssembly.RuntimeError, 'invalid elapsed time traps')
  assert.ok(calls.some(c => c[0] === 'texImage2D' && c[4] === 128 && c[5] === 64 && c[9].length === 128 * 64 * 4))
  width = 800; height = 600
  instance.exports.resize(width, height)
  instance.exports.frame(0)
  assert.ok(calls.some(c => c[0] === 'viewport' && c[3] === 800 && c[4] === 600))
  const beforeMinimize = calls.filter(c => c[0] === 'drawElementsInstanced').length
  width = 0; height = 0
  instance.exports.resize(width, height)
  instance.exports.frame(.125)
  assert.equal(calls.filter(c => c[0] === 'drawElementsInstanced').length, beforeMinimize, 'minimized framebuffer skips drawing')
  instance.exports.cleanup()
  assert.equal(bridge.programs.size, 0)
  assert.equal(bridge.buffers.size, 0)
  assert.equal(bridge.textures.size, 0)
  assert.equal(bridge.samplers.size, 0)
  assert.equal(calls.filter(c => c[0] === 'deleteProgram').length, 2)
  // Reload uses a new instance/memory in the runner; reinitialization also
  // exercises explicit renderer cleanup without relying only on sg_shutdown.
  width = 640; height = 480
  instance.exports.init()
  instance.exports.frame(0)
  assert.deepEqual(player(), start, 'reload resets player position and facing')
  let sawEnemy = false, sawBullet = false, sawGem = false, sawLevel = false, died = false
  function spriteUpload() {
    return new DataView(Uint8Array.from(calls.findLast(c => c[0] === 'bufferSubData')[3]).buffer)
  }
  function hudText() {
    const view = spriteUpload()
    let text = ''
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    for (let offset = 0; offset < view.byteLength; offset += 60) {
      const u = view.getFloat32(offset + 20, true), v = view.getFloat32(offset + 24, true)
      if (u < .5) continue
      text += alphabet[Math.round((u * 128 - 64) / 8) + 8 * Math.round(v * 64 / 8)]
    }
    return text
  }
  for (let i = 0; i < 400; ++i) {
    instance.exports.frame(.25)
    const upload = spriteUpload()
    for (let offset = 60; offset < upload.byteLength; offset += 60) {
      const u = upload.getFloat32(offset + 20, true), v = upload.getFloat32(offset + 24, true)
      if (u === .25 && v === 0) sawEnemy = true
      if (u === .375 && v === 0) sawBullet = true
      if (u === .375 && v === .5) sawGem = true
    }
    if (hudText().includes('LEVELUP')) {
      sawLevel = true
      const frozen = calls.findLast(c => c[0] === 'bufferSubData')[3]
      instance.exports.key(3, 1)
      instance.exports.frame(10)
      assert.deepEqual(calls.findLast(c => c[0] === 'bufferSubData')[3], frozen, 'level-up pauses the entire world')
      instance.exports.choose_upgrade(2) // Speed: keep baseline weapon for the death test.
      instance.exports.frame(0)
      assert.ok(!hudText().includes('LEVELUP'), 'choice resumes gameplay')
      const resumed = player()
      instance.exports.frame(0)
      assert.deepEqual(player(), resumed, 'choosing clears held movement')
    }
    if (upload.getFloat32(48, true) === 1) { died = true; break }
  }
  assert.ok(sawEnemy, 'chasing enemies are rendered')
  assert.ok(sawBullet, 'automatic projectiles are rendered')
  assert.ok(sawGem, 'XP gems are rendered')
  assert.ok(sawLevel, 'collected XP presents an upgrade choice')
  assert.ok(died, 'idle player eventually loses to incoming enemies')
  assert.match(hudText(), /^HPKILLS[1-9][0-9]*LV[2-9][0-9]*XP[0-9]+OF[0-9]+YOUDIEDRRETRY$/, 'level, XP, kills and retry result are visible')
  const deadPlayer = player(), deadHud = hudText()
  instance.exports.key(3, 1)
  instance.exports.frame(.25)
  assert.deepEqual(player(), deadPlayer, 'death freezes movement')
  assert.equal(hudText(), deadHud)
  instance.exports.retry()
  instance.exports.frame(0)
  assert.deepEqual(player(), start, 'R retry resets position, facing and held keys')
  assert.equal(hudText(), 'HPKILLS0LV1XP0OF3AUTOFIRE')
  instance.exports.frame(.25)
  assert.deepEqual(player(), start, 'retry releases movement held at death')
  instance.exports.cleanup()
  assert.equal(bridge.programs.size, 0)
})
