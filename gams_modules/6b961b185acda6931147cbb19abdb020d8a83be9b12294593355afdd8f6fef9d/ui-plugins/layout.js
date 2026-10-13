import { ensureThemeStylesheetLink } from "/util/add-style.js"
import { runtime, unwrap } from "/core/runtime.js"

function resultOk(value) {
    return { ok: value }
}

function parseLayoutInput(input) {
    if (typeof input === "string") return input
    if (input == null) return ""
    if (typeof input === "object" && !Array.isArray(input)) {
        if (typeof input.layout === "string") return input.layout
        if (typeof input.layoutMarkup === "string") return input.layoutMarkup
    }
    throw new Error("ui.layout.load input must be a layout string or object with layout/layoutMarkup")
}

const DEFAULT_VIEW_GROUP_LABEL = "Main"

export class ViewEmpty extends HTMLElement {
    connectedCallback() {
        this.style.display = "grid"
        this.style.placeItems = "center"
        this.style.minHeight = "100%"
        this.style.padding = "16px"
        this.style.color = "var(--text-muted)"
        const label = this.getAttribute("data-view-label") || "Empty"
        const tag = this.getAttribute("data-view-tag") || "view-empty"
        this.innerHTML = `
      <div style="text-align:center; display:grid; gap:8px;">
        <strong style="color:var(--text);">${label}</strong>
        <span>${tag}</span>
      </div>
    `
    }
}

export class ViewArea extends HTMLElement {
    static get observedAttributes() {
        return ["x", "y", "w", "h", "panel"]
    }

    constructor() {
        super()
        this._x = 0
        this._y = 0
        this._w = 0
        this._h = 0
        this._panel = "unknown"
        this._selectorReady = false

        const shadowRoot = this.attachShadow({ mode: "open" })
        shadowRoot.innerHTML = `<link rel="stylesheet" href="/css/reset.css">
      <link rel="stylesheet" href="/css/base.css">
      <header part="header">
        <select part="view-select" name="view" data-action="select-view" class="view-selector"></select>
        <slot name="header-controls" part="header-controls"></slot>
      </header>
      <main><slot></slot></main>`
    }

    connectedCallback() {
        this.setupViewSelector()
        this._updatePosition()
        this.refreshViewSelector()
        ensureThemeStylesheetLink(this.shadowRoot)

        // Set position style
        this.style.position = "absolute"
    }

    attributeChangedCallback(name, _oldVal, newVal) {
        if (name === "x") this._x = parseFloat(newVal)
        if (name === "y") this._y = parseFloat(newVal)
        if (name === "w") this._w = parseFloat(newVal)
        if (name === "h") this._h = parseFloat(newVal)
        if (name === "panel") this._panel = newVal
        this._updatePosition()
    }

    set x(v) {
        this.setAttribute("x", v)
    }
    set y(v) {
        this.setAttribute("y", v)
    }
    set w(v) {
        this.setAttribute("w", v)
    }
    set h(v) {
        this.setAttribute("h", v)
    }
    set panel(v) {
        this.setAttribute("panel", v)
    }

    get x() {
        return this._x
    }
    get y() {
        return this._y
    }
    get w() {
        return this._w
    }
    get h() {
        return this._h
    }
    get panel() {
        return this._panel
    }

    getCurrentView() {
        return this.shadowRoot.querySelector("slot:not([name])")?.assignedElements?.()[0] || this.firstElementChild || null
    }

    getCurrentViewTag() {
        const currentView = this.getCurrentView()
        if (!currentView) return "view-empty"
        return currentView.getAttribute("data-view-tag") || currentView.tagName.toLowerCase()
    }

    requireOwner() {
        if (!this.owner) {
            throw new Error("view-area owner is not set")
        }
        return this.owner
    }

    setView(viewNode) {
        const currentView = this.getCurrentView()
        if (currentView) this.replaceChild(viewNode, currentView)
        else this.appendChild(viewNode)
        this.refreshViewSelector()
    }

    async switchView(viewTag) {
        const owner = this.requireOwner()
        const newView = await owner.createView(viewTag)
        this.setView(newView)
    }

