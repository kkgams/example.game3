import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const source = (await readFile(new URL('../game/web/runner.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/, '')

async function harness() {
  function target(fields = {}) {
    const listeners = new Map()
    return Object.assign(fields, {
      addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, [])
        listeners.get(name).push(callback)
      },
      async emit(name, fields = {}) {
        const event = { prevented: false, preventDefault() { this.prevented = true }, ...fields }
        for (const callback of listeners.get(name) ?? []) await callback(event)
        return event
      },
    })
  }
  const calls = []
  const exports = Object.fromEntries(['init', 'cleanup', 'resize', 'frame', 'key', 'release_keys', 'retry', 'choose_upgrade'].map(name =>
    [name, (...args) => calls.push([name, ...args])]))
  exports.memory = { buffer: new ArrayBuffer(64) }
  const canvas = target({clientWidth: 640, clientHeight: 480, dataset: {}, getContext: () => ({})})
  const pause = target({textContent: '', disabled: true})
  const reload = target({textContent: '', disabled: true})
  const status = {textContent: ''}
  const document = target({
    hidden: false, activeElement: null, body: {dataset: {}},
    getElementById: id => ({canvas, pause, reload, status})[id],
  })
  canvas.focus = () => { document.activeElement = canvas }
  const window = target({devicePixelRatio: 1})
  let nextId = 0
  const scheduled = new Map()
  vm.runInNewContext(source, {
    document, window, TextDecoder, console,
    GLBridge: class { createImportObject() { return {} } },
    WebAssembly: { instantiate: async () => ({instance: {exports}}) },
    fetch: async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(0)}),
    ResizeObserver: class { constructor(callback) { this.callback = callback } observe() { this.callback() } },
    requestAnimationFrame: callback => { scheduled.set(++nextId, callback); return nextId },
    cancelAnimationFrame: id => scheduled.delete(id),
  })
  await new Promise(setImmediate)
  assert.equal(document.body.dataset.state, 'ready')
  function tick(now) {
    const [id, callback] = scheduled.entries().next().value
    scheduled.delete(id)
    callback(now)
  }
  return {calls, canvas, pause, reload, window, document, tick}
}

test('browser runner uses physical movement keys only while the canvas is active', async () => {
  const h = await harness()
  for (const [index, code] of ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight'].entries()) {
    assert.equal((await h.window.emit('keydown', {code})).prevented, true)
    await h.window.emit('keyup', {code})
    assert.deepEqual(h.calls.slice(-2), [['key', index, 1], ['key', index, 0]])
  }
  const count = h.calls.filter(c => c[0] === 'key').length
  assert.equal((await h.window.emit('keydown', {code: 'KeyD', ctrlKey: true})).prevented, false)
  assert.deepEqual(h.calls.at(-1), ['release_keys'])
  await h.window.emit('keydown', {code: 'Space'})
  h.document.activeElement = h.pause
  assert.equal((await h.window.emit('keydown', {code: 'ArrowUp'})).prevented, false)
  assert.equal(h.calls.filter(c => c[0] === 'key').length, count, 'shortcuts and controls do not move the player')
  await h.canvas.emit('pointerdown')
  assert.equal(h.document.activeElement, h.canvas)
  await h.window.emit('keyup', {code: 'KeyD'})
  assert.deepEqual(h.calls.at(-1), ['key', 3, 0])
  await h.window.emit('keydown', {code: 'KeyR'})
  assert.deepEqual(h.calls.slice(-2), [['release_keys'], ['retry']])
  const retries = h.calls.filter(c => c[0] === 'retry').length
  await h.window.emit('keydown', {code: 'KeyR', repeat: true})
  assert.equal(h.calls.filter(c => c[0] === 'retry').length, retries, 'holding retry is not repeated')
  for (const [option, code] of ['Digit1', 'Digit2', 'Digit3'].entries()) {
    assert.equal((await h.window.emit('keydown', {code})).prevented, true)
    assert.deepEqual(h.calls.at(-1), ['choose_upgrade', option])
    const n = h.calls.length
    await h.window.emit('keydown', {code, repeat: true})
    assert.equal(h.calls.length, n, 'held choice cannot consume another level')
  }
  // macOS can suppress D keyup while Command is held. Modifier transitions
  // must clear D even when its keyup never arrives.
  await h.window.emit('keydown', {code: 'KeyD'})
  await h.window.emit('keydown', {code: 'MetaLeft', metaKey: true})
  await h.window.emit('keyup', {code: 'MetaLeft', metaKey: false})
  assert.deepEqual(h.calls.slice(-3), [['key', 3, 1], ['release_keys'], ['release_keys']])
})

test('browser clock supplies seconds and resets on pause, focus loss, hide and reload', async () => {
  const h = await harness()
  h.tick(1000)
  h.tick(1016)
  assert.deepEqual(h.calls.filter(c => c[0] === 'frame'), [['frame', 0], ['frame', .016]])
  await h.pause.emit('click')
  assert.deepEqual(h.calls.at(-1), ['release_keys'])
  h.tick(5000)
  assert.equal(h.calls.filter(c => c[0] === 'frame').length, 2, 'paused time is not simulated')
  await h.pause.emit('click')
  h.tick(9000)
  assert.deepEqual(h.calls.at(-1), ['frame', 0], 'no catch-up after pause')
  for (const [target, name] of [[h.canvas,'blur'], [h.window,'blur'], [h.document,'visibilitychange']]) {
    await target.emit(name)
    assert.deepEqual(h.calls.at(-1), ['release_keys'])
    h.tick(20000)
    assert.deepEqual(h.calls.at(-1), ['frame', 0])
  }
  h.document.hidden = true
  const count = h.calls.length
  await h.window.emit('keydown', {code: 'KeyD'})
  assert.equal(h.calls.length, count)
  h.document.hidden = false
  await h.reload.emit('click')
  assert.ok(h.calls.some(c => c[0] === 'cleanup'))
  h.tick(50000)
  assert.deepEqual(h.calls.at(-1), ['frame', 0], 'reload gets a fresh clock')
})
