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

function tick() {
  try {
    if (!paused) {
      instance.exports.frame()
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
  status.textContent = 'Move the pointer vertically to rotate'
  document.body.dataset.state = 'ready'
  tick()
}

pauseButton.addEventListener('click', () => {
  paused = !paused
  pauseButton.textContent = paused ? 'Resume' : 'Pause'
})
reloadButton.addEventListener('click', async () => {
  cancelAnimationFrame(raf)
  try {
    instance.exports.cleanup()
    instance = null
    await boot()
  } catch (error) {
    fail(error)
  }
})
canvas.addEventListener('pointermove', (event) => {
  if (instance === null) return // Input before loading is expected.
  const bounds = canvas.getBoundingClientRect()
  instance.exports.mouse_move(
    (event.clientX - bounds.left) * canvas.width / bounds.width,
    (event.clientY - bounds.top) * canvas.height / bounds.height,
  )
})
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault()
  fail(new Error('WebGL context lost; refresh the page'))
})
new ResizeObserver(resize).observe(canvas)
boot().catch(fail)