    setupViewSelector() {
        if (this._selectorReady) return
        this._selectorReady = true
        const select = this.shadowRoot.querySelector('[data-action="select-view"]')
        select.addEventListener("change", (event) => {
            if (event.target.value) void this.switchView(event.target.value)
        })
    }

    refreshViewSelector() {
        const select = this.shadowRoot.querySelector('[data-action="select-view"]')
        if (!select) return

        const owner = this.requireOwner()
        const currentTag = this.getCurrentViewTag()

        select.innerHTML = ""
        const optionGroups = new Map()
        for (const [tag, entry] of [...owner.viewRegistry.entries()]) {
            if (entry.internal === true) continue
            const groupName = entry.group || DEFAULT_VIEW_GROUP_LABEL
            if (!optionGroups.has(groupName)) {
                const node = document.createElement("optgroup")
                node.label = groupName
                optionGroups.set(groupName, node)
            }
            const optGroup = optionGroups.get(groupName)

            const option = document.createElement("option")
            option.value = tag
            option.textContent = entry.label || tag
            optGroup.appendChild(option)
        }

        for (const node of optionGroups.values()) {
            select.appendChild(node)
        }

        select.value = currentTag
    }

    _updatePosition() {
        this.style.left = `${this._x}px`
        this.style.top = `${this._y}px`
        this.style.width = `${this._w}px`
        this.style.height = `${this._h}px`
    }
}

class Corner extends HTMLElement {}

class Handle extends HTMLElement {
    static get observedAttributes() {
        return ["x", "y", "w", "h", "panel"]
    }

    constructor() {
        super()
        this._x = 0
        this._y = 0
        this._w = 0
        this._h = 0
        this._panel = "unknown"
    }

    connectedCallback() {
        this.style.position = "absolute"
        this._updatePosition()
    }

    attributeChangedCallback(name, _oldVal, newVal) {
        if (name === "x") this._x = parseFloat(newVal)
        if (name === "y") this._y = parseFloat(newVal)
        if (name === "w") this._w = parseFloat(newVal)
        if (name === "h") this._h = parseFloat(newVal)
        if (name === "panel") this._panel = newVal
        this._updatePosition()
    }

    set x(v) {
        this.setAttribute("x", v)
    }
    set y(v) {
        this.setAttribute("y", v)
    }
    set w(v) {
        this.setAttribute("w", v)
    }
    set h(v) {
        this.setAttribute("h", v)
    }
    set panel(v) {
        this.setAttribute("panel", v)
    }

    get x() {
        return this._x
    }
    get y() {
        return this._y
    }
    get w() {
        return this._w
    }
    get h() {
        return this._h
    }
    get panel() {
        return this._panel
    }

    _updatePosition() {
        this.style.left = `${this._x}px`
        this.style.top = `${this._y}px`
        this.style.width = `${this._w}px`
        this.style.height = `${this._h}px`
    }
}

export class UiLayout extends HTMLElement {
    constructor() {
        super()
        this.document = {
            "screen-w": 1,
            "screen-h": 1,
            config: {
                "max-areas": 16,
                "max-handles": 15,
                "min-panel-size": 120,
                "handle-half-size": 6,
            },
        }

        this.viewRegistry = new Map()
        this.content = new Map()
        this.contentCounter = 0
        this.handles = []
        this.lastGeneration = -1
        this.tryRectEl = null
        this.cornerDrag = {
            active: false,
            contentId: -1,
            cornerIndex: -1,
            x: 0,
            y: 0,
            lastX: Number.NaN,
            lastY: Number.NaN,
            raf: 0,
        }

        this.api = {
            refresh: async () => {
                this.render()
                return resultOk({ ok: true, generation: this.lastGeneration })
            },
            ping: async () => resultOk({ ok: true, generation: this.lastGeneration }),
            load: async (input) => {
                await this.load(parseLayoutInput(input))
                return resultOk({ ok: true, generation: this.lastGeneration })
            },
        }

        this.resizeObserver = new ResizeObserver(async (entries) => {
            for (const entry of entries) {
                if (entry.target !== this) continue
                const width = Math.max(64, Math.floor(entry.contentRect.width || 0))
                const height = Math.max(64, Math.floor(entry.contentRect.height || 0))
                if (!width || !height) continue

                if (await this.resizeScreen(width, height)) {
                    this.render()
                }
            }
        })
    }

