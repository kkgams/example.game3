function parseOptions(input) {
    if (input == null || input === "") return {}
    if (typeof input === "string") return { content: input }
    return input
}

function encodeOK(value) {
    return { ok: value }
}

function assert(condition, message) {
    if (!condition) throw new Error(message)
}

function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function normalizeNumber(value, label) {
    const number = Number(value)
    assert(Number.isFinite(number), `ui.tooltip ${label} must be a finite number`)
    return number
}

function normalizeAabb(raw, label) {
    assert(isPlainObject(raw), `ui.tooltip ${label} must be an object`)
    const x = normalizeNumber(raw.x, `${label}.x`)
    const y = normalizeNumber(raw.y, `${label}.y`)
    const width = normalizeNumber(raw.width, `${label}.width`)
    const height = normalizeNumber(raw.height, `${label}.height`)
    assert(width >= 0, `ui.tooltip ${label}.width must be non-negative`)
    assert(height >= 0, `ui.tooltip ${label}.height must be non-negative`)
    return { kind: "aabb", x, y, width, height }
}

function normalizeAnchor(raw) {
    assert(isPlainObject(raw), "ui.tooltip anchor must be an object")
    const kind = String(raw.kind || "point")
    if (kind === "point") {
        return {
            kind,
            x: normalizeNumber(raw.x, "anchor.x"),
            y: normalizeNumber(raw.y, "anchor.y"),
        }
    }
    if (kind === "aabb") return normalizeAabb(raw, "anchor")
    if (kind === "mouse") return { kind }
    if (kind === "caret") {
        assert(raw.input instanceof HTMLInputElement || raw.input instanceof HTMLTextAreaElement, "ui.tooltip anchor.input must be a text input")
        const rect = raw.input.getBoundingClientRect()
        return { kind: "aabb", x: rect.left, y: rect.top, width: rect.width, height: rect.height }
    }
    throw new Error(`ui.tooltip unsupported anchor kind '${kind}'`)
}

function expandAabb(aabb, padding) {
    const amount = normalizeNumber(padding || 0, "trackPadding")
    return {
        kind: "aabb",
        x: aabb.x - amount,
        y: aabb.y - amount,
        width: aabb.width + amount * 2,
        height: aabb.height + amount * 2,
    }
}

function pointerInsideAabb(event, aabb) {
    return event.clientX >= aabb.x && event.clientX <= aabb.x + aabb.width && event.clientY >= aabb.y && event.clientY <= aabb.y + aabb.height
}

function textForSearch(item) {
    return [item.label, item.group, item.description, ...(item.keywords || [])].join(" ").toLowerCase()
}

function normalizeItems(items, path = "items", inheritedGroup = "") {
    assert(Array.isArray(items), `ui.tooltip ${path} must be an array`)
    const result = []
    items.forEach((rawItem, index) => {
        const item = Array.isArray(rawItem) ? { label: rawItem[0], value: rawItem[1] } : rawItem
        assert(isPlainObject(item), `ui.tooltip ${path}[${index}] must be an object`)
        const label = String(item.label || "").trim()
        assert(label.length > 0, `ui.tooltip ${path}[${index}].label must be non-empty`)
        const group = String(item.group || inheritedGroup || "").trim()
        if (item.items !== undefined) {
            result.push(...normalizeItems(item.items, `${path}[${index}].items`, label))
            return
        }
        const id = item.id == null || item.id === "" ? `${group}:${label}:${index}` : String(item.id)
        const keywords = item.keywords == null ? [] : item.keywords
        assert(Array.isArray(keywords), `ui.tooltip ${path}[${index}].keywords must be an array`)
        result.push({
            id,
            label,
            group,
            description: String(item.description || ""),
            keywords: keywords.map((keyword) => String(keyword)),
            disabled: item.disabled === true,
            value: Object.hasOwn(item, "value") ? item.value : item,
        })
    })
    return result
}

function uniqueGroups(items) {
    const groups = []
    for (const item of items) {
        const group = item.group || ""
        if (!groups.includes(group)) groups.push(group)
    }
    return groups
}

function selectedPayload(item) {
    return {
        id: item.id,
        label: item.label,
        group: item.group,
        description: item.description,
        keywords: item.keywords,
        disabled: item.disabled,
        value: item.value,
    }
}

export class TooltipManager extends HTMLElement {
    constructor() {
        super()
        this.nextTooltipId = 1
        this.api = {
            open: async (input) => await this.open(parseOptions(input)),
            contextMenu: async (input) => encodeOK(await this.openSelectable({ ...parseOptions(input), type: "context-menu" })),
            autocomplete: async (input) => encodeOK(await this.openSelectable({ searchable: true, ...parseOptions(input), type: "autocomplete" })),
            tip: async (input) => encodeOK(this.openTip({ ...parseOptions(input), type: "tip" })),
            close: async (input) => encodeOK(this.close(parseOptions(input))),
            closeAll: async () => encodeOK(this.closeAll()),
        }
    }

