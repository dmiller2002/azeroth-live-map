local _, ns = ...
-- Bootstrap the shipped maps, then discover the current client's descendants.
local known = {946,947,1414,1415,1416,1459,1461,1417,1440,1447,1418,1419,1428,1439,1457,1430,1443,1426,1411,1431,1445,1423,1429,1448,1444,1424,1455,1432,1450,1412,1454,1433,1427,1451,1421,1442,1453,1434,1435,1446,1438,1413,1425,1441,1456,1420,1449,1458,1460,1422,1436,1437,1452,2482,2521,2524,2548,2652,2665}
local ids, seen, cursor, nextDiscovery = {}, {}, 1, 0
local urgent, previousMap = {}, nil
local function Finite(n)
    return ns.IsReadable(n) and type(n) == "number" and n == n and n > -math.huge and n < math.huge
end
local function ID(id) return Finite(id) and id > 0 and id <= 65535 and id == math.floor(id) end
local function Add(id)
    if ID(id) and not seen[id] and #ids < 512 then seen[id] = true; ids[#ids + 1] = id end
end
for _, id in ipairs(known) do Add(id) end

function ns.NativeMapIDs(currentMap)
    Add(currentMap)
    local now = GetTime and GetTime() or 0
    if now >= nextDiscovery and C_Map and C_Map.GetMapChildrenInfo then
        nextDiscovery = now + 30
        local ok, children = pcall(C_Map.GetMapChildrenInfo, 946, nil, true)
        if ok and ns.IsReadable(children) and type(children) == "table" then
            for _, info in ipairs(children) do
                if ns.IsReadable(info) and type(info) == "table" and Finite(info.mapType) and info.mapType <= 3 then Add(info.mapID) end
            end
        end
    end
    return ids
end

local function Record(id)
    local ok, info = pcall(C_Map.GetMapInfo, id)
    if not ok or not ns.IsReadable(info) or type(info) ~= "table" then return end
    local parent, mapType = info.parentMapID, info.mapType
    if not Finite(parent) or parent < 0 or parent > 65535 or not Finite(mapType) or mapType < 0 or mapType > 6 or parent == id then return end
    local minX, maxX, minY, maxY = 0, 1, 0, 1
    if parent > 0 then
        local success
        success, minX, maxX, minY, maxY = pcall(C_Map.GetMapRectOnMap, id, parent)
        if not success then return end
    end
    for _, value in ipairs({minX, maxX, minY, maxY}) do
        if not Finite(value) or value < -4 or value >= 4 then return end
    end
    if not (Finite(minX) and Finite(maxX) and Finite(minY) and Finite(maxY)) or minX >= maxX or minY >= maxY then return end
    local payload = {mapType}
    -- Signed fixed point, [-4,4), preserves rectangles that extend off-map.
    for _, value in ipairs({minX, maxX, minY, maxY}) do
        local n = math.floor(value * 8192 + .5) + 32768
        if n > 65535 then return end
        payload[#payload + 1], payload[#payload + 2] = math.floor(n / 256), n % 256
    end
    return parent, payload
end

function ns.MapDataPacket(mapID, sequence)
    if not C_Map or not C_Map.GetMapInfo or not C_Map.GetMapRectOnMap then return end
    ns.NativeMapIDs(mapID)
    if mapID ~= previousMap then
        previousMap = mapID; urgent = {}
        local current, visited = mapID, {}
        while ID(current) and not visited[current] and #urgent < 12 do
            visited[current] = true; urgent[#urgent + 1] = current; Add(current)
            current = Record(current)
        end
    end
    for _ = 1, #ids + #urgent do
        local id = table.remove(urgent, 1)
        if not id then id = ids[cursor]; cursor = cursor % #ids + 1 end
        local parent, payload = Record(id)
        if parent then return ns.EncodeQuest(0, sequence, id, ns.QuestSession, parent, payload, 12) end
    end
end
