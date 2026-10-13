function parseOptions(input) {
    if (input == null || input === "") return {}
    if (typeof input === "string") {
        return { message: input }
    }

    return input
}

function encodeOK(value) {
    return { ok: value }
}

const TOAST_POSITIONS = new Set(["primary", "secondary", "modal"])

function assertOptions(input, method, allowedKeys) {
    if (input == null || typeof input !== "object" || Array.isArray(input)) {
        throw new Error(`ui.toast.${method} input must be an object`)
    }

    for (const key of Object.keys(input)) {
        if (!allowedKeys.has(key)) throw new Error(`ui.toast.${method} does not accept '${key}'`)
    }
}

function assertMessage(message, method) {
    if (typeof message !== "string" || message.trim().length === 0) {
        throw new Error(`ui.toast.${method} message must be a non-empty string`)
    }
}

function assertProgress(progress, method) {
    if (progress === null) return
    if (typeof progress !== "number" || !Number.isFinite(progress) || progress < 0 || progress > 1) {
        throw new Error(`ui.toast.${method} progress must be null or a finite number from 0 through 1`)
    }
}

function assertProgressId(id, method) {
    if (typeof id !== "string" || id.length === 0) {
        throw new Error(`ui.toast.${method} id must be a non-empty string`)
    }
}

function assertDuration(duration, method) {
    if (!Number.isInteger(duration) || duration < 0) {
        throw new Error(`ui.toast.${method} duration must be a non-negative integer`)
    }
}

export class ToastManager extends HTMLElement {
    constructor() {
        super()

        this.observer = null
        this.progressToasts = new Map()
        this.api = {
            show: async (input) => {
                this.show(parseOptions(input))
                return encodeOK(true)
            },
            success: async (input) => {
                this.show({ ...parseOptions(input), type: "success" })
                return encodeOK(true)
            },
            error: async (input) => {
                this.show({ ...parseOptions(input), type: "error" })
                return encodeOK(true)
            },
            warning: async (input) => {
                this.show({ ...parseOptions(input), type: "warning" })
                return encodeOK(true)
            },
            info: async (input) => {
                this.show({ ...parseOptions(input), type: "info" })
                return encodeOK(true)
            },
            progressStart: async (input) => encodeOK(this.progressStart(input)),
            progressUpdate: async (input) => {
                this.progressUpdate(input)
                return encodeOK(true)
            },
            progressSuccess: async (input) => {
                this.progressSuccess(input)
                return encodeOK(true)
            },
            progressError: async (input) => {
                this.progressError(input)
                return encodeOK(true)
            },
            progressClose: async (input) => {
                this.progressClose(input)
                return encodeOK(true)
            },
            alert: async (input) => encodeOK(await this.alert(parseOptions(input))),
            confirm: async (input) => encodeOK(await this.confirm(parseOptions(input))),
            closeAll: async (input) => {
                const options = parseOptions(input)
                this.closeAll(options.position)
                return encodeOK(true)
            },
        }
    }