    connectedCallback() {
        this.style.isolation = "isolate"
        this.style.position = "fixed"
        this.style.inset = "0"
        this.style.display = "block"
        this.style.overflow = "hidden"
        this.style.background = "var(--bg)"
        this.resizeObserver.observe(this)
    }

    disconnectedCallback() {
        this.resizeObserver.disconnect()
        this.stopCornerPreview()
    }

    async callLayout(method, ...args) {
        const result = unwrap(await runtime.invoke(`layout/layout::${method}`, ...args), `Layout::${method}`)
        this.document = result.document
    }

    async initScreen(w, h, contentId) {
        await this.callLayout("init-screen", {
            w,
            h,
            config: this.document.config,
            "root-content-id": `${contentId}`,
        })
    }

    async resizeScreen(w, h) {
        if (!this.document.handles) {
            console.log("exit?")
            return false
        }
        await this.callLayout("resize-screen", {
            w,
            h,
            "handle-half-size": 6,
            document: this.document,
        })
        return true
    }

    clampPoint(x, y, inclusiveMax = false) {
        const maxX = inclusiveMax ? this.document["screen-w"] : Math.max(0, this.document["screen-w"] - 1)
        const maxY = inclusiveMax ? this.document["screen-h"] : Math.max(0, this.document["screen-h"] - 1)

        return {
            x: Math.max(0, Math.min(maxX, Math.floor(x))),
            y: Math.max(0, Math.min(maxY, Math.floor(y))),
        }
    }

    async moveHandle(contentId, x, y) {
        await this.callLayout("move-handle", {
            "handle-content-id": `${contentId}`,
            document: this.document,
            ...this.clampPoint(x, y, true),
        })
    }

    async moveCorner(contentId, cornerIndex, x, y, newId) {
        const p = this.clampPoint(x, y, false)
        await this.callLayout("move-corner", {
            "area-content-id": `${contentId}`,
            "new-area-content-id": `${newId}`,
            "new-handle-content-id": `handle_${newId}`,
            "corner-index": cornerIndex,
            document: this.document,
            ...p,
        })
    }

    async tryCorner(contentId, cornerIndex, x, y) {
        await this.callLayout("try-corner", {
            "area-content-id": `${contentId}`,
            "corner-index": cornerIndex,
            document: this.document,
            ...this.clampPoint(x, y, false),
        })
    }

    setViewRegistry(registry) {
        this.viewRegistry = registry
        for (const chrome of this.content.values()) {
            chrome.refreshViewSelector?.()
        }
    }

    async createView(tag, attrs = {}, innerHTML = "") {
        const entry = this.viewRegistry.get(tag) || null
        const viewNode = typeof entry?.create === "function" ? await entry.create({ tag, attrs, innerHTML, layout: this }) : document.createElement(tag)
        for (const [name, value] of Object.entries(attrs || {})) {
            if (name === "setup") continue
            if (!viewNode.hasAttribute?.(name)) viewNode.setAttribute?.(name, value)
        }
        if (innerHTML && !viewNode.innerHTML) viewNode.innerHTML = innerHTML
        return viewNode
    }

    async instantiateView(spec) {
        const viewNode = await this.createView(spec.tag, spec.attrs || {}, spec.innerHTML || "")
        for (const [name, value] of Object.entries(spec.attrs || {})) {
            if (name === "setup") continue
            viewNode.setAttribute(name, value)
        }
        viewNode.innerHTML = spec.innerHTML || ""
        return viewNode
    }

    async cloneViewNode(node) {
        const clone = await this.createView(node.tagName.toLowerCase())
        for (const attr of Array.from(node.attributes || [])) {
            clone.setAttribute(attr.name, attr.value)
        }
        clone.innerHTML = node.innerHTML || ""
        return clone
    }

