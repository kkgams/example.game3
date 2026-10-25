-- compile-graph.lua
--
-- Compiles a flattened browser view-ng node array into one Lua program.
--
-- Compiler input:
--   _G.input or input: JSON string containing the executable graph produced by
--   flattenNgGraph(view-ng.getGraph()). Group boundaries are resolved before
--   this compiler is invoked.
--
-- Compiler output:
--   main() returns generated Lua source code as a string.
--
-- Generated program conventions:
--   * code-node scripts execute with `inputs` and `outputs` tables in scope
--   * branch activity is available as `inputs.active[portId]`
--   * port names are available as `inputs.names[portId]` / `outputs.names[portId]`
--   * outgoing branch activity is controlled with `outputs.active[portId]`
--   * code-node scripts may also use `_G.inputs` and `_G.outputs`
--   * final graph results are returned from generated main()
--   * NODE_CODE nodes with no outputs are treated as run targets without final result output
--   * optional progress is provided by emitting an injected `__ng_progress` hook

local NG = {
	NODE_GOAL = 1,
	NODE_CODE = 2,
	NODE_GROUP = 3,
	NODE_VALUE = 4,
	NODE_GRAPH_INPUT = 5,
	NODE_GRAPH_OUTPUT = 6,
	NODE_FOR_EACH = 7,
	NODE_FOR_EACH_INPUT = 8,
	NODE_ITERATION_CONTROL = 9,
	NODE_FOR_EACH_SHARED_INPUT = 10,
	NODE_FOR_EACH_GET_VAR = 11,
	NODE_FOR_EACH_SET_VAR = 12,
}

function main()
local graphJson = _G.input or input
if type(graphJson) ~= "string" or graphJson == "" then
	error("compile-graph.lua requires graph JSON in _G.input or input")
end

local graph = json.decode(graphJson)
if type(graph) ~= "table" then
	error("compile-graph.lua graph JSON must decode to an array")
end

local progressSource = _G.ngProgressSource or ngProgressSource or ""
if type(progressSource) ~= "string" then
	error("compile-graph.lua ngProgressSource must be a string")
end

local function assertInteger(value, label)
	if type(value) ~= "number" or value ~= math.floor(value) then
		error(label .. " must be an integer")
	end
	return value
end

local function nodeLabel(node)
	local id = tostring(node and node.id or "?")
	local name = tostring(node and node.name or "")
	if name ~= "" then
		return "node " .. string.format("%q", name) .. " (" .. id .. ")"
	end
	return "node " .. id
end

local function portLabel(node, port, direction)
	return nodeLabel(node) .. " " .. direction .. " " .. tostring(port and port.id or "?")
end

local nodesById = {}
local function indexLevel(level, label)
	for index, node in ipairs(level) do
		if type(node) ~= "table" then
			error(label .. " entry " .. tostring(index) .. " must be an object")
		end
		local id = assertInteger(node.id, label .. " entry " .. tostring(index) .. ".id")
		if nodesById[id] then
			error("duplicate node id: " .. tostring(id))
		end
		nodesById[id] = node
		if node.kind == NG.NODE_FOR_EACH then
			if type(node.childGraph) ~= "table" then
				error(nodeLabel(node) .. ".childGraph must be an array")
			end
			indexLevel(node.childGraph, nodeLabel(node) .. ".childGraph")
		end
	end
end
indexLevel(graph, "graph")

local function getNode(nodeId)
	local node = nodesById[nodeId]
	if not node then
		error("missing node: " .. tostring(nodeId))
	end
	return node
end

local function getInputs(node)
	return node.inputs or {}
end

local function getOutputs(node)
	return node.outputs or {}
end

local function hasOutput(node, outputId)
	for _, outputPort in ipairs(getOutputs(node)) do
		if outputPort.id == outputId then
			return true
		end
	end
	return false
end

local function isConnectedInput(inputPort)
	return inputPort.srcNodeId ~= nil
		and inputPort.srcOutputId ~= nil
		and inputPort.srcNodeId ~= 0
		and inputPort.srcOutputId ~= 0
end


