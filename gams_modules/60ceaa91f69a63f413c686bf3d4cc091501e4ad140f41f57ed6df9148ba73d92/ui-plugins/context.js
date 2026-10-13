function viewFromEvent(event) {
  let sawViewArea = false
  for (const item of event.composedPath()) {
    if (!(item instanceof HTMLElement)) continue
    if (typeof item.pluginId === "string" && item.pluginId.length > 0)
      return item
    if (typeof item.getCurrentView === "function") {
      sawViewArea = true
      const view = item.getCurrentView()
      if (
        view instanceof HTMLElement &&
        typeof view.pluginId === "string" &&
        view.pluginId.length > 0
      )
        return view
    }
  }
  return sawViewArea ? false : null
}

export function createUiContext() {
  const state = {
    activeView: {
      id: "",
    },
  }

  function setActiveView(view) {
    if (!(view instanceof HTMLElement))
      throw new Error("ui.context active view must be an HTMLElement")
    if (typeof view.pluginId !== "string" || view.pluginId.length === 0) {
      throw new Error("ui.context active view is missing pluginId")
    }
    state.activeView = { id: view.pluginId }
  }

  const onInteraction = (event) => {
    const view = viewFromEvent(event)
    if (view instanceof HTMLElement) setActiveView(view)
    else if (view === false) state.activeView = { id: "" }
  }

  window.addEventListener("pointerdown", onInteraction, { capture: true })
  window.addEventListener("focusin", onInteraction, { capture: true })

  return {
    id: "ui.context",
    dispose() {
      window.removeEventListener("pointerdown", onInteraction, {
        capture: true,
      })
      window.removeEventListener("focusin", onInteraction, { capture: true })
    },
    methods: {
      snapshot: async () => ({ ok: structuredClone(state) }),
      activateView: async (id) => {
        state.activeView = { id }
        return { ok: structuredClone(state) }
      },
      clearActiveView: async () => {
        state.activeView = { id: "" }
        return { ok: structuredClone(state) }
      },
    },
  }
}