    createChromeForViewNode(viewNode, contentId) {
        const chrome = document.createElement("view-area")
        chrome.owner = this
        chrome.panel = contentId
        chrome.appendChild(viewNode)
        chrome.refreshViewSelector()
        this.addCorners(chrome, contentId)
        this.content.set(contentId, chrome)
        this.appendChild(chrome)
        return chrome
    }

    async createChromeForViewSpec(spec, contentId) {
        const viewNode = await this.instantiateView(spec)
        return this.createChromeForViewNode(viewNode, contentId)
    }

    ensureTryRect() {
        if (this.tryRectEl) return
        this.tryRectEl = document.createElement("div")
        this.tryRectEl.className = "layout-try-rect"
        this.tryRectEl.style.display = "none"
        this.appendChild(this.tryRectEl)
    }

    startCornerPreview(contentId, cornerIndex, x, y) {
        this.cornerDrag.active = true
        this.cornerDrag.contentId = contentId
        this.cornerDrag.cornerIndex = cornerIndex
        this.cornerDrag.x = x
        this.cornerDrag.y = y
        this.cornerDrag.lastX = Number.NaN
        this.cornerDrag.lastY = Number.NaN
        this.ensureTryRect()
        this.scheduleCornerTry()
    }

    updateCornerPreview(x, y) {
        if (!this.cornerDrag.active) return
        this.cornerDrag.x = x
        this.cornerDrag.y = y
        this.scheduleCornerTry()
    }

    scheduleCornerTry() {
        if (this.cornerDrag.raf !== 0) return
        this.cornerDrag.raf = requestAnimationFrame(async () => {
            this.cornerDrag.raf = 0
            if (!this.cornerDrag.active) return
            if (this.cornerDrag.x === this.cornerDrag.lastX && this.cornerDrag.y === this.cornerDrag.lastY) return
            await this.tryCorner(this.cornerDrag.contentId, this.cornerDrag.cornerIndex, this.cornerDrag.x, this.cornerDrag.y)
            this.cornerDrag.lastX = this.cornerDrag.x
            this.cornerDrag.lastY = this.cornerDrag.y
            this.render()
        })
    }

    stopCornerPreview() {
        this.cornerDrag.active = false
        if (this.cornerDrag.raf !== 0) {
            cancelAnimationFrame(this.cornerDrag.raf)
            this.cornerDrag.raf = 0
        }
        if (this.tryRectEl) this.tryRectEl.style.display = "none"
    }

    spawnHandle() {
        const node = document.createElement("view--handle")
        makeHandleDraggable(this, node, async (x, y) => {
            await this.moveHandle(node.panel, x, y)
            this.render()
        })
        this.handles.push(node)
        this.appendChild(node)
        return node
    }

    ensureChrome(contentId) {
        let chrome = this.content.get(contentId)
        if (chrome) return chrome
        chrome = this.createChromeForViewNode(document.createElement("view-empty"), contentId)
        return chrome
    }

    addCorners(node, contentId) {
        if (node.dataset.cornersReady) return
        node.dataset.cornersReady = "1"
        ;["nw", "ne", "se", "sw"].forEach((c, cornerId) => {
            const s = document.createElement("view--corner")
            s.classList.add(c)
            makeCornerDraggable(
                this,
                s,
                async (x, y) => {
                    await this.moveCorner(contentId, cornerId, x, y, ++this.contentCounter)
                    this.stopCornerPreview()
                    this.render()
                },
                {
                    onStart: (x, y) => {
                        this.startCornerPreview(contentId, cornerId, x, y)
                    },
                    onMove: (x, y) => this.updateCornerPreview(x, y),
                    onCancel: () => {
                        this.stopCornerPreview()
                        this.render()
                    },
                },
            )
            node.appendChild(s)
        })
    }

    parseSetup(setup, index) {
        const parts = String(setup).split(":")
        if (parts.length !== 3) throw new Error(`layout child ${index}: invalid setup format '${setup}'`)

        const [targetText, axis, percentText] = parts
        const target = Number.parseInt(targetText, 10)
        const percent = Number.parseInt(percentText, 10)

        if (!Number.isInteger(target) || target < 0) throw new Error(`layout child ${index}: invalid target '${targetText}'`)
        if (axis !== "v" && axis !== "h") throw new Error(`layout child ${index}: invalid axis '${axis}'`)
        if (!Number.isInteger(percent) || percent <= 0 || percent >= 100) {
            throw new Error(`layout child ${index}: invalid percent '${percentText}'`)
        }

        return { target, axis, percent: 100 - percent }
    }