    connectedCallback() {
        this.style.display = "contents"
        this.style.isolation = "isolate"
    }

    async open(options = {}) {
        const type = String(options.type || "tip")
        if (type === "context-menu") return encodeOK(await this.openSelectable({ ...options, type }))
        if (type === "autocomplete") return encodeOK(await this.openSelectable({ searchable: true, ...options, type }))
        if (type === "tip") return encodeOK(this.openTip({ ...options, type }))
        throw new Error(`ui.tooltip unsupported type '${type}'`)
    }

    openTip(options = {}) {
        this.closeAll("replaced")
        const tooltip = this.createTooltip(options)
        this.appendChild(tooltip)
        tooltip.openTip(options)
        return { id: tooltip.tooltipId }
    }

    async openSelectable(options = {}) {
        this.closeAll("replaced")
        const tooltip = this.createTooltip(options)
        this.appendChild(tooltip)
        const promise = tooltip.promise
        tooltip.openSelectable(options)
        return await promise
    }

    createTooltip(options) {
        const tooltip = document.createElement("view-tooltip")
        tooltip.tooltipId = this.nextTooltipId++
        tooltip.dataset.tooltipType = String(options.type || "tip")
        return tooltip
    }

    close({ id, reason = "closed" } = {}) {
        if (id == null || id === "") {
            const top = this.querySelector("view-tooltip:last-of-type")
            if (!top) return { closed: 0 }
            top.close({ ok: false, cancelled: true, reason })
            return { closed: 1 }
        }
        const tooltip = Array.from(this.querySelectorAll("view-tooltip")).find((entry) => entry.tooltipId === Number(id))
        if (!tooltip) return { closed: 0 }
        tooltip.close({ ok: false, cancelled: true, reason })
        return { closed: 1 }
    }

    closeAll(reason = "close-all") {
        const tooltips = Array.from(this.querySelectorAll("view-tooltip"))
        tooltips.forEach((tooltip) => tooltip.close({ ok: false, cancelled: true, reason }))
        return { closed: tooltips.length }
    }
}

if (!customElements.get("tooltip-manager")) customElements.define("tooltip-manager", TooltipManager)

export class ViewTooltip extends HTMLElement {
    constructor() {
        super()
        this.tooltipId = 0
        this.anchor = null
        this.track = null
        this.items = []
        this.filteredItems = []
        this.selectedIndex = -1
        this.searchable = false
        this.closeOnSelect = true
        this.closeOnOutsidePointer = true
        this.closeWhenPointerLeavesTrack = false
        this.followPointer = false
        this.pointerOffsetX = 12
        this.pointerOffsetY = 16
        this._resolve = null
        this._closed = false
        this._query = ""
        this._onPointerDown = (event) => this.handlePointerDown(event)
        this._onPointerMove = (event) => this.handlePointerMove(event)
        this._onKeyDown = (event) => this.handleKeyDown(event)
    }

    get promise() {
        return new Promise((resolve) => {
            this._resolve = resolve
        })
    }

    connectedCallback() {
        this.tabIndex = -1
        this.style.position = "fixed"
        this.style.zIndex = "10000"
        this.style.display = "block"
    }

    disconnectedCallback() {
        this.removeGlobalListeners()
    }

    openTip(options = {}) {
        this.anchor = normalizeAnchor(options.anchor || { kind: "point", x: 0, y: 0 })
        this.track = options.track ? normalizeAabb(options.track, "track") : this.anchor.kind === "aabb" ? this.anchor : null
        if (this.track) this.track = expandAabb(this.track, options.trackPadding || 0)
        this.closeWhenPointerLeavesTrack = options.closeWhenPointerLeavesTrack !== false && Boolean(this.track)
        this.followPointer = options.followPointer === true || this.anchor.kind === "mouse"
        this.pointerOffsetX = Number(options.pointerOffsetX ?? 12)
        this.pointerOffsetY = Number(options.pointerOffsetY ?? 16)
        assert(Number.isFinite(this.pointerOffsetX), "ui.tooltip pointerOffsetX must be a finite number")
        assert(Number.isFinite(this.pointerOffsetY), "ui.tooltip pointerOffsetY must be a finite number")
        this.renderTip(options)
        this.position(options)
        this.addGlobalListeners({ pointerMove: this.closeWhenPointerLeavesTrack || this.followPointer, pointerDown: false, keyDown: options.closeOnEscape !== false })
        const duration = Number(options.duration || 0)
        if (duration > 0) window.setTimeout(() => this.close({ ok: true, reason: "duration" }), duration)
    }