local function validateLevel(level, ownerKind)
	local localIds = {}
	for _, node in ipairs(level) do
		localIds[node.id] = true
	end
	local controlCount = 0
	local forEachInputCount = 0
	local getVarsByName = {}
	local setVarsByName = {}
	for _, node in ipairs(level) do
		assertInteger(node.id, nodeLabel(node) .. ".id")
		assertInteger(node.kind, nodeLabel(node) .. ".kind")

		local inputIds = {}
		for _, inputPort in ipairs(getInputs(node)) do
			local inputId = assertInteger(inputPort.id, portLabel(node, inputPort, "input") .. ".id")
			if inputPort.name == "active" then
				error(portLabel(node, inputPort, "input") .. ".name uses reserved name 'active'")
			end
			if inputIds[inputId] then
				error(nodeLabel(node) .. " has duplicate input id " .. tostring(inputId))
			end
			inputIds[inputId] = true

			if isConnectedInput(inputPort) then
				local srcNodeId = assertInteger(inputPort.srcNodeId, portLabel(node, inputPort, "input") .. ".srcNodeId")
				local srcOutputId = assertInteger(inputPort.srcOutputId, portLabel(node, inputPort, "input") .. ".srcOutputId")
				if not localIds[srcNodeId] then
					error(portLabel(node, inputPort, "input") .. " references a node outside its graph level")
				end
				local srcNode = getNode(srcNodeId)
				if not hasOutput(srcNode, srcOutputId) then
					error(portLabel(node, inputPort, "input") .. " references missing source output " .. tostring(srcNodeId) .. "." .. tostring(srcOutputId))
				end
			end
		end

		local outputIds = {}
		for _, outputPort in ipairs(getOutputs(node)) do
			local outputId = assertInteger(outputPort.id, portLabel(node, outputPort, "output") .. ".id")
			if outputPort.name == "active" then
				error(portLabel(node, outputPort, "output") .. ".name uses reserved name 'active'")
			end
			if outputIds[outputId] then
				error(nodeLabel(node) .. " has duplicate output id " .. tostring(outputId))
			end
			outputIds[outputId] = true
		end

		if node.kind == NG.NODE_FOR_EACH then
			validateLevel(node.childGraph, NG.NODE_FOR_EACH)
			local graphOutputNames = {}
			local expectedStateOutputs = {}
			for _, childNode in ipairs(node.childGraph) do if childNode.kind == NG.NODE_GRAPH_OUTPUT then
				graphOutputNames[childNode.name ~= "" and childNode.name or ("output " .. tostring(childNode.id))] = true
			end end
			for _, childNode in ipairs(node.childGraph) do
				if childNode.kind == NG.NODE_FOR_EACH_GET_VAR then for _, outputPort in ipairs(getOutputs(childNode)) do
					if graphOutputNames[outputPort.name] then error(nodeLabel(node) .. " Iteration State " .. string.format("%q", outputPort.name) .. " conflicts with a Graph Output") end
					local key = tostring(childNode.id) .. ":" .. tostring(outputPort.id)
					expectedStateOutputs[key] = true
					local parentOutput = nil
					for _, candidate in ipairs(getOutputs(node)) do if candidate.stateNodeId == childNode.id and candidate.statePortId == outputPort.id then parentOutput = candidate end end
					if not parentOutput or parentOutput.name ~= outputPort.name then error(nodeLabel(node) .. " missing final Iteration State output " .. string.format("%q", outputPort.name)) end
				end end
			end
			for _, outputPort in ipairs(getOutputs(node)) do if outputPort.stateNodeId ~= nil then
				local key = tostring(outputPort.stateNodeId) .. ":" .. tostring(outputPort.statePortId)
				if not expectedStateOutputs[key] then error(portLabel(node, outputPort, "output") .. " references missing GetVar state") end
			end end
		elseif node.kind == NG.NODE_FOR_EACH_INPUT then
			if ownerKind ~= NG.NODE_FOR_EACH then error(nodeLabel(node) .. " must be inside For Each") end
			forEachInputCount = forEachInputCount + 1
		elseif node.kind == NG.NODE_FOR_EACH_SHARED_INPUT then
			if ownerKind ~= NG.NODE_FOR_EACH then error(nodeLabel(node) .. " must be inside For Each") end
		elseif node.kind == NG.NODE_FOR_EACH_GET_VAR then
			if ownerKind ~= NG.NODE_FOR_EACH then error(nodeLabel(node) .. " must be a direct child of For Each") end
			if #getInputs(node) ~= #getOutputs(node) then error(nodeLabel(node) .. " requires one paired output per input") end
			for index, inputPort in ipairs(getInputs(node)) do
				local outputPort = getOutputs(node)[index]
				local name = inputPort.name
				if type(name) ~= "string" or name == "" then error(portLabel(node, inputPort, "input") .. " requires a variable name") end
				if not outputPort or outputPort.id ~= inputPort.id or outputPort.name ~= name then error(portLabel(node, inputPort, "input") .. " requires a paired output with the same id and name") end
				if getVarsByName[name] then error("duplicate GetVar variable " .. string.format("%q", name)) end
				getVarsByName[name] = { node = node, port = inputPort }
			end
		elseif node.kind == NG.NODE_FOR_EACH_SET_VAR then
			if ownerKind ~= NG.NODE_FOR_EACH then error(nodeLabel(node) .. " must be a direct child of For Each") end
			if #getOutputs(node) ~= 0 then error(nodeLabel(node) .. " must not have outputs") end
			for _, inputPort in ipairs(getInputs(node)) do
				local name = inputPort.name
				if type(name) ~= "string" or name == "" then error(portLabel(node, inputPort, "input") .. " requires a variable name") end
				if setVarsByName[name] then error("duplicate SetVar variable " .. string.format("%q", name)) end
				setVarsByName[name] = { node = node, port = inputPort }
			end
		elseif node.kind == NG.NODE_GRAPH_OUTPUT then
			if ownerKind ~= NG.NODE_FOR_EACH then error(nodeLabel(node) .. " Graph Output must be inside For Each") end
		elseif node.kind == NG.NODE_ITERATION_CONTROL then
			if ownerKind ~= NG.NODE_FOR_EACH then error(nodeLabel(node) .. " must be inside For Each") end
			controlCount = controlCount + 1
		elseif node.kind == NG.NODE_GRAPH_INPUT or node.kind == NG.NODE_GROUP then
			error("Group boundaries must be flattened before compilation: " .. tostring(node.id))
		elseif ownerKind == NG.NODE_FOR_EACH and node.kind == NG.NODE_GOAL then
			error("Goal Nodes cannot be inside For Each: " .. tostring(node.id))
		end
	end
	if ownerKind == NG.NODE_FOR_EACH then
		if forEachInputCount == 0 then error("For Each requires at least one For Each Input") end
		if controlCount > 1 then error("For Each allows at most one Iteration Control") end
		for name, setter in pairs(setVarsByName) do
			if not getVarsByName[name] then error(portLabel(setter.node, setter.port, "input") .. " references undeclared Iteration State " .. string.format("%q", name)) end
		end
	end
end

local function validateGraph()
	validateLevel(graph, nil)
end

local function isRunTarget(node)
	return (node.kind == NG.NODE_CODE or node.kind == NG.NODE_FOR_EACH) and #getOutputs(node) == 0
end