    connectedCallback() {
        this.style.display = "contents"
        this.style.isolation = "isolate"

        this.observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === "childList") {
                    this.updateVisibility()
                }
            })
        })

        this.observer.observe(this, {
            childList: true,
            subtree: false,
        })

        this.updateVisibility()
    }

    disconnectedCallback() {
        if (this.observer) {
            this.observer.disconnect()
        }
    }

    updateVisibility() {
        const toasts = Array.from(this.querySelectorAll("view-toast"))
        const byPosition = {
            primary: [],
            secondary: [],
            modal: [],
        }

        toasts.forEach((toast) => {
            const pos = toast.getAttribute("position") || "primary"
            if (byPosition[pos]) {
                byPosition[pos].push(toast)
            }
        })

        byPosition.primary.forEach((toast, index) => {
            toast.removeAttribute("hidden")
            toast.style.setProperty("--toast-stack-index", index)
        })

        byPosition.secondary.forEach((toast, index, arr) => {
            if (index === arr.length - 1) toast.removeAttribute("hidden")
            else toast.setAttribute("hidden", "")
        })

        byPosition.modal.forEach((toast, index, arr) => {
            if (index === arr.length - 1) toast.removeAttribute("hidden")
            else toast.setAttribute("hidden", "")
        })
    }

    show({ message = "", type = "info", duration = 3000, position = "primary" } = {}) {
        const toast = document.createElement("view-toast")
        toast.setAttribute("type", type)
        toast.setAttribute("position", position)
        toast.setAttribute("duration", duration.toString())
        toast.setAttribute("mode", "toast")
        toast.textContent = message
        this.appendChild(toast)
        return toast
    }

    progressStart(input) {
        const method = "progressStart"
        assertOptions(input, method, new Set(["message", "progress", "position"]))
        assertMessage(input.message, method)

        const progress = Object.hasOwn(input, "progress") ? input.progress : null
        assertProgress(progress, method)

        const position = Object.hasOwn(input, "position") ? input.position : "modal"
        if (!TOAST_POSITIONS.has(position)) {
            throw new Error(`ui.toast.${method} position must be 'primary', 'secondary', or 'modal'`)
        }

        const id = crypto.randomUUID()
        const toast = document.createElement("view-toast")
        toast.setAttribute("type", "info")
        toast.setAttribute("position", position)
        toast.setAttribute("duration", "0")
        toast.setAttribute("mode", "progress")
        toast.textContent = input.message
        this.appendChild(toast)
        toast.setProgress(progress)
        this.progressToasts.set(id, toast)
        toast.addEventListener(
            "toast-closing",
            () => {
                this.progressToasts.delete(id)
            },
            { once: true },
        )
        return { id }
    }

    progressUpdate(input) {
        const method = "progressUpdate"
        assertOptions(input, method, new Set(["id", "message", "progress"]))
        assertProgressId(input.id, method)
        if (!Object.hasOwn(input, "message") && !Object.hasOwn(input, "progress")) {
            throw new Error(`ui.toast.${method} requires message or progress`)
        }
        if (Object.hasOwn(input, "message")) assertMessage(input.message, method)
        if (Object.hasOwn(input, "progress")) assertProgress(input.progress, method)

        const toast = this.getProgressToast(input.id, method)
        toast.assertActiveProgress(method)
        if (Object.hasOwn(input, "message")) toast.setMessage(input.message)
        if (Object.hasOwn(input, "progress")) toast.setProgress(input.progress)
    }

    progressSuccess(input) {
        this.finishProgress(input, "progressSuccess", "success", 1000)
    }

    progressError(input) {
        this.finishProgress(input, "progressError", "error", 0)
    }

    finishProgress(input, method, type, defaultDuration) {
        assertOptions(input, method, new Set(["id", "message", "duration"]))
        assertProgressId(input.id, method)
        if (Object.hasOwn(input, "message")) assertMessage(input.message, method)
        const duration = Object.hasOwn(input, "duration") ? input.duration : defaultDuration
        assertDuration(duration, method)

        const toast = this.getProgressToast(input.id, method)
        toast.finishProgress({
            type,
            message: Object.hasOwn(input, "message") ? input.message : null,
            duration,
        })
    }

    progressClose(input) {
        const method = "progressClose"
        assertOptions(input, method, new Set(["id"]))
        assertProgressId(input.id, method)
        this.getProgressToast(input.id, method).close(null)
    }

    getProgressToast(id, method) {
        const toast = this.progressToasts.get(id)
        if (!toast) throw new Error(`ui.toast.${method} references unknown progress id '${id}'`)
        return toast
    }

    async alert({ message = "", type = "info", buttonText = "OK" } = {}) {
        const toast = document.createElement("view-toast")
        toast.setAttribute("type", type)
        toast.setAttribute("position", "modal")
        toast.setAttribute("duration", "0")
        toast.setAttribute("mode", "alert")
        toast.setAttribute("confirm-text", buttonText)
        toast.textContent = message
        this.appendChild(toast)
        return await toast.promise
    }

    async confirm({ message = "", type = "info", confirmText = "Confirm", cancelText = "Cancel" } = {}) {
        const toast = document.createElement("view-toast")
        toast.setAttribute("type", type)
        toast.setAttribute("position", "modal")
        toast.setAttribute("duration", "0")
        toast.setAttribute("mode", "confirm")
        toast.setAttribute("confirm-text", confirmText)
        toast.setAttribute("cancel-text", cancelText)
        toast.textContent = message
        this.appendChild(toast)
        return await toast.promise
    }

    closeAll(position) {
        const selector = position ? `view-toast[position="${position}"]` : "view-toast"
        const toasts = this.querySelectorAll(selector)
        toasts.forEach((toast) => toast.close(false))
    }

    get toasts() {
        return Array.from(this.querySelectorAll("view-toast"))
    }

    get toastCount() {
        return this.querySelectorAll("view-toast").length
    }
}