    openSelectable(options = {}) {
        this.anchor = normalizeAnchor(options.anchor || { kind: "point", x: 0, y: 0 })
        this.items = normalizeItems(options.items || [])
        this.filteredItems = this.items.slice()
        this.searchable = options.searchable === true
        this.closeOnSelect = options.closeOnSelect !== false
        this.closeOnOutsidePointer = options.closeOnOutsidePointer !== false
        this.renderSelectable(options)
        this.position(options)
        this.addGlobalListeners({ pointerMove: false, pointerDown: this.closeOnOutsidePointer, keyDown: options.closeOnEscape !== false })
        if (options.focusOnOpen !== false) this.focusInitialElement()
    }

    addGlobalListeners({ pointerMove, pointerDown, keyDown }) {
        if (pointerMove) window.addEventListener("pointermove", this._onPointerMove, { capture: true })
        if (pointerDown) window.addEventListener("pointerdown", this._onPointerDown, { capture: true })
        if (keyDown) window.addEventListener("keydown", this._onKeyDown, { capture: true })
    }

    removeGlobalListeners() {
        window.removeEventListener("pointermove", this._onPointerMove, { capture: true })
        window.removeEventListener("pointerdown", this._onPointerDown, { capture: true })
        window.removeEventListener("keydown", this._onKeyDown, { capture: true })
    }

    renderTip(options) {
        this.textContent = ""
        const output = document.createElement("output")
        output.dataset.element = "tooltip-tip"
        output.setAttribute("part", "tip")
        const pre = document.createElement("pre")
        pre.dataset.element = "tooltip-tip-text"
        pre.textContent = String(options.content || options.message || "")
        output.appendChild(pre)
        this.appendChild(output)
    }

    renderSelectable(options) {
        this.textContent = ""
        if (this.searchable) {
            const search = document.createElement("input")
            search.type = "search"
            search.autocomplete = "off"
            search.autocorrect = "off"
            search.autocapitalize = "off"
            search.spellcheck = false
            search.placeholder = String(options.placeholder || "Search…")
            search.dataset.element = "tooltip-search"
            search.setAttribute("part", "search")
            search.addEventListener("input", () => {
                this._query = search.value.trim().toLowerCase()
                this.applyFilter()
            })
            this.appendChild(search)
        }

        const menu = document.createElement("menu")
        menu.setAttribute("role", "menu")
        menu.dataset.element = "tooltip-menu"
        this.appendChild(menu)
        this.applyFilter()
    }

    applyFilter() {
        this.filteredItems = this._query ? this.items.filter((item) => textForSearch(item).includes(this._query)) : this.items.slice()
        const firstEnabled = this.filteredItems.findIndex((item) => !item.disabled)
        this.selectedIndex = firstEnabled
        this.renderMenuItems()
    }

    renderMenuItems() {
        const menu = this.querySelector('menu[data-element="tooltip-menu"]')
        if (!menu) return
        menu.textContent = ""
        for (const group of uniqueGroups(this.filteredItems)) {
            const groupItems = this.filteredItems.filter((item) => (item.group || "") === group)
            const parent = group ? document.createElement("li") : menu
            const groupMenu = group ? document.createElement("menu") : menu
            if (group) {
                const label = document.createElement("label")
                label.textContent = group
                parent.appendChild(label)
                groupMenu.setAttribute("role", "group")
                parent.appendChild(groupMenu)
                menu.appendChild(parent)
            }
            for (const item of groupItems) this.appendMenuItem(groupMenu, item)
        }
    }

    appendMenuItem(parent, item) {
        const index = this.filteredItems.indexOf(item)
        const li = document.createElement("li")
        const button = document.createElement("button")
        button.type = "button"
        button.setAttribute("role", "menuitem")
        button.textContent = item.label
        button.disabled = item.disabled
        button.dataset.tooltipItemIndex = String(index)
        if (index === this.selectedIndex) button.setAttribute("aria-selected", "true")
        button.addEventListener("pointerover", () => {
            if (item.disabled) return
            if (this.selectedIndex === index) return
            this.selectedIndex = index
            this.renderMenuItems()
        })
        button.addEventListener("click", (event) => {
            event.preventDefault()
            event.stopPropagation()
            this.selectIndex(index)
        })
        li.appendChild(button)
        parent.appendChild(li)
    }

    focusInitialElement() {
        const search = this.querySelector('input[data-element="tooltip-search"]')
        if (search) {
            search.focus()
            return
        }
        this.focus()
    }

    handlePointerDown(event) {
        if (this.contains(event.target)) return
        this.close({ ok: false, cancelled: true, reason: "outside-pointer" })
    }

