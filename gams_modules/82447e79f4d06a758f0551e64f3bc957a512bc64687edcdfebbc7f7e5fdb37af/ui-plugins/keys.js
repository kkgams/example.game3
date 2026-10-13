import { runtime, unwrap } from "/core/runtime.js"

function normalizeKeyEvent(event) {
  const parts = []
  if (event.ctrlKey || event.metaKey) parts.push("mod")
  if (event.shiftKey) parts.push("shift")
  if (event.altKey) parts.push("alt")

  const key = normalizeKeyName(event.key)
  if (key === "control" || key === "meta" || key === "shift" || key === "alt")
    return ""
  parts.push(key)
  return parts.join("+")
}

function normalizeConfiguredKey(key) {
  const parts = String(key)
    .trim()
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
  const modifiers = []
  if (parts.includes("mod") || parts.includes("cmdorctrl"))
    modifiers.push("mod")
  if (parts.includes("ctrl") || parts.includes("control"))
    modifiers.push("ctrl")
  if (parts.includes("cmd") || parts.includes("meta")) modifiers.push("meta")
  if (parts.includes("shift")) modifiers.push("shift")
  if (parts.includes("alt") || parts.includes("option")) modifiers.push("alt")
  const keyPart = [...parts]
    .reverse()
    .find(
      (part) =>
        ![
          "mod",
          "cmdorctrl",
          "ctrl",
          "control",
          "cmd",
          "meta",
          "shift",
          "alt",
          "option",
        ].includes(part),
    )
  if (!keyPart)
    throw new Error(`ui.keys key '${key}' is missing a non-modifier key`)
  if (modifiers.includes("ctrl") || modifiers.includes("meta")) {
    throw new Error(
      `ui.keys key '${key}' must use 'mod' instead of ctrl/cmd for browser shortcuts`,
    )
  }
  return [...modifiers, normalizeKeyName(keyPart)].join("+")
}

function normalizeKeyName(key) {
  const text = String(key).toLowerCase()
  if (text === " ") return "space"
  if (text === "esc") return "escape"
  if (text === "arrowup") return "up"
  if (text === "arrowdown") return "down"
  if (text === "arrowleft") return "left"
  if (text === "arrowright") return "right"
  return text
}

function isTextInputEvent(event) {
  for (const item of event.composedPath()) {
    if (!(item instanceof HTMLElement)) continue
    if (item instanceof HTMLInputElement) return true
    if (item instanceof HTMLTextAreaElement) return true
    if (item instanceof HTMLSelectElement) return true
    if (item.isContentEditable) return true
  }
  return false
}

function luaStringLiteral(value) {
  return JSON.stringify(String(value))
}

function blurActiveTextInput() {
  const element = document.activeElement
  if (!(element instanceof HTMLElement)) return false
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.isContentEditable
  ) {
    element.blur()
    return true
  }
  return false
}

function parseBindings(config) {
  const keys = config?.ui?.keys || []
  if (!Array.isArray(keys))
    throw new Error("gams config ui.keys must be an array")
  return keys.map((binding) => {
    return {
      ...binding,
      normalizedKey: normalizeConfiguredKey(binding.key),
      allowInput: binding.allowInput === true,
    }
  })
}

export function createUiKeys(config) {
  const bindings = parseBindings(config)
  const byKey = new Map()
  for (const binding of bindings) {
    if (!byKey.has(binding.normalizedKey)) byKey.set(binding.normalizedKey, [])
    byKey.get(binding.normalizedKey).push(binding)
  }

  async function snapshotContext(inTextInput) {
    const ctx = unwrap(await runtime.call("ui.context.snapshot"))
    ctx.key = { inTextInput }
    return ctx
  }

  async function runCall(callSpec, ctx) {
    const pluginId = callSpec[0].startsWith("activeView")
      ? callSpec[0].replace("activeView", ctx.activeView.id)
      : callSpec[0]
    unwrap(await runtime.call(String(pluginId), callSpec?.[1] || undefined))
  }

  async function dispatchScriptOutput(value, ctx) {
    if (value == null) return
    if (Array.isArray(value)) {
      for (const item of value) await dispatchScriptOutput(item, ctx)
      return
    }
    if (typeof value !== "object")
      throw new Error("shortcut script output must be null, object, or array")
    if (value.call != null) await runCall(value.call, ctx)
    if (value.calls != null)
      await dispatchScriptOutput(
        value.calls.map((call) => ({ call })),
        ctx,
      )
  }

  async function runBinding(binding, inTextInput) {
    const ctx = await snapshotContext(inTextInput)
    if (binding.call) {
      await runCall(binding.call, ctx)
      return
    }

    const readResult = unwrap(
      await runtime.invoke("fs/fs::read-text", binding.script),
    )
    const source = `_G.ctx = json.decode(${luaStringLiteral(JSON.stringify(ctx))})\n${readResult}`
    const runResult = JSON.parse(
      unwrap(await runtime.invoke("lua/lua::run", source)),
    )

    await dispatchScriptOutput(runResult, ctx)
  }

  const onKeyDown = (event) => {
    const normalizedKey = normalizeKeyEvent(event)
    const matches = byKey.get(normalizedKey)
    if (!matches || matches.length === 0) return
    const inTextInput = isTextInputEvent(event)
    const binding = matches.find((entry) => entry.allowInput || !inTextInput)
    if (!binding) return
    event.preventDefault()
    event.stopPropagation()
    void runBinding(binding, inTextInput)
  }

  window.addEventListener("keydown", onKeyDown, { capture: true })

  return {
    id: "ui.keys",
    dispose() {
      window.removeEventListener("keydown", onKeyDown, { capture: true })
    },
    methods: {
      ping: async () => ({ ok: { bindings: bindings.length } }),
      blurActiveElement: async () => ({ ok: { blurred: blurActiveTextInput() } }),
    },
  }
}