if (!customElements.get("toast-manager")) {
    customElements.define("toast-manager", ToastManager)
}

/**
 * Toast Component
 *
 * Individual toast notification with auto-dismiss, hover pause, and action buttons.
 * Supports four modes: toast (simple notification), alert (requires acknowledgment), confirm (yes/no),
 * and progress (service-owned indeterminate/determinate operation status).
 *
 * Attributes:
 * - type: 'info' | 'success' | 'warning' | 'error' (default: 'info')
 * - position: 'primary' | 'secondary' | 'modal' (default: 'primary')
 * - duration: number in ms (default: 3000, 0 = no auto-dismiss)
 * - mode: 'toast' | 'alert' | 'confirm' | 'progress' (default: 'toast')
 */

const TYPE_TO_INTENT = {
    info: "info",
    success: "success",
    warning: "warning",
    error: "danger",
}

const TOAST_TEMPLATE_HTML = {
    toast: `
    <span data-element="message"></span>
    <button part="close" type="button" data-action="close" aria-label="Close"><i style="font-size: inherit;">close</i></button>
  `,
    alert: `
    <div class="toast-container">
      <span data-element="message"></span>
      <div class="toast-actions">
        <button class="accent" data-action="confirm" data-element="confirm-button">OK</button>
      </div>
    </div>
  `,
    confirm: `
    <div class="toast-container">
      <span data-element="message"></span>
      <div class="toast-actions">
        <button data-action="cancel" data-element="cancel-button">Cancel</button>
        <button class="accent" data-action="confirm" data-element="confirm-button">Confirm</button>
      </div>
    </div>
  `,
    progress: `
    <div class="toast-container">
      <span data-element="message"></span>
      <progress data-element="progress" max="1"></progress>
      <button part="close" type="button" data-action="close" aria-label="Close" hidden><i style="font-size: inherit;">close</i></button>
    </div>
  `,
}

const TOAST_TEMPLATES = Object.fromEntries(
    Object.entries(TOAST_TEMPLATE_HTML).map(([mode, html]) => {
        const template = document.createElement("template")
        template.innerHTML = html
        return [mode, template]
    }),
)

function cloneTemplateForMode(mode) {
    const template = TOAST_TEMPLATES[mode] || TOAST_TEMPLATES.toast
    return template.content.cloneNode(true)
}

export class ViewToast extends HTMLElement {
    constructor() {
        super()

        this.isClosing = false
        this.timerId = null
        this.remainingTime = 0
        this.startTime = 0
        this.isPaused = false
        this.progressState = null

        // Promise resolver for alert/confirm modes
        this._resolve = null
    }

    connectedCallback() {
        this.render()
        this.setupEventHandlers()
        this.startTimer()

        // Animate in
        this.animateIn()
    }

    disconnectedCallback() {
        this.clearTimer()
    }

    /**
     * Get duration from attribute (default 3000ms, 0 = no auto-dismiss)
     */
    get duration() {
        const dur = parseInt(this.getAttribute("duration"), 10)
        return isNaN(dur) ? 3000 : dur
    }

    /**
     * Get mode from attribute
     */
    get mode() {
        return this.getAttribute("mode") || "toast"
    }

    /**
     * Get type from attribute
     */
    get type() {
        return this.getAttribute("type") || "info"
    }

    /**
     * Get position from attribute
     */
    get position() {
        return this.getAttribute("position") || "primary"
    }

    /**
     * Promise that resolves when toast is dismissed (for alert/confirm)
     */
    get promise() {
        if (this._promise) return this._promise

        this._promise = new Promise((resolve) => {
            this._resolve = resolve
        })

        return this._promise
    }

