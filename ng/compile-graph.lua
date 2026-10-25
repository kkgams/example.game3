-- Compatibility entry required by released view.ng (hard-coded path).
-- Canonical Project-owned compiler source lives with authoring content.
local path = "content/gams/compile-graph.lua"
local source = host.call("fs/fs::read-text", path)
local chunk, message = load(source, "@" .. path, "t", _ENV)
assert(chunk, message)
chunk() -- Defines main() in this invocation's environment; plugin.lua calls it.
