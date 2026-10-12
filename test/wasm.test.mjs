import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { GLBridge } from '../game/web/gl-bridge.js'

const bytes = await readFile(new URL('../build.nosync/web/triangle.wasm', import.meta.url))
const module = await WebAssembly.compile(bytes)

test('WASM imports and exports match the standalone runner', () => {
  const exports = new Set(WebAssembly.Module.exports(module).map(x => x.name))
  for (const name of ['memory', 'init', 'frame', 'cleanup', 'resize', 'mouse_move']) {
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
        calls.push([name, ...args])
        if (name.startsWith('create')) return { kind: name }
        if (name === 'getError') return 0
        if (name === 'getParameter') return args[0] === constants.CURRENT_PROGRAM ? currentProgram : 16
        if (name === 'getShaderParameter' || name === 'getProgramParameter') return true
        if (name === 'getShaderInfoLog' || name === 'getProgramInfoLog') return ''
        if (name === 'getUniformLocation') return { name: args[1] }
        if (name === 'getAttribLocation') return args[1] === 'position' ? 0 : 1
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
    game_log: (level, pointer, item) => assert.ok(level > 1, `Sokol error ${item} at ${pointer}`),
  } })
  bridge.memory = instance.exports.memory
  instance.exports.init()
  instance.exports.resize(width, height)
  instance.exports.mouse_move(100, 240)
  instance.exports.frame()
  assert.ok(calls.some(c => c[0] === 'drawArrays' && c[3] === 3))
  const uniform = calls.find(c => c[0] === 'uniform4fv')
  assert.ok(uniform, 'rotation uniform reached JS')
  assert.ok(Math.abs(uniform[2][0] - Math.PI) < 0.0001)
  width = 800; height = 600
  instance.exports.resize(width, height)
  instance.exports.mouse_move(100, 300)
  instance.exports.frame()
  assert.ok(calls.some(c => c[0] === 'viewport' && c[3] === 800 && c[4] === 600))
  instance.exports.cleanup()
  assert.ok(calls.some(c => c[0] === 'deleteProgram'))
})