    /**
     * Render toast structure using HTML templates
     */
    render() {
        // Get message from innerHTML before clearing
        const message = this.textContent.trim()

        // Clear current content
        this.innerHTML = ""

        // Apply intent class from type (info→.info, success→.success, error→.danger)
        this.applyIntent(this.type)

        // Set position attribute for CSS
        if (!this.hasAttribute("position")) {
            this.setAttribute("position", "primary")
        }

        // Clone mode template from local JS constants
        const templateContent = cloneTemplateForMode(this.mode)

        // Set message
        const messageElement = templateContent.querySelector('[data-element="message"]')
        if (messageElement) {
            messageElement.textContent = message
        }

        if (this.mode === "progress") {
            this.progressState = "active"
            const messageId = `toast-progress-message-${crypto.randomUUID()}`
            messageElement.id = messageId
            templateContent.querySelector('[data-element="progress"]').setAttribute("aria-labelledby", messageId)
            this.setAttribute("role", "status")
            this.setAttribute("aria-live", "polite")
        }

        // Set custom button text if provided
        const confirmButton = templateContent.querySelector('[data-element="confirm-button"]')
        if (confirmButton && this.hasAttribute("confirm-text")) {
            confirmButton.textContent = this.getAttribute("confirm-text")
        }

        const cancelButton = templateContent.querySelector('[data-element="cancel-button"]')
        if (cancelButton && this.hasAttribute("cancel-text")) {
            cancelButton.textContent = this.getAttribute("cancel-text")
        }

        // Handle close button visibility
        const closeButton = templateContent.querySelector('[data-action="close"]')
        if (closeButton) {
            // Always visible if no timer, hover-only if has timer
            if (this.duration > 0) {
                closeButton.classList.add("toast-close-hover-only")
            }
        }

        // Append to toast
        this.appendChild(templateContent)
    }

    /**
     * Set up event handlers
     */
    setupEventHandlers() {
        // Click to close (for toast mode)
        if (this.mode === "toast") {
            this.addEventListener("click", (e) => {
                // Don't close if clicking close button (it has its own handler)
                if (e.target.closest('[data-action="close"]')) return
                this.close(true)
            })
        }

        // Close button
        this.addEventListener("click", (e) => {
            if (e.target.closest('[data-action="close"]')) {
                e.stopPropagation()
                this.close(this.mode === "progress" ? null : true)
            }
        })

        // Confirm button
        this.addEventListener("click", (e) => {
            if (e.target.closest('[data-action="confirm"]')) {
                this.close(true)
            }
        })

        // Cancel button
        this.addEventListener("click", (e) => {
            if (e.target.closest('[data-action="cancel"]')) {
                this.close(false)
            }
        })

        // Timed progress toasts acquire a duration only after reaching a terminal state.
        this.addEventListener("mouseenter", () => this.pauseTimer())
        this.addEventListener("mouseleave", () => this.resetTimer())
    }

    /**
     * Animate toast entrance
     */
    animateIn() {
        const position = this.position

        // Set initial state based on position
        this.style.opacity = "0"

        if (position === "primary") {
            this.style.transform = "translateX(100%)"
        } else if (position === "secondary") {
            this.style.transform = "translateX(-50%) translateY(100%)"
        } else if (position === "modal") {
            this.style.transform = "translate(-50%, -50%)"
        }

        this.style.transition = "none"

        // Force reflow
        this.offsetHeight

        // Animate to final state
        this.style.transition =
            "opacity var(--toast-animation-duration, 200ms) var(--toast-animation-easing, ease-out), transform var(--toast-animation-duration, 200ms) var(--toast-animation-easing, ease-out)"
        this.style.opacity = "1"

        if (position === "primary") {
            this.style.transform = "translateX(0)"
        } else if (position === "secondary") {
            this.style.transform = "translateX(-50%) translateY(0)"
        } else if (position === "modal") {
            this.style.transform = "translate(-50%, -50%) scale(1)"
        }

        // Clean up inline styles after animation
        setTimeout(() => {
            if (!this.isClosing) {
                this.style.transition = ""
                this.style.transform = "" // Clear to let CSS handle stacking
                this.style.opacity = ""
            }
        }, 200)
    }

    /**
     * Start auto-dismiss timer
     */
    startTimer() {
        if (this.duration <= 0) return
        if (this.mode !== "toast" && !(this.mode === "progress" && this.progressState !== "active")) return

        this.remainingTime = this.duration
        this.startTime = Date.now()
        this.isPaused = false

        this.timerId = setTimeout(() => {
            this.close(this.mode === "progress" ? null : true)
        }, this.remainingTime)
    }

