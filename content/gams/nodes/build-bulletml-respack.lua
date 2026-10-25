local schemaPath, slotsJson, outputPath = inputs[1], inputs[2], inputs[3]
assert(type(schemaPath) == "string" and schemaPath ~= "", "schemaPath is required")
assert(type(slotsJson) == "string" and slotsJson ~= "", "slotsJson is required")
assert(type(outputPath) == "string" and outputPath:match("^build%.nosync/.+%.rspk$"),
    "outputPath must be a .rspk under build.nosync/")

-- Expected missing directories are handled explicitly. Do not catch arbitrary
-- filesystem/build errors or substitute legacy demo-relative paths.
local parts = {}
for part in outputPath:gmatch("[^/]+") do
    assert(part ~= "." and part ~= ".." and not part:find("\\", 1, true), "invalid output path")
    parts[#parts + 1] = part
end
local parent = "."
for index = 1, #parts - 1 do
    local name, found = parts[index], false
    for _, entry in ipairs(host.call("fs/fs::list", parent)) do
        if entry.name == name then
            assert(entry.type == "directory", parent .. "/" .. name .. " is not a directory")
            found = true
            break
        end
    end
    local path = parent == "." and name or parent .. "/" .. name
    if not found then host.call("fs/fs::create-dir", path) end
    parent = path
end
local schema = host.call("fs/fs::read-text", schemaPath)
local bytes = host.call("respack/respack::build-to-file", schema, slotsJson, outputPath)
assert(type(bytes) == "number" and bytes > 16, "respack build returned an empty package")
outputs[1] = outputPath
