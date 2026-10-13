import { runtime, unwrap } from "/core/runtime.js"
import {
  registerViewPlugin,
  unregisterViewPlugin,
  viewOk,
} from "/util/view-plugin.js"

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function normalizePath(path) {
  const raw = String(path || ".").trim()
  if (!raw || raw === ".") return "."
  const parts = raw.split("/").filter(Boolean)
  return `${parts.join("/")}`
}

function joinPath(basePath, name) {
  const base = normalizePath(basePath)
  if (base === ".") return `${name}`
  return `${base}/${name}`
}

function formatSize(size, type) {
  if (type !== "regular-file") return "--"
  if (!Number.isFinite(size) || size < 0) return "--"
  if (size < 1024) return `${size} B`

  const units = ["KB", "MB", "GB", "TB"]
  let value = size / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") return -1
    if (a.type !== "directory" && b.type === "directory") return 1
    return a.name.localeCompare(b.name)
  })
}

function indentText(depth) {
  return "\u00a0\u00a0\u00a0\u00a0".repeat(depth)
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

export class ViewFiles extends HTMLElement {
  static get observedAttributes() {
    return [
      "data-root",
      "data-mode",
      "data-filter",
      "data-select-folders",
      "data-multi-select",
      "data-default-name",
    ]
  }

  constructor() {
    super()
    this.rootPath = normalizePath(this.getAttribute("data-root") || ".")
    this.mode = this.getAttribute("data-mode") || "browser"
    this.filter = this.getAttribute("data-filter") || ""
    this.selectFolders = this.getAttribute("data-select-folders") === "true"
    this.multiSelect = this.getAttribute("data-multi-select") === "true"
    this.defaultName = this.getAttribute("data-default-name") || ""
    this.openConfig = null
    this.expandedPaths = new Set()
    this.selectedPath = null
    this.selectedPaths = new Set()
    this.fileTree = new Map()
    this.tableElement = null
    this.footerElement = null
    this.pathElement = null
    this.statusElement = null
    this.targetElement = null
    this.filenameInput = null
    this.actionCancelButton = null
    this.actionSelectButton = null
    this.actionSaveButton = null
    this._headerControlsElement = null
  }

  connectedCallback() {
    registerViewPlugin(this, this.createViewPluginMethods())
    if (this.dataset.ready) return
    this.dataset.ready = "1"

    this.readConfig()
    this.style.display = "contents"

    this.innerHTML = `
      <article>
        <table data-element="table"></table>
      </article>
      <footer data-element="footer"></footer>
    `

    this.tableElement = this.querySelector('[data-element="table"]')
    this.footerElement = this.querySelector('[data-element="footer"]')

    assert(
      this.tableElement instanceof HTMLTableElement,
      "view-files missing table element",
    )
    assert(
      this.footerElement instanceof HTMLElement,
      "view-files missing footer element",
    )

    this.renderFooter()

    this._mountHeaderControls()

    const toolbar = this._headerControlsElement
    assert(
      toolbar instanceof HTMLElement,
      "view-files missing header controls element",
    )
    toolbar
      .querySelector('[data-action="new"]')
      ?.addEventListener("click", () => this.newEntry())
    toolbar
      .querySelector('[data-action="download"]')
      ?.addEventListener("click", () => this.downloadSelected())
    toolbar
      .querySelector('[data-action="upload"]')
      ?.addEventListener("click", () => this.uploadFile())
    toolbar
      .querySelector('[data-action="reload"]')
      ?.addEventListener("click", () => this.reload())
    toolbar
      .querySelector('[data-action="edit"]')
      ?.addEventListener("click", () => this.edit())
    toolbar
      .querySelector('[data-action="delete"]')
      ?.addEventListener("click", () => this.deleteSelected())

    this.addEventListener("chooser-select", async (event) => {
      await this.closePopupResult({
        ok: true,
        cancelled: false,
        selection: event.detail.selection,
      })
    })
    this.addEventListener("chooser-cancel", async () => {
      await this.closePopupResult({ ok: false, cancelled: true })
    })
    this.addEventListener("saver-save", async (event) => {
      await this.closePopupResult({
        ok: true,
        cancelled: false,
        ...event.detail,
      })
    })
    this.addEventListener("saver-cancel", async () => {
      await this.closePopupResult({ ok: false, cancelled: true })
    })

    this.setPath(this.rootPath)
    this.updateTargetPath()
    this.updateHeaderControlsUI()
    this.refresh()
  }

  disconnectedCallback() {
    this._unmountHeaderControls()
    void unregisterViewPlugin(this)
  }

  readConfig() {
    const props = this.popupProps || {}
    this.rootPath = normalizePath(
      props.root || props.rootPath || this.getAttribute("data-root") || ".",
    )
    this.mode = String(
      props.mode || this.getAttribute("data-mode") || "browser",
    )
    this.filter = String(props.filter || this.getAttribute("data-filter") || "")
    this.selectFolders = Boolean(
      props.selectFolders ??
        this.getAttribute("data-select-folders") === "true",
    )
    this.multiSelect = Boolean(
      props.multiSelect ?? this.getAttribute("data-multi-select") === "true",
    )
    this.defaultName = String(
      props.defaultName || this.getAttribute("data-default-name") || "",
    )
    this.openConfig = this.config.open
  }

  async closePopupResult(result) {
    if (this.popupId == null && !this.closest("view-popup")) return
    unwrap(await runtime.call("ui.popup.close", result))
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return

    if (name === "data-root") {
      this.rootPath = normalizePath(newValue || "/")
      this.selectedPath = null
      this.selectedPaths.clear()
      this.fileTree.clear()
      this.expandedPaths.clear()
      if (this.dataset.ready) {
        this.setPath(this.rootPath)
        this.updateTargetPath()
        void this.refresh()
      }
      return
    }

    if (name === "data-mode") {
      this.mode = newValue || "browser"
      if (this.dataset.ready) {
        this.renderFooter()
        this.updateHeaderControlsUI()
        this.render()
      }
      return
    }

    if (name === "data-filter") {
      this.filter = newValue || ""
      if (this.dataset.ready) {
        this.updateFooterUI()
        this.render()
      }
      return
    }

    if (name === "data-select-folders") {
      this.selectFolders = newValue === "true"
      if (this.dataset.ready) {
        this.updateFooterUI()
        this.render()
      }
      return
    }

    if (name === "data-multi-select") {
      this.multiSelect = newValue === "true"
      if (!this.multiSelect && this.selectedPaths.size > 1) {
        const [first] = this.selectedPaths
        this.selectedPaths = new Set(first ? [first] : [])
        this.selectedPath = first || null
      }
      if (this.dataset.ready) {
        this.updateFooterUI()
        this.render()
      }
      return
    }

    if (name === "data-default-name") {
      this.defaultName = newValue || ""
      if (this.dataset.ready) this.renderFooter()
    }
  }

  createViewPluginMethods() {
    return {
      new: async () => {
        await this.newEntry()
        return viewOk()
      },
      open: async () => {
        await this.downloadSelected()
        return viewOk()
      },
      save: async () => {
        await this.uploadFile()
        return viewOk()
      },
      saveAs: async () => {
        await this.uploadFile()
        return viewOk()
      },
      reload: async () => {
        await this.reload()
        return viewOk()
      },
      tool_1: async () => {
        await this.edit()
        return viewOk()
      },
      tool_2: async () => {
        await this.deleteSelected()
        return viewOk()
      },
    }
  }

  createHeaderControlsElement() {
    const toolbar = document.createElement("div")
    toolbar.dataset.element = "toolbar"
    toolbar.setAttribute("slot", "header-controls")
    toolbar.innerHTML = `
      <div role="buttongroup" data-element="file-actions">
        <button type="button" data-action="new" aria-label="New" title="New"><i aria-hidden="true">note_add</i></button>
        <button type="button" data-action="download" aria-label="Download file" title="Download file"><i aria-hidden="true">download</i></button>
        <button type="button" data-action="upload" aria-label="Upload file" title="Upload file"><i aria-hidden="true">upload</i></button>
        <button type="button" data-action="reload" aria-label="Reload" title="Reload"><i aria-hidden="true">refresh</i></button>
      </div>
      <div role="buttongroup" data-element="tool-actions">
        <button type="button" data-action="edit" aria-label="Edit" title="Edit"><i aria-hidden="true">edit</i></button>
        <button type="button" data-action="delete" aria-label="Delete" title="Delete"><i aria-hidden="true">delete</i></button>
      </div>
    `
    return toolbar
  }

  _mountHeaderControls() {
    if (!this.parentElement || this._headerControlsElement) return

    const headerControls = this.createHeaderControlsElement()
    this._headerControlsElement = headerControls
    this.parentElement.appendChild(headerControls)
  }

  _unmountHeaderControls() {
    if (this._headerControlsElement?.parentElement) {
      this._headerControlsElement.remove()
    }
    this._headerControlsElement = null
  }

  updateHeaderControlsUI() {
    if (!this._headerControlsElement) return

    const isBrowserMode = this.mode === "browser"
    const canManageEntries = ["browser", "chooser", "saver"].includes(
      this.mode,
    )

    const selectedEntry = this.selectedPath
      ? this.getEntry(this.selectedPath)
      : null

    const newButton = this._headerControlsElement.querySelector(
      '[data-action="new"]',
    )
    if (newButton instanceof HTMLButtonElement) {
      newButton.disabled = !canManageEntries
    }

    const downloadButton = this._headerControlsElement.querySelector(
      '[data-action="download"]',
    )
    if (downloadButton instanceof HTMLButtonElement) {
      downloadButton.disabled =
        !isBrowserMode || selectedEntry?.type !== "regular-file"
    }

    const uploadButton = this._headerControlsElement.querySelector(
      '[data-action="upload"]',
    )
    if (uploadButton instanceof HTMLButtonElement) {
      uploadButton.disabled = !isBrowserMode
    }

    const reloadButton = this._headerControlsElement.querySelector(
      '[data-action="reload"]',
    )
    if (reloadButton instanceof HTMLButtonElement) {
      reloadButton.disabled = false
    }

    const editButton = this._headerControlsElement.querySelector(
      '[data-action="edit"]',
    )
    if (editButton instanceof HTMLButtonElement) {
      editButton.disabled =
        !isBrowserMode || selectedEntry?.type !== "regular-file"
    }

    const deleteButton = this._headerControlsElement.querySelector(
      '[data-action="delete"]',
    )
    if (deleteButton instanceof HTMLButtonElement) {
      deleteButton.disabled = !canManageEntries || !this.selectedPath
    }

    this.updateFooterUI()
  }

  renderFooter() {
    assert(
      this.footerElement instanceof HTMLElement,
      "view-files footer element is not initialized",
    )

    this.footerElement.innerHTML = ""

    this.pathElement = document.createElement("output")
    this.pathElement.dataset.element = "path"
    this.footerElement.appendChild(this.pathElement)

    this.targetElement = document.createElement("output")
    this.targetElement.dataset.element = "target"
    this.footerElement.appendChild(this.targetElement)

    this.statusElement = document.createElement("output")
    this.statusElement.dataset.element = "status"
    this.footerElement.appendChild(this.statusElement)

    this.filenameInput = null
    this.actionCancelButton = null
    this.actionSelectButton = null
    this.actionSaveButton = null

    if (this.mode === "chooser") {
      this.actionCancelButton = document.createElement("button")
      this.actionCancelButton.type = "button"
      this.actionCancelButton.dataset.action = "cancel"
      this.actionCancelButton.textContent = "Cancel"
      this.actionCancelButton.addEventListener("click", () => {
        this.dispatchEvent(new CustomEvent("chooser-cancel", { bubbles: true }))
      })
      this.footerElement.appendChild(this.actionCancelButton)

      this.actionSelectButton = document.createElement("button")
      this.actionSelectButton.type = "button"
      this.actionSelectButton.dataset.action = "select"
      this.actionSelectButton.classList.add("accent")
      this.actionSelectButton.textContent = "Select"
      this.actionSelectButton.addEventListener("click", () =>
        this.confirmChooserSelection(),
      )
      this.footerElement.appendChild(this.actionSelectButton)
    }

    if (this.mode === "saver") {
      this.filenameInput = document.createElement("input")
      this.filenameInput.type = "text"
      this.filenameInput.dataset.field = "filename"
      this.filenameInput.value = this.defaultName
      this.filenameInput.setAttribute("autocomplete", "off")
      this.filenameInput.setAttribute("autocorrect", "off")
      this.filenameInput.setAttribute("autocapitalize", "off")
      this.filenameInput.spellcheck = false
      this.filenameInput.addEventListener("input", () => {
        this.defaultName = this.filenameInput.value
        this.updateFooterUI()
      })
      this.filenameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          void this.confirmSave()
        }
      })
      this.footerElement.appendChild(this.filenameInput)

      this.actionCancelButton = document.createElement("button")
      this.actionCancelButton.type = "button"
      this.actionCancelButton.dataset.action = "cancel"
      this.actionCancelButton.textContent = "Cancel"
      this.actionCancelButton.addEventListener("click", () => {
        this.dispatchEvent(new CustomEvent("saver-cancel", { bubbles: true }))
      })
      this.footerElement.appendChild(this.actionCancelButton)

      this.actionSaveButton = document.createElement("button")
      this.actionSaveButton.type = "button"
      this.actionSaveButton.dataset.action = "save"
      this.actionSaveButton.classList.add("accent")
      this.actionSaveButton.textContent = "Save"
      this.actionSaveButton.addEventListener("click", () => this.confirmSave())
      this.footerElement.appendChild(this.actionSaveButton)
    }

    assert(
      this.pathElement instanceof HTMLOutputElement,
      "view-files missing path output",
    )
    assert(
      this.targetElement instanceof HTMLOutputElement,
      "view-files missing target output",
    )
    assert(
      this.statusElement instanceof HTMLOutputElement,
      "view-files missing status output",
    )

    this.setPath(this.rootPath)
    this.updateFooterUI()
  }

  async callFs(method, ...input) {
    return unwrap(await runtime.invoke(`fs/fs::${method}`, ...input))
  }

  async refresh() {
    this.setStatus(`Loading ${this.rootPath}...`, "info")
    this.setPath(this.rootPath)

    try {
      this.fileTree.clear()
      await this.loadDirectory(this.rootPath)
      await this.ensureExpandedDirectoriesLoaded()
      this.pruneSelection()
      this.render()
      this.updateHeaderControlsUI()
      this.setStatus(this.describeStatus(), "success")
    } catch (error) {
      this.fileTree.clear()
      this.renderError(error)
      this.updateHeaderControlsUI()
      this.setStatus(`Error: ${error?.message || error}`, "danger")
      console.error("view-files refresh failed:", error)
    }
  }

  async reload() {
    await this.refresh()
    await runtime.call("ui.toast.success", {
      message: `Reloaded files from ${this.rootPath}`,
    })
  }

  async loadDirectory(path) {
    const normalizedPath = normalizePath(path)
    const files = await this.callFs("list", normalizedPath)
    assert(Array.isArray(files), "fs.list must return an array of entry names")

    const entries = await Promise.all(
      files.map(async (file) => {
        const fullPath = joinPath(normalizedPath, file.name)
        let type = file.type
        let size = 0

        if (file.type === "regular-file") {
          const stat = await this.callFs("stat", fullPath)
          size = Number.isFinite(stat.size) ? stat.size : Number(stat.size || 0)
        }

        if (file.type === "symbolic-link") {
          try {
            const stat = await this.callFs("stat", fullPath)
            type = stat.type
            size = Number.isFinite(stat.size)
              ? stat.size
              : Number(stat.size || 0)
          } catch (error) {
            console.warn(
              `view-files could not resolve symbolic link '${fullPath}':`,
              error,
            )
          }
        }

        return {
          name: file.name,
          path: fullPath,
          type,
          sourceType: file.type,
          size,
        }
      }),
    )
    this.fileTree.set(normalizedPath, sortEntries(entries))
  }

  async ensureExpandedDirectoriesLoaded() {
    const pending = [...this.expandedPaths]
    const loaded = new Set()

    while (pending.length > 0) {
      const path = pending.shift()
      if (loaded.has(path)) continue
      loaded.add(path)

      await this.loadDirectory(path)

      const entries = this.fileTree.get(path) || []
      for (const entry of entries) {
        if (entry.type !== "directory") continue
        if (!this.expandedPaths.has(entry.path)) continue
        pending.push(entry.path)
      }
    }
  }

  pruneSelection() {
    const validPaths = new Set()
    const walk = (path) => {
      const entries = this.fileTree.get(path) || []
      for (const entry of entries) {
        validPaths.add(entry.path)
        if (entry.type === "directory" && this.fileTree.has(entry.path)) {
          walk(entry.path)
        }
      }
    }
    walk(this.rootPath)

    if (this.selectedPath && !validPaths.has(this.selectedPath)) {
      this.selectedPath = null
    }

    for (const path of [...this.selectedPaths]) {
      if (!validPaths.has(path)) {
        this.selectedPaths.delete(path)
      }
    }

    if (!this.multiSelect && this.selectedPath) {
      this.selectedPaths = new Set([this.selectedPath])
    }
  }

  describeStatus() {
    const rootEntries = this.fileTree.get(this.rootPath) || []
    const noun = rootEntries.length === 1 ? "entry" : "entries"
    return `${rootEntries.length} ${noun} at ${this.rootPath}`
  }

  matchesFilter(filename) {
    if (!this.filter) return true
    const patterns = this.filter
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
    if (patterns.length === 0) return true
    const target = String(filename || "").toLowerCase()

    return patterns.some((pattern) => {
      const regexText = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*")
      return new RegExp(`^${regexText}$`, "i").test(target)
    })
  }

  render() {
    assert(
      this.tableElement instanceof HTMLTableElement,
      "view-files table element is not initialized",
    )

    this.tableElement.innerHTML = ""

    const thead = document.createElement("thead")
    thead.innerHTML = "<tr><th>Name</th><th>Type</th><th>Size</th></tr>"
    this.tableElement.appendChild(thead)

    const tbody = document.createElement("tbody")
    this.tableElement.appendChild(tbody)

    const rootEntries = this.fileTree.get(this.rootPath) || []
    if (rootEntries.length === 0) {
      const row = document.createElement("tr")
      const cell = document.createElement("td")
      cell.colSpan = 3
      cell.textContent = "Folder is empty."
      row.appendChild(cell)
      tbody.appendChild(row)
      return
    }

    this.renderRows(tbody, rootEntries, 0)
  }

  renderRows(tbody, entries, depth) {
    for (const entry of entries) {
      tbody.appendChild(this.createEntryRow(entry, depth))

      if (entry.type === "directory" && this.expandedPaths.has(entry.path)) {
        const childEntries = this.fileTree.get(entry.path) || []
        this.renderRows(tbody, childEntries, depth + 1)
      }
    }
  }

  renderError(error) {
    assert(
      this.tableElement instanceof HTMLTableElement,
      "view-files table element is not initialized",
    )

    this.tableElement.innerHTML = ""
    const tbody = document.createElement("tbody")
    const row = document.createElement("tr")
    const cell = document.createElement("td")
    cell.textContent = `Failed to load folder: ${error?.message || error}`
    row.appendChild(cell)
    tbody.appendChild(row)
    this.tableElement.appendChild(tbody)
  }

  createEntryRow(entry, depth) {
    const row = document.createElement("tr")
    row.dataset.element = "entry-row"
    row.dataset.path = entry.path
    row.dataset.type = entry.type
    row.setAttribute("tabindex", "0")
    row.setAttribute(
      "aria-selected",
      this.isPathSelected(entry.path) ? "true" : "false",
    )

    const nameCell = document.createElement("td")
    if (depth > 0) {
      nameCell.appendChild(document.createTextNode(indentText(depth)))
    }

    if (entry.type === "directory") {
      const icon = document.createElement("i")
      icon.setAttribute("aria-hidden", "true")
      icon.textContent = this.expandedPaths.has(entry.path)
        ? "folder_open"
        : "folder"
      nameCell.appendChild(icon)
      nameCell.appendChild(document.createTextNode(" "))
    } else {
      const icon = document.createElement("i")
      icon.setAttribute("aria-hidden", "true")
      icon.textContent =
        entry.sourceType === "symbolic-link" ? "link" : "description"
      nameCell.appendChild(icon)
      nameCell.appendChild(document.createTextNode(" "))
    }

    nameCell.appendChild(document.createTextNode(entry.name))

    const typeCell = document.createElement("td")
    typeCell.textContent =
      entry.sourceType === "symbolic-link"
        ? `*${entry.type === "directory" ? "Folder" : entry.type === "regular-file" ? "File" : entry.type}`
        : entry.type === "directory"
          ? "Folder"
          : entry.type === "regular-file"
            ? "File"
            : entry.type

    const sizeCell = document.createElement("td")
    sizeCell.textContent = formatSize(entry.size, entry.type)

    row.appendChild(nameCell)
    row.appendChild(typeCell)
    row.appendChild(sizeCell)

    row.addEventListener("click", async () => {
      if (entry.type === "directory") {
        this.selectRow(entry.path)
        await this.toggleDirectory(entry.path)
        return
      }
      this.selectRow(entry.path)
    })
    row.addEventListener("dblclick", async () => {
      if (entry.type === "regular-file" && this.mode === "browser") {
        await this.openFile(entry.path)
        return
      }

      if (entry.type === "regular-file" && this.mode === "chooser") {
        this.selectChooserEntryForActivation(entry)
        this.confirmChooserSelection()
      }
    })
    row.addEventListener("keydown", (event) =>
      this.handleRowKeyDown(event, entry),
    )

    return row
  }

  isPathSelected(path) {
    if (this.multiSelect && this.mode === "chooser")
      return this.selectedPaths.has(path)
    return this.selectedPath === path
  }

  isSelectableEntry(entry) {
    if (!entry) return false
    if (this.mode === "browser") return true
    if (this.mode === "saver")
      return entry.type === "directory" || entry.type === "regular-file"
    if (entry.type === "directory") return this.selectFolders
    return this.matchesFilter(entry.name)
  }

  getEntry(path, directoryPath = this.rootPath) {
    const entries = this.fileTree.get(directoryPath) || []
    for (const entry of entries) {
      if (entry.path === path) return entry
      if (entry.type === "directory" && this.fileTree.has(entry.path)) {
        const found = this.getEntry(path, entry.path)
        if (found) return found
      }
    }
    return null
  }

  getTargetDirectoryPath() {
    if (!this.selectedPath) return this.rootPath
    const selectedEntry = this.getEntry(this.selectedPath)
    if (!selectedEntry) return this.rootPath

    if (selectedEntry.type === "directory") {
      if (this.expandedPaths.has(selectedEntry.path)) {
        return selectedEntry.path
      }
      const slashIndex = selectedEntry.path.lastIndexOf("/")
      return slashIndex <= 0 ? "." : selectedEntry.path.slice(0, slashIndex)
    }

    const slashIndex = this.selectedPath.lastIndexOf("/")
    return slashIndex <= 0 ? "." : this.selectedPath.slice(0, slashIndex)
  }

  async newEntry() {
    await this.openCreatePopup(
      this.mode === "saver" ? "directory" : "regular-file",
    )
  }

  async openCreatePopup(kind) {
    const parentPath = this.getTargetDirectoryPath()
    const title = kind === "directory" ? "Create Folder" : "Create File"
    const payload = unwrap(
      await runtime.call("ui.popup.open", {
        title,
        size: "medium",
        tag: "files-rename",
        props: {
          mode: "create",
          kind,
          parentPath,
        },
      }),
    )

    if (payload?.reload) {
      for (const revealPath of payload.revealPaths) {
        if (revealPath !== this.rootPath) this.expandedPaths.add(revealPath)
      }
      await this.refresh()
      if (payload.selectedPath) this.selectRow(payload.selectedPath)
    }
  }

  async edit() {
    await this.editSelected()
  }

  async editSelected() {
    if (!this.selectedPath) {
      this.setStatus("No file selected for edit", "warning")
      await runtime.call("ui.toast.warning", {
        message: "No file selected for edit",
      })
      return
    }
    const entry = this.getEntry(this.selectedPath)
    assert(entry, `view-files selected path not found: ${this.selectedPath}`)
    if (entry.type !== "regular-file") {
      this.setStatus("Folders cannot be edited directly", "warning")
      await runtime.call("ui.toast.warning", {
        message: "Folders cannot be edited directly",
      })
      return
    }
    await this.openFile(entry.path)
  }

  async openRenamePopup() {
    if (!this.selectedPath) return
    const entry = this.getEntry(this.selectedPath)
    assert(entry, `view-files selected path not found: ${this.selectedPath}`)

    const sourcePath = entry.path
    const payload = unwrap(
      await runtime.call("ui.popup.open", {
        title: entry.type === "directory" ? "Rename Folder" : "Rename File",
        size: "medium",
        tag: "files-rename",
        props: {
          mode: "rename",
          kind: entry.type,
          targetPath: entry.path,
        },
      }),
    )

    if (payload?.reload) {
      if (entry.type === "directory" && payload.selectedPath) {
        this.rewriteExpandedPaths(sourcePath, payload.selectedPath)
      }
      if (payload.revealPath && payload.revealPath !== this.rootPath) {
        this.expandedPaths.add(payload.revealPath)
      }
      this.selectedPath = null
      this.selectedPaths.clear()
      await this.refresh()
      if (payload.selectedPath) this.selectRow(payload.selectedPath)
    }
  }

  async confirmDelete(entry) {
    const result = unwrap(
      await runtime.call("ui.toast.confirm", {
        message:
          entry.type === "directory"
            ? `Delete folder "${entry.name}" and all its contents?`
            : `Delete file "${entry.name}"?`,
        type: "warning",
        confirmText: "Delete",
        cancelText: "Cancel",
      }),
    )
    return result
  }

  async deletePathRecursive(path) {
    const stat = await this.callFs("stat", path)

    if (stat.type === "directory") {
      const files = await this.callFs("list", path)

      for (const { name } of files) {
        await this.deletePathRecursive(joinPath(path, name))
      }

      await this.callFs("remove-dir", path)
      return
    }

    await this.callFs("remove-file", path)
  }

  async deleteSelected() {
    if (!this.selectedPath) return
    const entry = this.getEntry(this.selectedPath)
    assert(entry, `view-files selected path not found: ${this.selectedPath}`)

    const confirmed = await this.confirmDelete(entry)
    if (!confirmed) return

    this.setStatus(`Deleting ${entry.path}...`, "info")
    await this.deletePathRecursive(entry.path)

    this.selectedPath = null
    this.selectedPaths.clear()
    this.fileTree.clear()
    this.removeExpandedPathTree(entry.path)
    await this.refresh()
  }

  getParentDirectoryPath(path) {
    const normalizedPath = normalizePath(path)
    const slashIndex = normalizedPath.lastIndexOf("/")
    return slashIndex <= 0 ? "/" : normalizedPath.slice(0, slashIndex)
  }

  getUploadDirectoryPath() {
    if (!this.selectedPath) return this.rootPath
    const selectedEntry = this.getEntry(this.selectedPath)
    assert(
      selectedEntry,
      `view-files selected path not found: ${this.selectedPath}`,
    )
    return selectedEntry.type === "directory"
      ? selectedEntry.path
      : this.getParentDirectoryPath(selectedEntry.path)
  }

  async uploadFile() {
    if (this.mode !== "browser") return

    const destinationDirectory = this.getUploadDirectoryPath()
    const input = document.createElement("input")
    input.type = "file"
    input.multiple = true
    input.hidden = true

    input.addEventListener(
      "change",
      async () => {
        const files = Array.from(input.files || [])
        input.remove()
        if (files.length === 0) return

        this.setStatus(
          `Uploading ${files.length} file${files.length === 1 ? "" : "s"} to ${destinationDirectory}...`,
          "info",
        )

        try {
          let selectedUploadPath = null

          for (const file of files) {
            // Convert ArrayBuffer -> Uint8Array -> plain number[]
            const content = Array.from(new Uint8Array(await file.arrayBuffer()))
            const filePath = joinPath(destinationDirectory, file.name)
            await this.callFs("write-file", filePath, content)
            selectedUploadPath = filePath
          }

          if (destinationDirectory !== this.rootPath) {
            this.expandedPaths.add(destinationDirectory)
          }

          await this.refresh()

          if (selectedUploadPath) {
            this.selectRow(selectedUploadPath)
          }

          await runtime.call("ui.toast.success", {
            message: `Uploaded ${files.length} file${files.length === 1 ? "" : "s"}`,
          })
        } catch (error) {
          this.setStatus(`Error: ${error?.message || error}`, "danger")

          await runtime.call("ui.toast.error", {
            message: String(error?.message || error),
          })

          console.error("view-files upload failed:", error)
        }
      },
      { once: true },
    )

    document.body.appendChild(input)
    input.click()
  }

  async downloadSelected() {
    if (this.mode !== "browser") return

    if (!this.selectedPath) {
      this.setStatus("No file selected for download", "warning")
      await runtime.call("ui.toast.warning", {
        message: "No file selected for download",
      })
      return
    }

    const entry = this.getEntry(this.selectedPath)
    assert(entry, `view-files selected path not found: ${this.selectedPath}`)

    if (entry.type !== "regular-file") {
      this.setStatus("Folders cannot be downloaded directly", "warning")
      await runtime.call("ui.toast.warning", {
        message: "Folders cannot be downloaded directly",
      })
      return
    }

    this.setStatus(`Downloading ${entry.path}...`, "info")

    try {
      const result = await this.callFs("read-file", entry.path)
      const blob = new Blob([new Uint8Array(result)])
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = entry.name
      document.body.appendChild(link)
      link.click()
      window.setTimeout(() => {
        URL.revokeObjectURL(url)
        link.remove()
      }, 0)

      this.setStatus(`Downloaded ${entry.path}`, "success")
      await runtime.call("ui.toast.success", {
        message: `Downloaded ${entry.name}`,
      })
    } catch (error) {
      this.setStatus(`Error: ${error?.message || error}`, "danger")
      await runtime.call("ui.toast.error", {
        message: String(error?.message || error),
      })
      console.error("view-files download failed:", error)
    }
  }

  resolveFileOpenTag(path) {
    const name = getFilename(path)
    const ext = getExtension(path)
    return (
      this.openConfig[name] ||
      this.openConfig[name.toLowerCase()] ||
      this.openConfig[ext] ||
      this.openConfig.default
    )
  }

  async openFile(path) {
    const entry = this.getEntry(path)
    assert(entry, `view-files file path not found: ${path}`)
    assert(
      entry.type === "regular-file",
      `view-files openFile expected file path: ${path}`,
    )

    const payload = unwrap(
      await runtime.call("ui.popup.open", {
        title: entry.name,
        size: "large",
        tag: this.resolveFileOpenTag(entry.path),
        props: {
          path: entry.path,
        },
      }),
    )

    if (payload?.reload) {
      await this.refresh()
      if (payload.selectedPath) this.selectRow(payload.selectedPath)
    }
  }

  rewriteExpandedPaths(sourcePath, targetPath) {
    const source = normalizePath(sourcePath)
    const target = normalizePath(targetPath)
    const next = new Set()

    for (const path of this.expandedPaths) {
      if (path === source) {
        next.add(target)
        continue
      }
      if (path.startsWith(`${source}/`)) {
        next.add(`${target}${path.slice(source.length)}`)
        continue
      }
      next.add(path)
    }

    this.expandedPaths = next
  }

  removeExpandedPathTree(pathToRemove) {
    const target = normalizePath(pathToRemove)
    const next = new Set()

    for (const path of this.expandedPaths) {
      if (path === target) continue
      if (path.startsWith(`${target}/`)) continue
      next.add(path)
    }

    this.expandedPaths = next
  }

  selectChooserEntryForActivation(entry) {
    if (!this.isSelectableEntry(entry)) return

    this.selectedPath = entry.path

    if (this.multiSelect) {
      this.selectedPaths.add(entry.path)
    } else {
      this.selectedPaths = new Set([entry.path])
    }

    this.updateSelectionUI()
    this.updateHeaderControlsUI()
    this.emitSelectionChanged()
  }

  selectRow(path) {
    this.selectedPath = path

    if (this.mode === "chooser" && this.multiSelect) {
      const entry = this.getEntry(path)
      if (this.isSelectableEntry(entry)) {
        if (this.selectedPaths.has(path)) this.selectedPaths.delete(path)
        else this.selectedPaths.add(path)
      }
    } else {
      this.selectedPaths = new Set(path ? [path] : [])
    }

    if (this.mode === "saver") {
      const entry = this.getEntry(path)
      if (
        entry?.type === "regular-file" &&
        this.filenameInput instanceof HTMLInputElement
      ) {
        this.filenameInput.value = entry.name
        this.defaultName = entry.name
      }
    }

    this.updateSelectionUI()
    this.updateHeaderControlsUI()
    this.emitSelectionChanged()
  }

  updateSelectionUI() {
    this.querySelectorAll('[data-element="entry-row"]').forEach((row) => {
      row.setAttribute(
        "aria-selected",
        this.isPathSelected(row.dataset.path) ? "true" : "false",
      )
    })
  }

  async handleRowKeyDown(event, entry) {
    if (event.key === "Enter") {
      event.preventDefault()
      if (entry.type === "directory") {
        this.selectRow(entry.path)
        await this.toggleDirectory(entry.path)
        return
      }

      this.selectRow(entry.path)
      if (this.mode === "browser") {
        await this.openFile(entry.path)
      }
      return
    }

    if (event.key === " ") {
      event.preventDefault()
      this.selectRow(entry.path)
    }
  }

  async toggleDirectory(path) {
    const normalizedPath = normalizePath(path)
    if (this.expandedPaths.has(normalizedPath)) {
      this.expandedPaths.delete(normalizedPath)
      this.render()
      this.setStatus(this.describeStatus(), "success")
      return
    }

    this.setStatus(`Loading ${normalizedPath}...`, "info")
    if (!this.fileTree.has(normalizedPath)) {
      await this.loadDirectory(normalizedPath)
    }
    this.expandedPaths.add(normalizedPath)
    this.render()
    this.setStatus(this.describeStatus(), "success")
  }

  getSelection() {
    if (this.mode === "chooser" && this.multiSelect) {
      const result = []
      for (const path of this.selectedPaths) {
        const entry = this.getEntry(path)
        if (!this.isSelectableEntry(entry)) continue
        result.push({ path: entry.path, name: entry.name, type: entry.type })
      }
      return result
    }

    if (!this.selectedPath) return null
    const entry = this.getEntry(this.selectedPath)
    if (!this.isSelectableEntry(entry)) return null
    return { path: entry.path, name: entry.name, type: entry.type }
  }

  emitSelectionChanged() {
    this.dispatchEvent(
      new CustomEvent("selection-changed", {
        bubbles: true,
        detail: { selection: this.getSelection() },
      }),
    )
  }

  confirmChooserSelection() {
    const selection = this.getSelection()
    const hasSelection = Array.isArray(selection)
      ? selection.length > 0
      : selection !== null
    if (!hasSelection) return
    this.dispatchEvent(
      new CustomEvent("chooser-select", {
        bubbles: true,
        detail: { selection },
      }),
    )
  }

  async confirmSave() {
    assert(
      this.filenameInput instanceof HTMLInputElement,
      "view-files saver filename input is not initialized",
    )
    const name = this.filenameInput.value.trim()
    if (!name) {
      this.setStatus("Error: File name is required", "danger")
      this.filenameInput.focus()
      return
    }

    const directory = this.getTargetDirectoryPath()
    const path = joinPath(directory, name)
    this.dispatchEvent(
      new CustomEvent("saver-save", {
        bubbles: true,
        detail: { path, name, directory },
      }),
    )
  }

  setPath(path) {
    assert(
      this.pathElement instanceof HTMLOutputElement,
      "view-files path output is not initialized",
    )
    this.pathElement.textContent = `Root: ${path}`
  }

  updateTargetPath() {
    assert(
      this.targetElement instanceof HTMLOutputElement,
      "view-files target output is not initialized",
    )

    if (this.mode === "chooser") {
      const selection = this.getSelection()
      if (Array.isArray(selection)) {
        this.targetElement.textContent = `Selected: ${selection.length}`
        return
      }
      this.targetElement.textContent = selection
        ? `Selected: ${selection.path}`
        : "Selected: none"
      return
    }

    if (this.mode === "saver") {
      this.targetElement.textContent = `Save in: ${this.getTargetDirectoryPath()}`
      return
    }

    this.targetElement.textContent = `Create in: ${this.getTargetDirectoryPath()}`
  }

  updateFooterUI() {
    this.updateTargetPath()

    if (this.actionSelectButton instanceof HTMLButtonElement) {
      const selection = this.getSelection()
      const hasSelection = Array.isArray(selection)
        ? selection.length > 0
        : selection !== null
      this.actionSelectButton.disabled = !hasSelection
    }

    if (
      this.actionSaveButton instanceof HTMLButtonElement &&
      this.filenameInput instanceof HTMLInputElement
    ) {
      this.actionSaveButton.disabled = this.filenameInput.value.trim() === ""
    }
  }

  setStatus(text, tone = null) {
    assert(
      this.statusElement instanceof HTMLOutputElement,
      "view-files status output is not initialized",
    )
    this.statusElement.textContent = text
    this.statusElement.classList.remove(
      "accent",
      "success",
      "warning",
      "danger",
      "info",
    )
    if (tone) {
      this.statusElement.classList.add(tone)
    }
  }
}

if (!customElements.get("view-files")) {
  customElements.define("view-files", ViewFiles)
}
