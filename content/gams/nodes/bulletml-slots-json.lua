-- Adapted from the demo's bulletml-slots-json.lua; see content/PROVENANCE.md.
local paths = inputs[1]
assert(type(paths) == "table" and #paths > 0, "paths must be a non-empty array")
local count = 0
for key, _ in pairs(paths) do
    assert(type(key) == "number" and key == math.floor(key) and key >= 1 and key <= #paths,
        "paths must be a dense array")
    count = count + 1
end
assert(count == #paths, "paths must be a dense array")
local patterns = {}
for index, path in ipairs(paths) do
    assert(type(path) == "string" and path:match("^content/bulletml/[^/]+%.bulletml%.json$"),
        "pattern path " .. index .. " must be a content/bulletml/*.bulletml.json file")
    local text = host.call("fs/fs::read-text", path)
    local pattern = json.decode(text)
    assert(type(pattern) == "table" and type(pattern.actions) == "table" and #pattern.actions > 0,
        path .. " requires actions")
    assert(type(pattern.bullets) == "table" and type(pattern.fires) == "table",
        path .. " requires bullets and fires arrays")
    patterns[#patterns + 1] = text
end
-- One slot containing a vector of patterns. Keep original JSON bytes so empty
-- objects/arrays are not changed by a Lua table decode/encode round trip.
outputs[1] = "[[" .. table.concat(patterns, ",") .. "]]"