    handlePointerMove(event) {
        if (this.track && !pointerInsideAabb(event, this.track)) {
            this.close({ ok: false, cancelled: true, reason: "pointer-left-track" })
            return
        }
        if (this.followPointer) this.positionAtPoint(event.clientX + this.pointerOffsetX, event.clientY + this.pointerOffsetY)
    }

    handleKeyDown(event) {
        if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            this.close({ ok: false, cancelled: true, reason: "escape" })
            return
        }
        if (!this.querySelector('menu[data-element="tooltip-menu"]')) return
        if (event.key === "ArrowDown") {
            event.preventDefault()
            this.moveSelection(1)
            return
        }
        if (event.key === "ArrowUp") {
            event.preventDefault()
            this.moveSelection(-1)
            return
        }
        if (event.key === "Enter") {
            event.preventDefault()
            this.selectIndex(this.selectedIndex)
            return
        }
        if (event.key === "Tab") {
            event.preventDefault()
            this.moveFocus(event.shiftKey ? -1 : 1)
        }
    }

    focusableElements() {
        return Array.from(this.querySelectorAll('input[data-element="tooltip-search"], button[role="menuitem"]')).filter(
            (element) => !element.disabled && !element.hidden,
        )
    }

    moveFocus(delta) {
        const elements = this.focusableElements()
        if (!elements.length) return
        const currentIndex = elements.indexOf(document.activeElement)
        const nextIndex = currentIndex < 0 ? 0 : (currentIndex + delta + elements.length) % elements.length
        const nextElement = elements[nextIndex]
        nextElement.focus()
        if (nextElement.getAttribute("role") === "menuitem") {
            const itemIndex = Number(nextElement.dataset.tooltipItemIndex)
            if (Number.isInteger(itemIndex)) this.selectedIndex = itemIndex
            this.renderMenuItems()
            const refreshedButton = this.querySelector(`button[data-tooltip-item-index="${itemIndex}"]`)
            if (refreshedButton) refreshedButton.focus()
        }
    }

    moveSelection(delta) {
        const enabled = this.filteredItems.map((item, index) => ({ item, index })).filter((entry) => !entry.item.disabled)
        if (!enabled.length) return
        const currentEnabledIndex = enabled.findIndex((entry) => entry.index === this.selectedIndex)
        const nextEnabledIndex = currentEnabledIndex < 0 ? 0 : (currentEnabledIndex + delta + enabled.length) % enabled.length
        this.selectedIndex = enabled[nextEnabledIndex].index
        this.renderMenuItems()
    }

    selectIndex(index) {
        const item = this.filteredItems[index]
        if (!item || item.disabled) return
        const result = { ok: true, selected: selectedPayload(item) }
        if (this.closeOnSelect) this.close(result)
        else if (this._resolve) this._resolve(result)
    }

    position(options = {}) {
        const minWidth = Number(options.minWidth || 220)
        const maxHeight = String(options.maxHeight || "60vh")
        this.style.minWidth = `${minWidth}px`
        this.style.maxHeight = maxHeight
        this.style.overflow = "auto"
        this.hidden = true
        let x = 0
        let y = 0
        const placement = String(options.placement || "bottom")
        if (this.anchor.kind === "point") {
            x = this.anchor.x + (this.followPointer ? this.pointerOffsetX : 0)
            y = this.anchor.y + (this.followPointer ? this.pointerOffsetY : 0)
        } else if (this.anchor.kind === "aabb") {
            x = this.anchor.x
            if (placement === "top") y = this.anchor.y
            else y = this.anchor.y + this.anchor.height
        } else if (this.anchor.kind === "mouse") {
            x = 0
            y = 0
        }
        this.style.left = `${Math.round(x)}px`
        this.style.top = `${Math.round(y)}px`
        this.hidden = false
        const rect = this.getBoundingClientRect()
        let left = x
        let top = y
        if (placement === "top" && this.anchor.kind === "aabb") top = this.anchor.y - rect.height
        if (placement === "right" && this.anchor.kind === "aabb") {
            left = this.anchor.x + this.anchor.width
            top = this.anchor.y
        }
        if (placement === "left" && this.anchor.kind === "aabb") {
            left = this.anchor.x - rect.width
            top = this.anchor.y
        }
        this.positionAtPoint(left, top)
    }

    positionAtPoint(x, y) {
        const rect = this.getBoundingClientRect()
        this.style.left = `${Math.max(0, Math.round(Math.min(x, window.innerWidth - rect.width)))}px`
        this.style.top = `${Math.max(0, Math.round(Math.min(y, window.innerHeight - rect.height)))}px`
    }

    close(result = { ok: false, cancelled: true, reason: "closed" }) {
        if (this._closed) return
        this._closed = true
        this.removeGlobalListeners()
        if (this._resolve) this._resolve(result)
        this.remove()
    }
}

if (!customElements.get("view-tooltip")) customElements.define("view-tooltip", ViewTooltip)