    /**
     * Pause timer on hover
     */
    pauseTimer() {
        if (!this.timerId || this.isPaused) return

        clearTimeout(this.timerId)
        this.timerId = null
        this.isPaused = true

        // Calculate remaining time
        const elapsed = Date.now() - this.startTime
        this.remainingTime = Math.max(0, this.remainingTime - elapsed)
    }

    /**
     * Reset timer to full duration on mouseout
     */
    resetTimer() {
        if (!this.isPaused) return

        this.isPaused = false
        this.remainingTime = this.duration // Full reset
        this.startTime = Date.now()

        this.timerId = setTimeout(() => {
            this.close(this.mode === "progress" ? null : true)
        }, this.remainingTime)
    }

    /**
     * Clear timer
     */
    clearTimer() {
        if (this.timerId) {
            clearTimeout(this.timerId)
            this.timerId = null
        }
    }

    /**
     * Close the toast with animation
     * @param {boolean|null} result - Result to resolve promise with (for alert/confirm)
     */
    close(result = true) {
        if (this.isClosing) return

        this.isClosing = true
        this.clearTimer()

        // Resolve promise for alert/confirm
        if (this._resolve) {
            this._resolve(result)
        }

        // Emit closing event
        this.dispatchEvent(
            new CustomEvent("toast-closing", {
                detail: { toast: this, result },
                bubbles: true,
                cancelable: false,
            }),
        )

        // Animate out based on position
        const position = this.position

        this.style.transition =
            "opacity var(--toast-animation-duration, 200ms) var(--toast-animation-easing, ease-out), transform var(--toast-animation-duration, 200ms) var(--toast-animation-easing, ease-out)"
        this.style.opacity = "0"

        if (position === "primary") {
            this.style.transform = "translateX(100%)"
        } else if (position === "secondary") {
            this.style.transform = "translateX(-50%) translateY(100%)"
        } else if (position === "modal") {
            this.style.transform = "translate(-50%, -50%)"
        }

        // Remove after animation
        setTimeout(() => {
            if (this.parentNode) {
                this.parentNode.removeChild(this)
            }
        }, 200)
    }

    applyIntent(type) {
        this.classList.remove(...Object.values(TYPE_TO_INTENT))
        const intentClass = TYPE_TO_INTENT[type]
        if (!intentClass) throw new Error(`view-toast has invalid type '${type}'`)
        this.classList.add(intentClass)
    }

    assertActiveProgress(method) {
        if (this.mode !== "progress") throw new Error(`ui.toast.${method} target is not progress`)
        if (this.progressState !== "active") {
            throw new Error(`ui.toast.${method} cannot update ${this.progressState} progress`)
        }
    }

    setProgress(progress) {
        this.assertActiveProgress("progressUpdate")
        const progressElement = this.querySelector('[data-element="progress"]')
        if (!progressElement) throw new Error("progress toast is missing its progress element")
        if (progress === null) progressElement.removeAttribute("value")
        else progressElement.value = progress
    }

    finishProgress({ type, message, duration }) {
        const method = type === "success" ? "progressSuccess" : "progressError"
        this.assertActiveProgress(method)

        const progressElement = this.querySelector('[data-element="progress"]')
        if (!progressElement) throw new Error("progress toast is missing its progress element")

        if (type === "success") {
            this.setAttribute("role", "status")
            this.setAttribute("aria-live", "polite")
            progressElement.value = 1
        } else {
            this.setAttribute("role", "alert")
            this.setAttribute("aria-live", "assertive")
            if (!progressElement.hasAttribute("value")) progressElement.value = 0
        }
        if (message !== null) this.setMessage(message)

        this.progressState = type
        this.setAttribute("type", type)
        this.applyIntent(type)
        this.setAttribute("duration", duration.toString())

        const closeButton = this.querySelector('[data-action="close"]')
        if (!closeButton) throw new Error("progress toast is missing its close button")
        closeButton.removeAttribute("hidden")
        this.startTimer()
    }

    /**
     * Set message content
     */
    setMessage(message) {
        const messageElement = this.querySelector('[data-element="message"]')
        if (!messageElement) throw new Error("view-toast is missing its message element")
        messageElement.textContent = message
    }
}

if (!customElements.get("view-toast")) {
    customElements.define("view-toast", ViewToast)
}