local function findRunTargetNodes()
	local explicitGoals = {}
	local codeGoals = {}
	for _, node in ipairs(graph) do
		if node.kind == NG.NODE_GOAL then
			explicitGoals[#explicitGoals + 1] = node
		elseif isRunTarget(node) then
			codeGoals[#codeGoals + 1] = node
		end
	end
	return explicitGoals, codeGoals
end

local function luaVar(nodeId, outputId)
	return ("__ng_values[%d][%d]"):format(nodeId, outputId)
end

local function luaActiveVar(nodeId, outputId)
	return ("__ng_active[%d][%d]"):format(nodeId, outputId)
end

local function luaString(value)
	return string.format("%q", tostring(value or ""))
end

local function luaLiteral(value)
	if value == json.null then
		return "json.null"
	end

	local valueType = type(value)
	if valueType == "nil" then
		return "nil"
	elseif valueType == "string" then
		return luaString(value)
	elseif valueType == "number" then
		return tostring(value)
	elseif valueType == "boolean" then
		return value and "true" or "false"
	elseif valueType == "table" then
		local parts = {}
		local isArray = json.is_array(value)
		if isArray then
			for index = 1, #value do
				parts[#parts + 1] = luaLiteral(value[index])
			end
		else
			local keys = {}
			for key, _ in pairs(value) do
				if type(key) ~= "string" then
					error("cannot emit Lua object literal with " .. type(key) .. " key")
				end
				keys[#keys + 1] = key
			end
			table.sort(keys)
			for _, key in ipairs(keys) do
				parts[#parts + 1] = ("[%s] = %s"):format(luaString(key), luaLiteral(value[key]))
			end
		end
		if #parts == 0 then
			return isArray and "json.array()" or "json.object()"
		end
		return "{" .. table.concat(parts, ", ") .. "}"
	end
	error("cannot emit Lua literal for " .. valueType)
end

local function parseValueNodeLiteral(raw, label)
	if type(raw) ~= "string" then
		error(label .. " must be JSON literal text")
	end
	if raw == "" then
		error(label .. " must be valid JSON; blank value-node literals are not allowed")
	end
	local ok, value = pcall(json.decode, raw)
	if not ok then
		error(label .. " must be valid JSON: " .. tostring(value))
	end
	return value
end

local function bytesToString(bytes)
	local chars = {}
	for index, byte in ipairs(bytes) do
		if type(byte) ~= "number" then
			error("fs.read output byte " .. tostring(index) .. " must be a number")
		end
		chars[index] = string.char(byte)
	end
	return table.concat(chars)
end

local function unwrapFsReadOutput(raw, path)
	-- The expected PDK shape is raw fs.read bytes as a Lua string. Keep support
	-- for a wrapped JSON result too, because some host bridges expose plugin
	-- result envelopes while sync-call plumbing is evolving.
	local ok, decoded = pcall(json.decode, raw)
	if not ok or type(decoded) ~= "table" or decoded.returnCode == nil or decoded.output == nil then
		return raw
	end

	if tonumber(decoded.returnCode) ~= 0 then
		error("fs.read failed for " .. path .. ": " .. tostring(decoded.output))
	end

	if type(decoded.output) == "string" then
		return decoded.output
	end
	if type(decoded.output) == "table" then
		return bytesToString(decoded.output)
	end

	error("fs.read returned unsupported output for " .. path)
end

local function readTextFile(path)
	if type(path) ~= "string" or path == "" then
		error("code node is missing codePath")
	end
	if type(fs) ~= "table" or type(fs.read_text) ~= "function" then
		error("compile-graph.lua requires lua.comp fs.read_text(path)")
	end
	return fs.read_text(path)
end

local needed = {}
local function markNeededNode(nodeId)
	if needed[nodeId] then
		return
	end
	local node = getNode(nodeId)
	needed[nodeId] = true
	for _, inputPort in ipairs(getInputs(node)) do
		if isConnectedInput(inputPort) then
			markNeededNode(inputPort.srcNodeId)
		end
	end
end

local function collectNeededNodes(explicitGoalNodes, codeGoalNodes)
	if #explicitGoalNodes == 0 and #codeGoalNodes == 0 then
		error("graph has no goal nodes or no-output code nodes to run")
	end
	for _, goal in ipairs(explicitGoalNodes) do
		markNeededNode(goal.id)
	end
	for _, goal in ipairs(codeGoalNodes) do
		markNeededNode(goal.id)
	end
end

local visiting = {}
local visited = {}
local ordered = {}
local function visit(nodeId)
	if visited[nodeId] then
		return
	end
	if visiting[nodeId] then
		error("cycle detected at node: " .. tostring(nodeId))
	end

	visiting[nodeId] = true
	local node = getNode(nodeId)
	for _, inputPort in ipairs(getInputs(node)) do
		if isConnectedInput(inputPort) and needed[inputPort.srcNodeId] then
			visit(inputPort.srcNodeId)
		end
	end
	visiting[nodeId] = nil
	visited[nodeId] = true
	ordered[#ordered + 1] = node
end

local function orderNeededNodes()
	for _, node in ipairs(graph) do
		if needed[node.id] then
			visit(node.id)
		end
	end
end

local function orderForEachInitializers(level, getVars)
	local localNodes = {}
	local neededInitializers = {}
	local visitingInitializers = {}
	local visitedInitializers = {}
	local orderedInitializers = {}
	for _, node in ipairs(level) do localNodes[node.id] = node end

	local function markInitializer(nodeId)
		if neededInitializers[nodeId] then return end
		local node = localNodes[nodeId]
		if not node then error("GetVar initialization references missing node " .. tostring(nodeId)) end
		if node.kind ~= NG.NODE_VALUE and node.kind ~= NG.NODE_FOR_EACH_SHARED_INPUT and node.kind ~= NG.NODE_CODE then
			error(nodeLabel(node) .. " cannot participate in a GetVar initialization chain")
		end
		neededInitializers[nodeId] = true
		if node.kind == NG.NODE_FOR_EACH_SHARED_INPUT then return end
		for _, inputPort in ipairs(getInputs(node)) do
			if isConnectedInput(inputPort) then markInitializer(inputPort.srcNodeId) end
		end
	end

	for _, getVar in ipairs(getVars) do
		for _, inputPort in ipairs(getInputs(getVar)) do
			if not isConnectedInput(inputPort) then error(portLabel(getVar, inputPort, "input") .. " must be connected") end
			markInitializer(inputPort.srcNodeId)
		end
	end

	local function visitInitializer(nodeId)
		if visitedInitializers[nodeId] then return end
		if visitingInitializers[nodeId] then error("cycle detected in GetVar initialization at node: " .. tostring(nodeId)) end
		visitingInitializers[nodeId] = true
		local node = localNodes[nodeId]
		if node.kind ~= NG.NODE_FOR_EACH_SHARED_INPUT then
			for _, inputPort in ipairs(getInputs(node)) do if isConnectedInput(inputPort) then visitInitializer(inputPort.srcNodeId) end end
		end
		visitingInitializers[nodeId] = nil
		visitedInitializers[nodeId] = true
		orderedInitializers[#orderedInitializers + 1] = node
	end

	for _, node in ipairs(level) do if neededInitializers[node.id] then visitInitializer(node.id) end end
	return orderedInitializers, neededInitializers
end

local function orderForEachBody(level)
	local localNodes = {}
	local localNeeded = {}
	local localVisiting = {}
	local localVisited = {}
	local localOrdered = {}
	for _, node in ipairs(level) do localNodes[node.id] = node end

	local function mark(nodeId)
		if localNeeded[nodeId] then return end
		local node = localNodes[nodeId]
		if not node then error("For Each body references missing node " .. tostring(nodeId)) end
		localNeeded[nodeId] = true
		if node.kind == NG.NODE_FOR_EACH_GET_VAR then return end
		for _, inputPort in ipairs(getInputs(node)) do
			if isConnectedInput(inputPort) then mark(inputPort.srcNodeId) end
		end
	end

	for _, node in ipairs(level) do
		if node.kind == NG.NODE_GRAPH_OUTPUT or node.kind == NG.NODE_ITERATION_CONTROL or node.kind == NG.NODE_FOR_EACH_SET_VAR or isRunTarget(node) then mark(node.id) end
	end

	local function visitLocal(nodeId)
		if localVisited[nodeId] then return end
		if localVisiting[nodeId] then error("cycle detected at node: " .. tostring(nodeId)) end
		localVisiting[nodeId] = true
		local node = localNodes[nodeId]
		if node.kind ~= NG.NODE_FOR_EACH_GET_VAR then
			for _, inputPort in ipairs(getInputs(node)) do
				if isConnectedInput(inputPort) and localNeeded[inputPort.srcNodeId] then visitLocal(inputPort.srcNodeId) end
			end
		end
		localVisiting[nodeId] = nil
		localVisited[nodeId] = true
		localOrdered[#localOrdered + 1] = node
	end

	for _, node in ipairs(level) do if localNeeded[node.id] then visitLocal(node.id) end end
	return localOrdered
end

local lines = {}
local function emit(line)
	lines[#lines + 1] = line or ""
end

local function emitOutputDeclarations(node)
	emit(("__ng_values[%d] = {}"):format(node.id))
	emit(("__ng_active[%d] = {}"):format(node.id))
end

local function emitProgressHelpers()
	if progressSource ~= "" then
		emit(progressSource)
		emit("")
	end
	emit("if type(__ng_progress) ~= \"function\" then")
	emit("  function __ng_progress(method, nodeId, message)")
	emit("  end")
	emit("end")
	emit("")
	emit("local function __ng_node_start(nodeId)")
	emit("  __ng_progress(\"nodeStart\", nodeId)")
	emit("end")
	emit("")
	emit("local function __ng_node_done(nodeId)")
	emit("  __ng_progress(\"nodeDone\", nodeId)")
	emit("end")
	emit("")
	emit("local function __ng_node_error(nodeId, message)")
	emit("  __ng_progress(\"nodeError\", nodeId, message)")
	emit("end")
	emit("")
	emit("local function __ng_goal_start(goalId)")
	emit("  __ng_progress(\"goalStart\", goalId)")
	emit("end")
	emit("")
	emit("local function __ng_goal_done(goalId)")
	emit("  __ng_progress(\"goalDone\", goalId)")
	emit("end")
	emit("")
	emit("local function __ng_active_value(active, value)")
	emit("  if active then")
	emit("    return value")
	emit("  end")
	emit("  return nil")
	emit("end")
	emit("")
end

local function nodeActiveExpr(node)
	local activeExprs = {}
	for _, inputPort in ipairs(getInputs(node)) do
		if isConnectedInput(inputPort) then
			activeExprs[#activeExprs + 1] = luaActiveVar(inputPort.srcNodeId, inputPort.srcOutputId)
		end
	end
	if #activeExprs == 0 then
		return "true"
	end
	return table.concat(activeExprs, " or ")
end

local function emitInactiveOutputs(node, indent)
	indent = indent or ""
	for _, outputPort in ipairs(getOutputs(node)) do
		emit(("%s%s = nil"):format(indent, luaVar(node.id, outputPort.id)))
		emit(("%s%s = false"):format(indent, luaActiveVar(node.id, outputPort.id)))
	end
end

local function emitValueAssignments(node, indent)
	indent = indent or ""
	for _, outputPort in ipairs(getOutputs(node)) do
		local label = portLabel(node, outputPort, "output") .. ".value"
		local value = parseValueNodeLiteral(outputPort.value, label)
		emit(("%s%s = %s"):format(indent, luaVar(node.id, outputPort.id), luaLiteral(value)))
		emit(("%s%s = true"):format(indent, luaActiveVar(node.id, outputPort.id)))
	end
end

local function emitValueNode(node)
	emit(("-- value node %d: %s"):format(node.id, node.name or ""))
	emit(("__ng_node_active = %s"):format(nodeActiveExpr(node)))
	emit("if __ng_node_active then")
	emit(("  __ng_node_start(%d)"):format(node.id))
	emitValueAssignments(node, "  ")
	emit(("  __ng_node_done(%d)"):format(node.id))
	emit("else")
	emitInactiveOutputs(node, "  ")
	emit("end")
	emit("")
end

local function emitInputAssignments(node)
	for _, inputPort in ipairs(getInputs(node)) do
		local activeExpr = "false"
		if isConnectedInput(inputPort) then
			local sourceActive = luaActiveVar(inputPort.srcNodeId, inputPort.srcOutputId)
			local sourceValue = luaVar(inputPort.srcNodeId, inputPort.srcOutputId)
			activeExpr = sourceActive
			emit(("  if %s then"):format(sourceActive))
			emit(("    inputs[%d] = %s"):format(inputPort.id, sourceValue))
			if inputPort.name and inputPort.name ~= "" then
				emit(("    inputs[%s] = %s"):format(luaString(inputPort.name), sourceValue))
			end
			emit("  else")
			emit(("    inputs[%d] = nil"):format(inputPort.id))
			if inputPort.name and inputPort.name ~= "" then
				emit(("    inputs[%s] = nil"):format(luaString(inputPort.name)))
			end
			emit("  end")
		else
			emit(("  inputs[%d] = nil"):format(inputPort.id))
			if inputPort.name and inputPort.name ~= "" then
				emit(("  inputs[%s] = nil"):format(luaString(inputPort.name)))
			end
		end
		emit(("  inputs.active[%d] = %s"):format(inputPort.id, activeExpr))
		if inputPort.name and inputPort.name ~= "" then
			emit(("  inputs.active[%s] = %s"):format(luaString(inputPort.name), activeExpr))
			emit(("  inputs.names[%d] = %s"):format(inputPort.id, luaString(inputPort.name)))
		end
	end
end

local function emitUserCode(source)
	for line in tostring(source):gmatch("([^\n]*)\n?") do
		if line == "" then
			emit("")
		else
			emit("  " .. line)
		end
	end
end

local function emitOutputDefaults(node)
	for _, outputPort in ipairs(getOutputs(node)) do
		emit(("  outputs.active[%d] = true"):format(outputPort.id))
		if outputPort.name and outputPort.name ~= "" then
			emit(("  outputs.active[%s] = true"):format(luaString(outputPort.name)))
			emit(("  outputs.names[%d] = %s"):format(outputPort.id, luaString(outputPort.name)))
		end
	end
end

local function portDisplay(port)
	local text = tostring(port.id)
	if port.name and port.name ~= "" then
		text = text .. " " .. string.format("%q", port.name)
	end
	return text
end

local function emitCodeNodeErrorHandler(node)
	emit("  end, function(err)")
	emit("    local __ng_lines = {")
	emit(("      %s,"):format(luaString("error in " .. nodeLabel(node) .. " (" .. tostring(node.codePath or "") .. ")")))
	emit("      'cause: ' .. tostring(err),")
	emit("      'inputs:',")
	for _, inputPort in ipairs(getInputs(node)) do
		local source = "unconnected"
		if isConnectedInput(inputPort) then
			local sourceNode = getNode(inputPort.srcNodeId)
			source = nodeLabel(sourceNode) .. " output " .. portDisplay({ id = inputPort.srcOutputId, name = "" })
			for _, outputPort in ipairs(getOutputs(sourceNode)) do
				if outputPort.id == inputPort.srcOutputId then
					source = nodeLabel(sourceNode) .. " output " .. portDisplay(outputPort)
					break
				end
			end
		end
		emit(("      %s .. __ng_value_type(inputs[%d]),"):format(luaString("  input " .. portDisplay(inputPort) .. " <- " .. source .. ": "), inputPort.id))
	end
	emit("      'outputs:',")
	for _, outputPort in ipairs(getOutputs(node)) do
		emit(("      %s .. __ng_value_type(outputs[%d]),"):format(luaString("  output " .. portDisplay(outputPort) .. ": "), outputPort.id))
	end
	emit("    }")
	emit("    return table.concat(__ng_lines, '\\n')")
	emit("  end)")
end

local function emitForEachHelpers()
	emit("local function __ng_require_dense_array(value, label)")
	emit("  if type(value) ~= 'table' then")
	emit("    error(label .. ' must be a dense array, got ' .. type(value))")
	emit("  end")
	emit("  local count = 0")
	emit("  local maximum = 0")
	emit("  for key, _ in pairs(value) do")
	emit("    if type(key) ~= 'number' or key ~= math.floor(key) or key < 1 then")
	emit("      error(label .. ' must be a dense array')")
	emit("    end")
	emit("    count = count + 1")
	emit("    if key > maximum then maximum = key end")
	emit("  end")
	emit("  if count ~= maximum then error(label .. ' must be a dense array') end")
	emit("  if count == 0 and type(json.is_array) == 'function' and not json.is_array(value) then")
	emit("    error(label .. ' must be an array, not an object')")
	emit("  end")
	emit("  return maximum")
	emit("end")
	emit("")
end

local function emitValueTypeHelper()
	emit("local function __ng_value_type(value)")
	emit("  if value == nil then")
	emit("    return 'nil'")
	emit("  end")
	emit("  local valueType = type(value)")
	emit("  if valueType ~= 'table' then")
	emit("    return valueType")
	emit("  end")
	emit("  local length = 0")
	emit("  for key, _ in pairs(value) do")
	emit("    if type(key) ~= 'number' or key ~= math.floor(key) or key < 1 then")
	emit("      return 'object'")
	emit("    end")
	emit("    if key > length then")
	emit("      length = key")
	emit("    end")
	emit("  end")
	emit("  for index = 1, length do")
	emit("    if value[index] == nil then")
	emit("      return 'object'")
	emit("    end")
	emit("  end")
	emit("  return 'array'")
	emit("end")
	emit("")
end

local function emitOutputAssignments(node)
	for _, outputPort in ipairs(getOutputs(node)) do
		local outVar = luaVar(node.id, outputPort.id)
		local activeVar = luaActiveVar(node.id, outputPort.id)
		emit(("  %s = outputs[%d]"):format(outVar, outputPort.id))
		if outputPort.name and outputPort.name ~= "" then
			emit(("  %s = outputs.active[%d] ~= false and outputs.active[%s] ~= false"):format(activeVar, outputPort.id, luaString(outputPort.name)))
			emit(("  -- output %s -> %s"):format(luaString(outputPort.name), outVar))
		else
			emit(("  %s = outputs.active[%d] ~= false"):format(activeVar, outputPort.id))
		end
	end
end

local function emitCodeNode(node)
	local source = readTextFile(node.codePath)

	emit(("-- code node %d: %s"):format(node.id, node.name or ""))
	emit(("__ng_node_active = %s"):format(nodeActiveExpr(node)))
	emit("if __ng_node_active then")
	emit(("  __ng_node_start(%d)"):format(node.id))
	emit("  local inputs = { active = {}, names = {} }")
	emit("  local outputs = { active = {}, names = {} }")
	emit("  _G.inputs = inputs")
	emit("  _G.outputs = outputs")
	emit("  __ng_ok, __ng_err = xpcall(function()")
	emitInputAssignments(node)
	emitOutputDefaults(node)
	emit("")
	emit("  -- begin user code: " .. node.codePath)
	emitUserCode(source)
	emit("  -- end user code")
	emit("")
	emitOutputAssignments(node)
	emitCodeNodeErrorHandler(node)
	emit("  if not __ng_ok then")
	emit(("    __ng_node_error(%d, __ng_err)"):format(node.id))
	emit("    error(__ng_err)")
	emit("  end")
	emit(("  __ng_node_done(%d)"):format(node.id))
	emit("else")
	emitInactiveOutputs(node, "  ")
	emit("end")
	emit("")
end

local emitNode

local function emitForEachControlValue(node, inputPort, variableName)
	emit(("  local %s = false"):format(variableName))
	if not isConnectedInput(inputPort) then return end
	local activeVar = luaActiveVar(inputPort.srcNodeId, inputPort.srcOutputId)
	local valueVar = luaVar(inputPort.srcNodeId, inputPort.srcOutputId)
	emit(("  if %s then"):format(activeVar))
	emit(("    if type(%s) ~= 'boolean' then"):format(valueVar))
	emit(("      __ng_node_error(%d, %s)"):format(node.id, luaString(portLabel(node, inputPort, "input") .. " must be boolean")))
	emit(("      error(%s)"):format(luaString(portLabel(node, inputPort, "input") .. " must be boolean")))
	emit("    end")
	emit(("    %s = %s"):format(variableName, valueVar))
	emit("  end")
end

local function emitForEachNode(node)
	local child = node.childGraph
	local boundaries = {}
	local sharedInputs = {}
	local getVars = {}
	local setVars = {}
	local collectors = {}
	local control = nil
	for _, childNode in ipairs(child) do
		if childNode.kind == NG.NODE_FOR_EACH_INPUT then boundaries[#boundaries + 1] = childNode end
		if childNode.kind == NG.NODE_FOR_EACH_SHARED_INPUT then sharedInputs[#sharedInputs + 1] = childNode end
		if childNode.kind == NG.NODE_FOR_EACH_GET_VAR then getVars[#getVars + 1] = childNode end
		if childNode.kind == NG.NODE_FOR_EACH_SET_VAR then setVars[#setVars + 1] = childNode end
		if childNode.kind == NG.NODE_GRAPH_OUTPUT then collectors[#collectors + 1] = childNode end
		if childNode.kind == NG.NODE_ITERATION_CONTROL then control = childNode end
	end
	local initializerOrder, initializerIds = orderForEachInitializers(child, getVars)
	local bodyOrder = orderForEachBody(child)

	for _, inputPort in ipairs(getInputs(node)) do
		if not isConnectedInput(inputPort) then error(portLabel(node, inputPort, "input") .. " must be connected") end
	end
	for _, collector in ipairs(collectors) do
		if not isConnectedInput(collector.inputs[1]) then error(nodeLabel(collector) .. " must be connected") end
	end
	for _, setVar in ipairs(setVars) do
		for _, inputPort in ipairs(getInputs(setVar)) do
			if not isConnectedInput(inputPort) then error(portLabel(setVar, inputPort, "input") .. " must be connected") end
		end
	end

	emit(("-- for each node %d: %s"):format(node.id, node.name or ""))
	emit(("__ng_node_start(%d)"):format(node.id))
	for _, childNode in ipairs(child) do emitOutputDeclarations(childNode) end
	emit(("local __ng_each_arrays_%d = {}"):format(node.id))
	emit(("local __ng_each_lengths_%d = {}"):format(node.id))
	emit(("local __ng_each_count_%d = nil"):format(node.id))
	for _, boundary in ipairs(boundaries) do
		local parentInput = nil
		for _, inputPort in ipairs(getInputs(node)) do if inputPort.id == boundary.id then parentInput = inputPort end end
		if not parentInput then error(nodeLabel(node) .. " missing input for For Each Input " .. tostring(boundary.id)) end
		local sourceActive = luaActiveVar(parentInput.srcNodeId, parentInput.srcOutputId)
		local sourceValue = luaVar(parentInput.srcNodeId, parentInput.srcOutputId)
		emit(("if not %s then"):format(sourceActive))
		emit(("  __ng_node_error(%d, %s)"):format(node.id, luaString(portLabel(node, parentInput, "input") .. " must be active")))
		emit(("  error(%s)"):format(luaString(portLabel(node, parentInput, "input") .. " must be active")))
		emit("end")
		emit(("__ng_each_arrays_%d[%d] = %s"):format(node.id, boundary.id, sourceValue))
		local validationOk = ("__ng_each_array_ok_%d_%d"):format(node.id, boundary.id)
		local validationResult = ("__ng_each_array_result_%d_%d"):format(node.id, boundary.id)
		emit(("local %s, %s = pcall(__ng_require_dense_array, %s, %s)"):format(validationOk, validationResult, sourceValue, luaString(portLabel(node, parentInput, "input"))))
		emit(("if not %s then"):format(validationOk))
		emit(("  __ng_node_error(%d, %s)"):format(node.id, validationResult))
		emit(("  error(%s)"):format(validationResult))
		emit("end")
		emit(("__ng_each_lengths_%d[%d] = %s"):format(node.id, boundary.id, validationResult))
		emit(("if __ng_each_count_%d == nil then"):format(node.id))
		emit(("  __ng_each_count_%d = __ng_each_lengths_%d[%d]"):format(node.id, node.id, boundary.id))
		emit(("elseif __ng_each_lengths_%d[%d] ~= __ng_each_count_%d then"):format(node.id, boundary.id, node.id))
		emit(("  local __ng_each_length_error_%d = %s .. ' has length ' .. tostring(__ng_each_lengths_%d[%d]) .. ', expected ' .. tostring(__ng_each_count_%d) .. '; For Each inputs must have equal lengths'"):format(node.id, luaString(portLabel(node, parentInput, "input")), node.id, boundary.id, node.id))
		emit(("  __ng_node_error(%d, __ng_each_length_error_%d)"):format(node.id, node.id))
		emit(("  error(__ng_each_length_error_%d)"):format(node.id))
		emit("end")
	end
	for _, sharedInput in ipairs(sharedInputs) do
		local parentInput = nil
		for _, inputPort in ipairs(getInputs(node)) do if inputPort.id == sharedInput.id then parentInput = inputPort end end
		if not parentInput then error(nodeLabel(node) .. " missing input for Shared Input " .. tostring(sharedInput.id)) end
		local sourceActive = luaActiveVar(parentInput.srcNodeId, parentInput.srcOutputId)
		local sourceValue = luaVar(parentInput.srcNodeId, parentInput.srcOutputId)
		emit(("if not %s then"):format(sourceActive))
		emit(("  __ng_node_error(%d, %s)"):format(node.id, luaString(portLabel(node, parentInput, "input") .. " must be active")))
		emit(("  error(%s)"):format(luaString(portLabel(node, parentInput, "input") .. " must be active")))
		emit("end")
		emit(("%s = %s"):format(luaVar(sharedInput.id, 1), sourceValue))
		emit(("%s = true"):format(luaActiveVar(sharedInput.id, 1)))
	end
	for _, outputPort in ipairs(getOutputs(node)) do
		emit(("%s = %s"):format(luaVar(node.id, outputPort.id), outputPort.stateNodeId == nil and "json.array()" or "nil"))
		emit(("%s = false"):format(luaActiveVar(node.id, outputPort.id)))
	end
	local stateVariable = "__ng_each_state_" .. tostring(node.id)
	emit(("local %s = {}"):format(stateVariable))
	for _, initializer in ipairs(initializerOrder) do
		if initializer.kind ~= NG.NODE_FOR_EACH_SHARED_INPUT then emitNode(initializer) end
	end
	for _, getVar in ipairs(getVars) do
		for _, inputPort in ipairs(getInputs(getVar)) do
			local sourceActive = luaActiveVar(inputPort.srcNodeId, inputPort.srcOutputId)
			local sourceValue = luaVar(inputPort.srcNodeId, inputPort.srcOutputId)
			local message = portLabel(getVar, inputPort, "input") .. " must provide an active, non-nil initial value"
			emit(("  if not %s or %s == nil then"):format(sourceActive, sourceValue))
			emit(("    __ng_node_error(%d, %s)"):format(node.id, luaString(message)))
			emit(("    error(%s)"):format(luaString(message)))
			emit("  end")
			emit(("  %s[%s] = %s"):format(stateVariable, luaString(inputPort.name), sourceValue))
		end
	end
	emit(("for __ng_each_index_%d = 1, __ng_each_count_%d do"):format(node.id, node.id))
	for _, boundary in ipairs(boundaries) do
		emit(("  %s = __ng_each_arrays_%d[%d][__ng_each_index_%d]"):format(luaVar(boundary.id, 1), node.id, boundary.id, node.id))
		emit(("  %s = true"):format(luaActiveVar(boundary.id, 1)))
		emit(("  %s = __ng_each_index_%d"):format(luaVar(boundary.id, 2), node.id))
		emit(("  %s = true"):format(luaActiveVar(boundary.id, 2)))
		emit(("  %s = __ng_each_arrays_%d[%d]"):format(luaVar(boundary.id, 3), node.id, boundary.id))
		emit(("  %s = true"):format(luaActiveVar(boundary.id, 3)))
	end
	for _, getVar in ipairs(getVars) do
		for _, outputPort in ipairs(getOutputs(getVar)) do
			emit(("  %s = %s[%s]"):format(luaVar(getVar.id, outputPort.id), stateVariable, luaString(outputPort.name)))
			emit(("  %s = true"):format(luaActiveVar(getVar.id, outputPort.id)))
		end
	end
	for _, childNode in ipairs(bodyOrder) do
		if not initializerIds[childNode.id] and childNode.kind ~= NG.NODE_FOR_EACH_INPUT and childNode.kind ~= NG.NODE_FOR_EACH_SHARED_INPUT and childNode.kind ~= NG.NODE_FOR_EACH_GET_VAR and childNode.kind ~= NG.NODE_FOR_EACH_SET_VAR and childNode.kind ~= NG.NODE_GRAPH_OUTPUT and childNode.kind ~= NG.NODE_ITERATION_CONTROL then emitNode(childNode) end
	end
	local skipVariable = "__ng_each_skip_" .. tostring(node.id)
	local breakVariable = "__ng_each_break_" .. tostring(node.id)
	if control then
		emitForEachControlValue(control, control.inputs[1], skipVariable)
		emitForEachControlValue(control, control.inputs[2], breakVariable)
	else
		emit(("  local %s = false"):format(skipVariable))
		emit(("  local %s = false"):format(breakVariable))
	end
	local nextStateVariable = "__ng_each_next_state_" .. tostring(node.id)
	emit(("  local %s = {}"):format(nextStateVariable))
	for _, setVar in ipairs(setVars) do
		for _, inputPort in ipairs(getInputs(setVar)) do
			local sourceActive = luaActiveVar(inputPort.srcNodeId, inputPort.srcOutputId)
			local sourceValue = luaVar(inputPort.srcNodeId, inputPort.srcOutputId)
			local message = portLabel(setVar, inputPort, "input") .. " must not produce an active nil update"
			emit(("  if %s then"):format(sourceActive))
			emit(("    if %s == nil then"):format(sourceValue))
			emit(("      __ng_node_error(%d, %s)"):format(node.id, luaString(message)))
			emit(("      error(%s)"):format(luaString(message)))
			emit("    end")
			emit(("    %s[%s] = %s"):format(nextStateVariable, luaString(inputPort.name), sourceValue))
			emit("  end")
		end
	end
	for _, collector in ipairs(collectors) do
		local parentOutput = nil
		for _, outputPort in ipairs(getOutputs(node)) do if outputPort.id == collector.id then parentOutput = outputPort end end
		if not parentOutput then error(nodeLabel(node) .. " missing output for Graph Output " .. tostring(collector.id)) end
		local inputPort = collector.inputs[1]
		local sourceActive = luaActiveVar(inputPort.srcNodeId, inputPort.srcOutputId)
		local sourceValue = luaVar(inputPort.srcNodeId, inputPort.srcOutputId)
		emit(("  if not %s and not %s then"):format(breakVariable, skipVariable))
		emit(("    if not %s or %s == nil then"):format(sourceActive, sourceValue))
		emit(("      __ng_node_error(%d, %s)"):format(node.id, luaString(nodeLabel(collector) .. " must produce an active, non-nil value")))
		emit(("      error(%s)"):format(luaString(nodeLabel(collector) .. " must produce an active, non-nil value")))
		emit("    end")
		emit(("    %s[#%s + 1] = %s"):format(luaVar(node.id, parentOutput.id), luaVar(node.id, parentOutput.id), sourceValue))
		emit("  end")
	end
	emit(("  for __ng_state_name, __ng_state_value in pairs(%s) do %s[__ng_state_name] = __ng_state_value end"):format(nextStateVariable, stateVariable))
	emit(("  if %s then break end"):format(breakVariable))
	emit("end")
	for _, outputPort in ipairs(getOutputs(node)) do
		if outputPort.stateNodeId ~= nil then emit(("%s = %s[%s]"):format(luaVar(node.id, outputPort.id), stateVariable, luaString(outputPort.name))) end
		emit(("%s = true"):format(luaActiveVar(node.id, outputPort.id)))
	end
	emit(("__ng_node_done(%d)"):format(node.id))
	emit("")
end

emitNode = function(node)
	if node.kind == NG.NODE_VALUE then
		emitValueNode(node)
	elseif node.kind == NG.NODE_CODE then
		emitCodeNode(node)
	elseif node.kind == NG.NODE_FOR_EACH then
		emitForEachNode(node)
	elseif node.kind == NG.NODE_GOAL then
		-- Goal nodes are emitted in the final output block.
	elseif node.kind == NG.NODE_FOR_EACH_INPUT or node.kind == NG.NODE_FOR_EACH_SHARED_INPUT or node.kind == NG.NODE_FOR_EACH_GET_VAR or node.kind == NG.NODE_FOR_EACH_SET_VAR or node.kind == NG.NODE_GRAPH_OUTPUT or node.kind == NG.NODE_ITERATION_CONTROL then
		-- For Each boundaries are emitted by their owning For Each Node.
	elseif node.kind == NG.NODE_GROUP or node.kind == NG.NODE_GRAPH_INPUT then
		error("Group Nodes must be flattened before compilation: " .. tostring(node.id))
	else
		error("unknown node kind " .. tostring(node.kind) .. " at node " .. tostring(node.id))
	end
end

local function emitFinalOutput(goalNodes)
	emit("local output = {")
	for _, goal in ipairs(goalNodes) do
		emit(("  [%s] = {"):format(luaString(goal.name ~= "" and goal.name or ("goal_" .. tostring(goal.id)))))
		emit(("    id = %d,"):format(goal.id))
		emit("    inputs = {")
		for _, inputPort in ipairs(getInputs(goal)) do
			local valueExpr = "nil"
			if isConnectedInput(inputPort) then
				valueExpr = ("__ng_active_value(%s, %s)"):format(luaActiveVar(inputPort.srcNodeId, inputPort.srcOutputId), luaVar(inputPort.srcNodeId, inputPort.srcOutputId))
			end
			local key = inputPort.name ~= "" and inputPort.name or tostring(inputPort.id)
			emit(("      [%s] = %s,"):format(luaString(key), valueExpr))
		end
		emit("    },")
		emit("    active = {")
		for _, inputPort in ipairs(getInputs(goal)) do
			local activeExpr = "false"
			if isConnectedInput(inputPort) then
				activeExpr = luaActiveVar(inputPort.srcNodeId, inputPort.srcOutputId)
			end
			local key = inputPort.name ~= "" and inputPort.name or tostring(inputPort.id)
			emit(("      [%s] = %s,"):format(luaString(key), activeExpr))
		end
		emit("    },")
		emit("  },")
		emit(("  -- goal %d complete"):format(goal.id))
		emit(("  -- __ng_goal_done(%d) is called after output construction"):format(goal.id))
	end
	emit("}")
	for _, goal in ipairs(goalNodes) do
		emit(("__ng_goal_start(%d)"):format(goal.id))
		emit(("__ng_goal_done(%d)"):format(goal.id))
	end
	emit("return output")
end

validateGraph()
local goalNodes, codeGoalNodes = findRunTargetNodes()
collectNeededNodes(goalNodes, codeGoalNodes)
orderNeededNodes()

emit("-- Generated Lua file")
emit("-- Do not edit manually")
emit("")
emit("function main()")
emitProgressHelpers()
emitValueTypeHelper()
emitForEachHelpers()
emit("local __ng_values = {}")
emit("local __ng_active = {}")
emit("local __ng_node_active = false")
emit("local __ng_ok = true")
emit("local __ng_err = nil")
emit("")

for _, node in ipairs(ordered) do
	emitOutputDeclarations(node)
end
emit("")

for _, node in ipairs(ordered) do
	emitNode(node)
end

emitFinalOutput(goalNodes)
emit("end")

return table.concat(lines, "\n")
end
