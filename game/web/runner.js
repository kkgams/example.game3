import { GLBridge } from './gl-bridge.js'

const canvas = document.getElementById('canvas')
const pauseButton = document.getElementById('pause')
const reloadButton = document.getElementById('reload')
const status = document.getElementById('status')
const decoder = new TextDecoder()
let instance = null
let gl = null
let raf = 0
let paused = false
let frames = 0
let lastTime = null

function releaseInput() {
  lastTime = null
  if (instance !== null) instance.exports.release_keys()
}

function resize() {
  const scale = Math.min(window.devicePixelRatio, 4)
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale))
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale))
  if (instance !== null) instance.exports.resize(canvas.width, canvas.height)
}

function fail(error) {
  cancelAnimationFrame(raf)
  pauseButton.disabled = true
  reloadButton.disabled = true
  status.textContent = `Error: ${error.message}`
  document.body.dataset.state = 'error'
  console.error(error)
}

function tick(now) {
  try {
    if (!paused) {
      const elapsed = lastTime === null ? 0 : (now - lastTime) / 1000
      lastTime = now
      instance.exports.frame(elapsed)
      frames++
      canvas.dataset.frames = String(frames)
    }
    raf = requestAnimationFrame(tick)
  } catch (error) {
    fail(error)
  }
}

async function boot() {
  document.body.dataset.state = 'loading'
  status.textContent = 'Loading…'
  pauseButton.disabled = true
  reloadButton.disabled = true
  // Each reload uses fresh WASM memory (the imported prototype uses a bump heap).
  gl = canvas.getContext('webgl2', { alpha: false, depth: true, stencil: true, antialias: false })
  if (gl === null) throw new Error('WebGL2 is required')
  resize()
  const bridge = new GLBridge(gl, null)
  const response = await fetch('./triangle.wasm', { cache: 'no-store' })
  if (!response.ok) throw new Error(`triangle.wasm: HTTP ${response.status}`)
  const result = await WebAssembly.instantiate(await response.arrayBuffer(), {
    env: {
      ...bridge.createImportObject(),
      js_canvas_width: () => canvas.width,
      js_canvas_height: () => canvas.height,
      js_webgl_framebuffer: () => 0,
      game_log: (level, pointer, item) => {
        const bytes = new Uint8Array(bridge.memory.buffer)
        const message = pointer === 0 ? `Sokol log item ${item}` : decoder.decode(bytes.subarray(pointer, bytes.indexOf(0, pointer)))
        if (level <= 1) throw new Error(message)
        console.info(message)
      },
    },
  })
  instance = result.instance
  bridge.memory = instance.exports.memory
  instance.exports.init()
  resize()
  paused = false
  frames = 0
  pauseButton.textContent = 'Pause'
  pauseButton.disabled = false
  reloadButton.disabled = false
  status.textContent = 'WASD / arrows: move. Auto fire. Survive the waves and defeat the boss. Click a reward or press 1–6 (4 unlocks blades). R: restart after win or loss.'
  document.body.dataset.state = 'ready'
  lastTime = null
  canvas.focus({ preventScroll: true })
  raf = requestAnimationFrame(tick)
}

pauseButton.addEventListener('click', () => {
  paused = !paused
  releaseInput()
  if (!paused) canvas.focus({ preventScroll: true })
  pauseButton.textContent = paused ? 'Resume' : 'Pause'
})
reloadButton.addEventListener('click', async () => {
  cancelAnimationFrame(raf)
  releaseInput()
  try {
    instance.exports.cleanup()
    instance = null
    await boot()
  } catch (error) {
    fail(error)
  }
})
// Physical keys match game/app.h's stable scalar ABI, not browser keyCodes.
const movementKeys = new Map([
  ['KeyW', 0], ['KeyA', 1], ['KeyS', 2], ['KeyD', 3],
  ['ArrowUp', 4], ['ArrowLeft', 5], ['ArrowDown', 6], ['ArrowRight', 7],
])
function shortcutModifier(event) {
  return event.ctrlKey || event.metaKey || event.altKey ||
    ['MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight'].includes(event.code)
}
window.addEventListener('keydown', (event) => {
  if (instance === null) return
  // macOS may omit a movement key's keyup while Command is held. Never
  // retain movement across shortcut modifiers, including their release.
  if (shortcutModifier(event)) { releaseInput(); return }
  if (paused || document.hidden || document.activeElement !== canvas) return
  const upgrade = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(event.code)
  if (upgrade >= 0) {
    event.preventDefault()
    if (!event.repeat) { lastTime = null; instance.exports.choose_upgrade(upgrade) }
    return
  }
  if (event.code === 'KeyR') {
    event.preventDefault()
    if (!event.repeat) { releaseInput(); instance.exports.retry() }
    return
  }
  if (!movementKeys.has(event.code)) return
  event.preventDefault()
  instance.exports.key(movementKeys.get(event.code), 1)
})
window.addEventListener('keyup', (event) => {
  if (instance === null) return
  if (shortcutModifier(event)) { releaseInput(); return }
  if (!movementKeys.has(event.code)) return
  instance.exports.key(movementKeys.get(event.code), 0)
  if (document.activeElement === canvas) event.preventDefault()
})
canvas.addEventListener('pointerdown', event => {
  canvas.focus({ preventScroll: true })
  if (instance === null || paused || document.hidden || event.button !== 0 || shortcutModifier(event)) return
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return // Hidden/minimized canvas.
  event.preventDefault()
  lastTime = null
  instance.exports.choose_reward((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height)
})
canvas.addEventListener('blur', releaseInput)
window.addEventListener('blur', releaseInput)
document.addEventListener('visibilitychange', releaseInput)
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault()
  fail(new Error('WebGL context lost; refresh the page'))
})
new ResizeObserver(resize).observe(canvas)
boot().catch(fail)
