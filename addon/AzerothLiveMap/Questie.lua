local _, ns = ...
local MAX_MARKERS, MAX_PER_OBJECTIVE = 96, 4
local generation, snapshot, queue, cursor, sent = 0, nil, {}, 1, 0
local nextRefresh = 0
local kinds = { available = 1, monster = 2, object = 2, item = 2, event = 2, complete = 3 }

local function Finite(n)
    return type(n) == "number" and n == n and n > -math.huge and n < math.huge
end

local function Count(n)
    return math.floor(math.max(0, math.min(255, Finite(n) and n or 0)))
end

local function Collect(mapID, px, py)
    local result = { mapID = mapID or 0, status = 0, markers = {}, limited = false }
    if not QuestieLoader or type(QuestieLoader.ImportModule) ~= "function" then return result end
    result.status = 2 -- Loading or an incompatible Questie version.
    local map = QuestieLoader:ImportModule("QuestieMap")
    if type(map) ~= "table" or type(map.questIdFrames) ~= "table" then return result end
    local candidates, seen = {}, {}
    for questID, names in pairs(map.questIdFrames) do
        if Finite(questID) and questID > 0 and questID < 16777216 and type(names) == "table" then
            for _, name in pairs(names) do
                local icon = type(name) == "string" and _G[name] or nil
                local data = icon and icon.data
                local kind = data and kinds[data.Type]
                -- IsShown() is deliberately unused: the world map can be closed.
                if kind and icon.miniMapIcon == false and icon.UiMapID == mapID
                    and Finite(icon.x) and Finite(icon.y) and icon.x >= 0 and icon.x <= 100 and icon.y >= 0 and icon.y <= 100
                    and (not icon.ShouldBeHidden or not icon:ShouldBeHidden()) then
                    local objective = data.ObjectiveData or {}
                    if not objective.Completed then
                        local x, y = math.floor(icon.x / 100 * 65535 + .5), math.floor(icon.y / 100 * 65535 + .5)
                        local index = Count(data.ObjectiveIndex)
                        local key = questID .. ":" .. kind .. ":" .. index .. ":" .. x .. ":" .. y
                        if not seen[key] then
                            seen[key] = true
                            local title = data.QuestData and data.QuestData.name
                            if type(title) ~= "string" or title == "" then title = "Quest #" .. questID end
                            title = title:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("[%c]", " ")
                            -- Trim at a UTF-8 boundary; title fragments are reassembled in the browser.
                            if #title > 80 then
                                local cut = 81
                                while cut > 1 and title:byte(cut) >= 128 and title:byte(cut) < 192 do cut = cut - 1 end
                                title = title:sub(1, cut - 1)
                            end
                            candidates[#candidates + 1] = { questID = questID, kind = kind, objective = index,
                                x = x, y = y, title = title, collected = Count(objective.Collected), needed = Count(objective.Needed),
                                distance = (icon.x / 100 - (px or .5)) ^ 2 + (icon.y / 100 - (py or .5)) ^ 2 }
                        end
                    end
                end
            end
        end
    end
    -- Active objectives/turn-ins first; choose nearby samples before applying a
    -- stable wire order so small player movements do not restart every sync.
    table.sort(candidates, function(a, b)
        if (a.kind == 1) ~= (b.kind == 1) then return a.kind ~= 1 end
        if a.distance ~= b.distance then return a.distance < b.distance end
        if a.questID ~= b.questID then return a.questID < b.questID end
        if a.objective ~= b.objective then return a.objective < b.objective end
        if a.x ~= b.x then return a.x < b.x end
        return a.y < b.y
    end)
    local counts = {}
    for _, marker in ipairs(candidates) do
        local key = marker.questID .. ":" .. marker.kind .. ":" .. marker.objective
        counts[key] = (counts[key] or 0) + 1
        if counts[key] <= MAX_PER_OBJECTIVE and #result.markers < MAX_MARKERS then
            result.markers[#result.markers + 1] = marker
        else result.limited = true end
    end
    table.sort(result.markers, function(a, b)
        if a.questID ~= b.questID then return a.questID < b.questID end
        if a.kind ~= b.kind then return a.kind < b.kind end
        if a.objective ~= b.objective then return a.objective < b.objective end
        if a.x ~= b.x then return a.x < b.x end
        return a.y < b.y
    end)
    result.status = 1
    return result
end

local function Signature(value)
    local parts = { value.mapID, value.status, value.limited and 1 or 0 }
    for _, m in ipairs(value.markers) do
        parts[#parts + 1] = table.concat({m.questID, m.kind, m.objective, m.x, m.y, m.collected, m.needed, m.title}, ":")
    end
    return table.concat(parts, "|")
end

local function Refresh(mapID, x, y)
    -- Questie internals are optional. An incompatible version must never stop
    -- the position strip or modify Questie's frames, settings, or database.
    local ok, value = pcall(Collect, mapID, x, y)
    if not ok then value = { mapID = mapID or 0, status = 2, markers = {}, limited = false } end
    value.signature = Signature(value)
    if snapshot and snapshot.signature == value.signature then return end
    generation = (generation + 1) % 65536
    snapshot, queue, cursor, sent = value, {}, 1, 0
    local titles = {}
    for index, m in ipairs(value.markers) do
        local function u16(n) return math.floor(n / 256), n % 256 end
        local xhi, xlo = u16(m.x)
        local yhi, ylo = u16(m.y)
        queue[#queue + 1] = { 1, index, { math.floor(m.questID / 65536), math.floor(m.questID / 256) % 256,
            m.questID % 256, xhi, xlo, yhi, ylo, m.kind, m.objective, m.collected, m.needed } }
        if not titles[m.questID] then
            titles[m.questID] = true
            for offset = 0, math.max(0, math.ceil(#m.title / 10) - 1) do
                local final = (offset + 1) * 10 >= #m.title
                local payload = { offset + (final and 128 or 0) }
                for i = 1, 10 do payload[#payload + 1] = m.title:byte(offset * 10 + i) or 0 end
                queue[#queue + 1] = { 2, index, payload }
            end
        end
    end
end

function ns.QuestiePacket(mapID, x, y, sequence, now)
    -- Refresh only at a complete cycle boundary so updates cannot starve later
    -- markers. A zone change interrupts immediately. Repeat metadata for loss.
    if not snapshot or snapshot.mapID ~= (mapID or 0) or (cursor == 1 and now >= nextRefresh) then
        Refresh(mapID, x, y)
        nextRefresh = now + 3
    end
    if sent % 7 == 0 or #queue == 0 then
        sent = sent + 1
        return ns.EncodeQuest(0, sequence, snapshot.mapID, generation, #snapshot.markers,
            { snapshot.status, snapshot.limited and 1 or 0 })
    end
    local item = queue[cursor]
    cursor = cursor % #queue + 1
    sent = sent + 1
    return ns.EncodeQuest(item[1], sequence, snapshot.mapID, generation, item[2], item[3])
end