    splitPointForArea(area, axis, percent) {
        const width = area.x1 - area.x0
        const height = area.y1 - area.y0
        const splitX = area.x0 + Math.floor(width * (percent / 100))
        const splitY = area.y0 + Math.floor(height * (percent / 100))

        if (axis === "h") {
            return {
                corner: 0,
                x: splitX,
                y: Math.min(area.y1 - 1, area.y0 + 1),
            }
        }

        return {
            corner: 0,
            x: Math.min(area.x1 - 1, area.x0 + 1),
            y: splitY,
        }
    }

    async load(layoutData) {
        const markup = String(layoutData || "").trim()
        if (!markup) throw new Error("layout markup is required")

        const parser = new DOMParser()
        const xmlDoc = parser.parseFromString(`<layout>${markup}</layout>`, "text/xml")
        const parseError = xmlDoc.querySelector("parsererror")
        if (parseError) {
            throw new Error(`invalid layout markup: ${parseError.textContent?.trim() || "parse error"}`)
        }

        const sourceSpecs = xmlDoc.childNodes[0].childNodes
        const specs = [...sourceSpecs]
            .filter((n) => n.nodeType === 1)
            .map((n) => ({
                tag: n.tagName,
                attrs: Object.fromEntries([...n.attributes].map((attr) => [attr.name, attr.value])),
                innerHTML: n.innerHTML || "",
            }))

        if (specs.length === 0) throw new Error("root view must be defined")
        if (specs[0].attrs.setup) throw new Error("layout child 0: root view cannot define setup")

        this.stopCornerPreview()
        this.replaceChildren()
        this.content.clear()
        this.handles.length = 0
        this.tryRectEl = null
        this.contentCounter = 45

        const width = Math.max(64, Math.floor(this.clientWidth || window.innerWidth || 0))
        const height = Math.max(64, Math.floor(this.clientHeight || window.innerHeight || 0))

        let contentId = `${++this.contentCounter}`
        const areas = [contentId]
        await this.initScreen(width, height, contentId)
        await this.createChromeForViewSpec(specs[0], contentId)

        for (let i = 1; i < specs.length; i += 1) {
            const spec = specs[i]
            const { setup } = spec.attrs
            if (!setup) throw new Error(`layout child ${i}: missing setup`)

            const { target, axis, percent } = this.parseSetup(setup, i)

            const split = this.splitPointForArea(this.document.areas[target].bounds, axis, percent)
            contentId = `${++this.contentCounter}`
            areas.push(contentId)
            await this.moveCorner(areas[target], split.corner, split.x, split.y, contentId)
            await this.createChromeForViewSpec(spec, contentId)
        }

        this.render()
    }

    render() {
        const activeContent = new Set()
        const { areas, handles } = this.document

        for (let i = 0; i < areas.length; i += 1) {
            const bounds = areas[i].bounds
            const contentId = areas[i]["content-id"]
            const node = this.ensureChrome(contentId)
            activeContent.add(contentId)
            node.x = bounds.x0
            node.y = bounds.y0
            node.w = bounds.x1 - bounds.x0
            node.h = bounds.y1 - bounds.y0
            node.panel = contentId
            node.refreshViewSelector?.()
        }

        for (const [contentId, node] of [...this.content.entries()]) {
            if (activeContent.has(contentId)) continue
            node.remove()
            this.content.delete(contentId)
        }

        while (this.handles.length < handles.length) this.spawnHandle()
        for (let id = 0; id < handles.length; id += 1) {
            const item = handles[id].bounds
            const node = this.handles[id]
            node.x = item.x0
            node.y = item.y0
            node.w = item.x1 - item.x0
            node.h = item.y1 - item.y0
            node.panel = handles[id]["content-id"]
        }
        for (let i = handles.length; i < this.handles.length; i += 1) this.handles[i]?.remove()
        this.handles.length = handles.length

        if (this.cornerDrag.active && this.document.preview.valid) {
            const tr = this.document.preview.bounds
            this.ensureTryRect()
            this.tryRectEl.style.display = "block"
            this.tryRectEl.style.left = `${tr.x0}px`
            this.tryRectEl.style.top = `${tr.y0}px`
            this.tryRectEl.style.width = `${Math.max(1, tr.x1 - tr.x0)}px`
            this.tryRectEl.style.height = `${Math.max(1, tr.y1 - tr.y0)}px`
        } else if (this.tryRectEl) {
            this.tryRectEl.style.display = "none"
        }

        this.lastGeneration = this.document.generation
    }
}

