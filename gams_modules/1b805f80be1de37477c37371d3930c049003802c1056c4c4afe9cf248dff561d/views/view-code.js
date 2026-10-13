import { runtime, unwrap } from "/core/runtime.js"
import { registerViewPlugin, unregisterViewPlugin } from "/util/view-plugin.js"
import "/widgets/code-editor.js"

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function getFilename(path) {
  return (
    String(path || "")
      .split("/")
      .pop() || ""
  )
}

function getExtension(path) {
  const name = getFilename(path)
  const parts = name.split(".")
  if (parts.length <= 1) return ""
  return parts.pop().toLowerCase()
}

function languageForPath(path) {
  return getExtension(path) || getFilename(path).toLowerCase()
}

function placeholderForLanguage(lang) {
  if (lang === "json") return "{}"
  if (lang === "lua") return "-- Lua code"
  return ""
}

export class ViewCode extends HTMLElement {
  static get observedAttributes() {
    return ["data-source", "data-lang"]
  }

  constructor() {
    super()
    this.popupProps = this.popupProps || {}
    this.formElement = null
    this.editorElement = null
    this.statusOutput = null
    this.saveButton = null
    this.path = ""
    this.codeLang = "text"
  }

  connectedCallback() {
    registerViewPlugin(this)
    if (this.dataset.ready) return
    this.dataset.ready = "1"
    this.style.display = "contents"
    this.path = String(
      this.popupProps?.path || this.getAttribute("data-source") || "",
    ).trim()
    assert(this.path, "view-code requires data-source")
    this.codeLang = String(
      this.getAttribute("data-lang") || languageForPath(this.path),
    )

    this.innerHTML = `
      <form data-element="form" novalidate>
        <code-editor data-field="content" lang="text" rows="24" spellcheck="false"></code-editor>
        <footer>
          <output data-element="path"></output>
          <output data-element="status">Loading...</output>
          <button type="button" data-action="cancel">Cancel</button>
          <button type="submit" data-action="save" class="accent">Save</button>
        </footer>
      </form>
    `

    this.formElement = this.querySelector('[data-element="form"]')
    this.editorElement = this.querySelector('[data-field="content"]')
    this.statusOutput = this.querySelector('[data-element="status"]')
    this.saveButton = this.querySelector('[data-action="save"]')
    const cancelButton = this.querySelector('[data-action="cancel"]')
    const pathOutput = this.querySelector('[data-element="path"]')

    assert(
      this.formElement instanceof HTMLFormElement,
      "view-code missing form element",
    )
    assert(this.editorElement, "view-code missing code editor")
    assert(
      this.statusOutput instanceof HTMLOutputElement,
      "view-code missing status output",
    )
    assert(
      this.saveButton instanceof HTMLButtonElement,
      "view-code missing save button",
    )
    assert(
      cancelButton instanceof HTMLButtonElement,
      "view-code missing cancel button",
    )
    assert(
      pathOutput instanceof HTMLOutputElement,
      "view-code missing path output",
    )

    pathOutput.textContent = this.path
    this.syncEditorLanguage()

    cancelButton.addEventListener("click", async () => {
      unwrap(
        await runtime.call("ui.popup.close", {
          ok: false,
          cancelled: true,
          path: this.path,
          reload: false,
        }),
      )
    })

    this.formElement.addEventListener("submit", async (event) => {
      event.preventDefault()
      await this.save()
    })

    void this.load()
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return

    if (name === "data-source") {
      this.path = String(newValue || "").trim()
      this.codeLang = String(
        this.getAttribute("data-lang") || languageForPath(this.path),
      )
      this.syncEditorLanguage()
      if (this.dataset.ready) void this.load()
      return
    }

    if (name === "data-lang") {
      this.codeLang = String(newValue || languageForPath(this.path))
      this.syncEditorLanguage()
    }
  }

  syncEditorLanguage() {
    if (!this.editorElement) return
    this.editorElement.setAttribute("lang", this.codeLang)
    this.editorElement.setAttribute(
      "placeholder",
      placeholderForLanguage(this.codeLang),
    )
  }

  setBusy(isBusy) {
    this.saveButton.disabled = isBusy
  }

  setStatus(text, tone = null) {
    this.statusOutput.textContent = text
    this.statusOutput.classList.remove(
      "accent",
      "success",
      "warning",
      "danger",
      "info",
    )
    if (tone) this.statusOutput.classList.add(tone)
  }

  async load() {
    this.setBusy(true)
    this.setStatus("Loading...", "info")
    try {
      this.editorElement.value = unwrap(
        await runtime.invoke("fs/fs::read-text", this.path),
      )
      this.setStatus("Ready", "success")
      queueMicrotask(() => this.editorElement.focus())
    } catch (error) {
      this.setStatus(`Error: ${error?.message || error}`, "danger")
      console.error("view-code load failed:", error)
    } finally {
      this.setBusy(false)
    }
  }

  async save() {
    this.setBusy(true)
    this.setStatus("Saving...", "info")
    try {
      unwrap(
        await runtime.invoke(
          "fs/fs::write-text",
          this.path,
          this.editorElement.value,
        ),
      )
      this.setStatus("Saved", "success")
      unwrap(
        await runtime.call("ui.popup.close", {
          ok: true,
          cancelled: false,
          path: this.path,
          reload: true,
          selectedPath: this.path,
        }),
      )
    } catch (error) {
      this.setStatus(`Error: ${error?.message || error}`, "danger")
      console.error("view-code save failed:", error)
    } finally {
      this.setBusy(false)
    }
  }

  disconnectedCallback() {
    void unregisterViewPlugin(this)
  }
}

if (!customElements.get("view-code")) {
  customElements.define("view-code", ViewCode)
}
