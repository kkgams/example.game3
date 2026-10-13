import { runtime, unwrap } from "/core/runtime.js"
import { registerViewPlugin, unregisterViewPlugin } from "/util/view-plugin.js"

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "--"
  if (bytes < 1024) return `${bytes} B`

  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

function getExtension(path) {
  const name =
    String(path || "")
      .split("/")
      .pop() || ""
  const parts = name.split(".")
  if (parts.length <= 1) return ""
  return parts.pop().toLowerCase()
}

function getFileTypeLabel(path) {
  const ext = getExtension(path)
  if (!ext) return "Unknown"
  return `${ext.toUpperCase()} File`
}

export class FilesDefault extends HTMLElement {
  constructor() {
    super()
    this.popupProps = this.popupProps || {}
    this.tableElement = null
    this.statusElement = null
    this.path = ""
  }

  connectedCallback() {
    registerViewPlugin(this)
    if (this.dataset.ready) return
    this.dataset.ready = "1"

    this.style.display = "contents"
    this.path = String(this.popupProps?.path || "")
    assert(this.path, "files-default requires popupProps.path")

    this.innerHTML = `
      <table data-element="table"></table>
      <footer>
        <output data-element="status">Loading...</output>
        <button type="button" data-action="close">Close</button>
      </footer>
    `

    this.tableElement = this.querySelector('[data-element="table"]')
    this.statusElement = this.querySelector('[data-element="status"]')

    assert(
      this.tableElement instanceof HTMLTableElement,
      "files-default missing table element",
    )
    assert(
      this.statusElement instanceof HTMLOutputElement,
      "files-default missing status output",
    )

    this.querySelector('[data-action="close"]')?.addEventListener(
      "click",
      async () => {
        await runtime.call("ui.popup.close", { reload: false, cancelled: true })
      },
    )

    void this.load()
  }

  setStatus(text, tone = null) {
    this.statusElement.textContent = text
    this.statusElement.classList.remove(
      "accent",
      "success",
      "warning",
      "danger",
      "info",
    )
    if (tone) this.statusElement.classList.add(tone)
  }

  async load() {
    this.setStatus("Loading...", "info")

    try {
      const stat = unwrap(await runtime.invoke("fs/fs::stat", this.path))

      const rows = [
        ["Name", this.path.split("/").pop() || this.path],
        ["Path", this.path],
        [
          "Type",
          stat.type === "directory" ? "Folder" : getFileTypeLabel(this.path),
        ],
        ["Size", formatSize(Number(stat.size || 0))],
        ["Editor", "No registered editor for this file type"],
      ]

      this.renderTable(rows)
      this.setStatus("Ready", "success")
    } catch (error) {
      this.tableElement.innerHTML = ""
      this.setStatus(`Error: ${error?.message || error}`, "danger")
      console.error("files-default load failed:", error)
    }
  }

  renderTable(rows) {
    this.tableElement.innerHTML = ""

    const tbody = document.createElement("tbody")
    for (const [label, value] of rows) {
      const row = document.createElement("tr")
      const heading = document.createElement("th")
      heading.textContent = label
      const data = document.createElement("td")
      data.textContent = value
      row.appendChild(heading)
      row.appendChild(data)
      tbody.appendChild(row)
    }

    this.tableElement.appendChild(tbody)
  }

  disconnectedCallback() {
    void unregisterViewPlugin(this)
  }
}

if (!customElements.get("files-default")) {
  customElements.define("files-default", FilesDefault)
}