function makeCornerDraggable(host, handleEl, callback, options = {}) {
    handleEl.style.touchAction = "none"
    handleEl.style.userSelect = "none"
    let dragging = false
    let pointerId = null

    const toHostLocal = (clientX, clientY) => {
        const r = host.getBoundingClientRect()
        return { x: Math.floor(clientX - r.left), y: Math.floor(clientY - r.top) }
    }

    const cleanup = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onCancel)
    }

    const onMove = (e) => {
        if (!dragging || e.pointerId !== pointerId) return
        const cur = toHostLocal(e.clientX, e.clientY)
        if (typeof options.onMove === "function") options.onMove(cur.x, cur.y)
    }

    const onUp = (e) => {
        if (!dragging || e.pointerId !== pointerId) return
        dragging = false
        try {
            handleEl.releasePointerCapture(pointerId)
        } catch {}
        cleanup()
        const local = toHostLocal(e.clientX, e.clientY)
        callback(local.x, local.y)
    }

    const onCancel = (e) => {
        if (!dragging || e.pointerId !== pointerId) return
        dragging = false
        try {
            handleEl.releasePointerCapture(pointerId)
        } catch {}
        cleanup()
        if (typeof options.onCancel === "function") options.onCancel()
    }

    handleEl.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return
        e.preventDefault()
        dragging = true
        pointerId = e.pointerId
        const start = toHostLocal(e.clientX, e.clientY)
        if (typeof options.onStart === "function") options.onStart(start.x, start.y)
        handleEl.setPointerCapture(pointerId)
        window.addEventListener("pointermove", onMove, { passive: false })
        window.addEventListener("pointerup", onUp, { passive: false })
        window.addEventListener("pointercancel", onCancel, { passive: false })
    })
}

function makeHandleDraggable(host, handleEl, callback) {
    handleEl.style.touchAction = "none"
    handleEl.style.userSelect = "none"
    let dragging = false
    let pointerId = null

    const toHostLocal = (clientX, clientY) => {
        const r = host.getBoundingClientRect()
        return { x: clientX - r.left, y: clientY - r.top }
    }

    const cleanup = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onUp)
    }

    const onMove = (e) => {
        if (!dragging || e.pointerId !== pointerId) return
        const local = toHostLocal(e.clientX, e.clientY)
        callback(local.x, local.y)
    }

    const onUp = (e) => {
        if (!dragging || e.pointerId !== pointerId) return
        dragging = false
        try {
            handleEl.releasePointerCapture(pointerId)
        } catch {}
        cleanup()
        const local = toHostLocal(e.clientX, e.clientY)
        callback(local.x, local.y)
    }

    handleEl.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return
        e.preventDefault()
        dragging = true
        pointerId = e.pointerId
        handleEl.setPointerCapture(pointerId)
        window.addEventListener("pointermove", onMove, { passive: false })
        window.addEventListener("pointerup", onUp, { passive: false })
        window.addEventListener("pointercancel", onUp, { passive: false })
    })
}

if (!customElements.get("view-empty")) customElements.define("view-empty", ViewEmpty)
if (!customElements.get("view-area")) customElements.define("view-area", ViewArea)
if (!customElements.get("view--corner")) customElements.define("view--corner", Corner)
if (!customElements.get("view--handle")) customElements.define("view--handle", Handle)
if (!customElements.get("ui-layout")) customElements.define("ui-layout", UiLayout)
