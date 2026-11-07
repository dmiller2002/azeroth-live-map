local _, ns = ...
local function Finite(n)
    return ns.IsReadable(n) and type(n) == "number" and n == n and n > -math.huge and n < math.huge
end
local function ID(id) return Finite(id) and id > 0 and id < 16777216 end
local function Text(value)
    if not ns.IsReadable(value) or type(value) ~= "string" then return "" end
    value = value:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("[%c]", " ")
    if #value > 80 then
        local cut = 81
        while cut > 1 and value:byte(cut) >= 128 and value:byte(cut) < 192 do cut = cut - 1 end
        value = value:sub(1, cut - 1)
    end
    return value
end

local function Collect(currentMap)
    local api = C_QuestLog
    if not api or not api.GetInfo or not (api.GetQuestsOnMap or api.GetNextWaypoint) then return {}, 0 end
    local accepted, result, seen = {}, {}, {}
    for index = 1, 512 do
        local info = api.GetInfo(index)
        if ns.IsReadable(info) and info == nil then break end
        if ns.IsReadable(info) and type(info) == "table" and ID(info.questID) and ns.IsReadable(info.isHeader) and not info.isHeader then
            local failed = api.IsFailed and api.IsFailed(info.questID)
            if ns.IsReadable(failed) and not failed then accepted[info.questID] = info end
        end
    end
    local function Add(mapID, questID, x, y)
        if not ID(questID) or not accepted[questID] or not Finite(mapID) or mapID < 1 or mapID > 65535
            or not Finite(x) or not Finite(y) or x < 0 or x > 1 or y < 0 or y > 1 then return end
        local complete = api.IsComplete and api.IsComplete(questID)
        if not ns.IsReadable(complete) then return end
        local kind = complete and 3 or 2
        local px, py = math.floor(x * 65535 + .5), math.floor(y * 65535 + .5)
        local key = table.concat({mapID, questID, kind, px, py}, ":")
        if seen[key] then return end
        seen[key] = true
        local title = Text(accepted[questID].title)
        if title == "" then title = "Quest #" .. questID end
        result[mapID] = result[mapID] or {}
        result[mapID][#result[mapID] + 1] = {questID=questID,kind=kind,iconType=complete and 8 or 3,
            objective=0,x=px,y=py,collected=0,needed=0,title=title,key=key}
    end
    -- Read Blizzard's POIs for all known maps; never select a quest, change the
    -- in-game map, alter CVars, or depend on Questie's frames being present.
    if api.GetQuestsOnMap then
        for _, mapID in ipairs(ns.NativeMapIDs(currentMap)) do
            local info = C_Map and C_Map.GetMapInfo and C_Map.GetMapInfo(mapID)
            if ns.IsReadable(info) and (info == nil or (type(info) == "table" and Finite(info.mapType) and info.mapType >= 3)) then
                local pins = api.GetQuestsOnMap(mapID)
                if ns.IsReadable(pins) and type(pins) == "table" then
                    for _, pin in ipairs(pins) do
                        if ns.IsReadable(pin) and type(pin) == "table" and ns.IsReadable(pin.isMapIndicatorQuest) and not pin.isMapIndicatorQuest then
                            Add(mapID, pin.questID, pin.x, pin.y)
                        end
                    end
                end
            end
        end
    end
    if api.GetNextWaypoint then
        for questID in pairs(accepted) do
            local ok, mapID, x, y = pcall(api.GetNextWaypoint, questID)
            if ok then Add(mapID, questID, x, y) end
        end
    end
    return result, 1
end

ns.NativeQuestPacket = ns.CreateQuestStream(Collect, 11)
