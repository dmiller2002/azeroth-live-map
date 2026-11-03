local _, ns = ...

-- Forever uses Retail's project ID. Detect the client by its interface version.
local interface = GetBuildInfo and select(4, GetBuildInfo()) or 0
ns.IsForever = interface >= 16000 and interface < 17000

function ns.IsReadable(value)
    return not (issecretvalue and issecretvalue(value))
end

function ns.PlayerPosition()
    local ok, map, x, y, facing = pcall(function()
        if not C_Map or not C_Map.GetBestMapForUnit or not C_Map.GetPlayerMapPosition then return end
        local map = C_Map.GetBestMapForUnit("player")
        if not ns.IsReadable(map) or type(map) ~= "number" then return end
        local pos = C_Map.GetPlayerMapPosition(map, "player")
        if not ns.IsReadable(pos) or not pos then return map end
        local x, y = pos:GetXY()
        if not ns.IsReadable(x) or not ns.IsReadable(y) or type(x) ~= "number" or type(y) ~= "number"
            or x < 0 or x > 1 or y < 0 or y > 1 or (x == 0 and y == 0) then return map end
        local facing = GetPlayerFacing and GetPlayerFacing()
        if not ns.IsReadable(facing) then facing = nil end
        return map, x, y, facing
    end)
    if ok then return map, x, y, facing end
end
