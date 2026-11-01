local _, ns = ...
ns.QuestSession = math.floor(((GetServerTime and GetServerTime() or 0) + (GetTime and GetTime() * 1000 or 0)) % 65536)
local zones, order, zoneCursor = {}, {}, 1
local titles, titleQueue, titleCursor = {}, {}, 1
local generation, sent, nextRefresh, status, total, limited = 0, 0, 0, 0, 0, false
local kinds = { available = 1, monster = 2, object = 2, item = 2, event = 2, complete = 3 }

local function Finite(n)
    return type(n) == "number" and n == n and n > -math.huge and n < math.huge
end
local function Count(n) return math.floor(math.max(0, math.min(255, Finite(n) and n or 0))) end
local function U16(n) return math.floor(n / 256), n % 256 end

local function Collect()
    if not QuestieLoader or type(QuestieLoader.ImportModule) ~= "function" then return {}, 0 end
    local map = QuestieLoader:ImportModule("QuestieMap")
    if type(map) ~= "table" or type(map.questIdFrames) ~= "table" then return {}, 2 end
    local result, seen = {}, {}
    for questID, names in pairs(map.questIdFrames) do
        if Finite(questID) and questID > 0 and questID < 16777216 and type(names) == "table" then
            for _, name in pairs(names) do
                local icon = type(name) == "string" and _G[name] or nil
                local data = icon and icon.data
                local kind, mapID = data and kinds[data.Type], icon and icon.UiMapID
                -- Read every Questie-generated world pin, regardless of the
                -- player's zone or whether the in-game map is open.
                if kind and icon.miniMapIcon == false and Finite(mapID) and mapID > 0 and mapID <= 65535
                    and Finite(icon.x) and Finite(icon.y) and icon.x >= 0 and icon.x <= 100 and icon.y >= 0 and icon.y <= 100
                    and (not icon.ShouldBeHidden or not icon:ShouldBeHidden()) then
                    local objective = data.ObjectiveData or {}
                    if not objective.Completed then
                        local x, y = math.floor(icon.x / 100 * 65535 + .5), math.floor(icon.y / 100 * 65535 + .5)
                        local index = Count(data.ObjectiveIndex)
                        local key = table.concat({mapID, questID, kind, index, x, y}, ":")
                        if not seen[key] then
                            seen[key] = true
                            local title = data.QuestData and data.QuestData.name
                            if type(title) ~= "string" or title == "" then title = "Quest #" .. questID end
                            title = title:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("[%c]", " ")
                            if #title > 80 then
                                local cut = 81
                                while cut > 1 and title:byte(cut) >= 128 and title:byte(cut) < 192 do cut = cut - 1 end
                                title = title:sub(1, cut - 1)
                            end
                            result[mapID] = result[mapID] or {}
                            local markers = result[mapID]
                            markers[#markers + 1] = { questID = questID, kind = kind, objective = index,
                                x = x, y = y, title = title, collected = Count(objective.Collected), needed = Count(objective.Needed), key = key }
                        end
                    end
                end
            end
        end
    end
    return result, 1
end

local function Refresh(mapID)
    -- Never modify Questie's frames, settings, or database. API failures are
    -- isolated from position tracking and reported through the global status.
    local ok, collected, newStatus = pcall(Collect)
    if not ok then collected, newStatus = {}, 2 end
    status, total, limited = newStatus, 0, false
    if mapID and mapID > 0 then collected[mapID] = collected[mapID] or {} end
    -- Empty snapshots are tombstones for removed quests in cached remote zones.
    for id in pairs(zones) do collected[id] = collected[id] or {} end
    local newTitles, newOrder = {}, {}
    for id, markers in pairs(collected) do
        table.sort(markers, function(a,b)
            if (a.kind == 1) ~= (b.kind == 1) then return a.kind ~= 1 end
            return a.key < b.key
        end)
        local wasLimited = #markers > 65535
        while #markers > 65535 do markers[#markers] = nil end
        limited = limited or wasLimited
        total = total + #markers
        local keys = {}
        for i, marker in ipairs(markers) do keys[i] = marker.key; newTitles[marker.questID] = marker.title end
        local signature = table.concat(keys, "|")
        local previous = zones[id]
        -- Progress updates preserve the cursor: late pins cannot be starved by
        -- counts changing while the first snapshot is still being transmitted.
        if not previous or previous.signature ~= signature or previous.status ~= status then
            generation = (generation + 1) % 65536
            previous = { generation = generation, cursor = 1, sent = 0, signature = signature, remaining = math.max(1,#markers), updates = {}, queued = {} }
        else
            for i, marker in ipairs(markers) do
                local old = previous.markers[i]
                if (old.collected ~= marker.collected or old.needed ~= marker.needed) and not previous.queued[i] then
                    previous.updates[#previous.updates + 1] = i; previous.queued[i] = true
                end
            end
        end
        previous.markers, previous.status, previous.limited = markers, status, wasLimited
        zones[id] = previous; newOrder[#newOrder + 1] = id
    end
    table.sort(newOrder)
    order = newOrder
    zoneCursor = math.min(zoneCursor, math.max(1, #order))
    local titleKeys, changed = {}, false
    for id, title in pairs(newTitles) do titleKeys[#titleKeys + 1] = id; if titles[id] ~= title then changed = true end end
    for id in pairs(titles) do if not newTitles[id] then changed = true end end
    if changed then
        local nextTitle = titleQueue[titleCursor]
        titles, titleQueue, titleCursor = newTitles, {}, 1
        table.sort(titleKeys)
        for _, id in ipairs(titleKeys) do
            local title = titles[id]
            for offset = 0, math.max(0, math.ceil(#title / 10) - 1) do
                local payload = { offset + ((offset + 1) * 10 >= #title and 128 or 0) }
                for i = 1, 10 do payload[#payload + 1] = title:byte(offset * 10 + i) or 0 end
                titleQueue[#titleQueue + 1] = { id = id, payload = payload }
                if nextTitle and id == nextTitle.id and payload[1] == nextTitle.payload[1] then titleCursor = #titleQueue end
            end
        end
    end
end

function ns.QuestiePacket(mapID, x, y, sequence, now)
    if now >= nextRefresh or #order == 0 then Refresh(mapID); nextRefresh = now + 2 end
    sent = sent + 1
    -- Global heartbeats keep all zones fresh. Pins and text have independent
    -- queues so long titles cannot hold up the locations of every quest.
    if sent % 32 == 1 or #order == 0 then
        local count = 0
        for _, id in ipairs(order) do if #zones[id].markers > 0 then count = count + 1 end end
        return ns.EncodeQuest(3, sequence, 0, ns.QuestSession, count,
            {status, limited and 1 or 0, math.floor(total / 16777216) % 256, math.floor(total / 65536) % 256,
                math.floor(total / 256) % 256, total % 256}, 3)
    end
    if sent % 4 == 0 and #titleQueue > 0 then
        local item = titleQueue[titleCursor]; titleCursor = titleCursor % #titleQueue + 1
        return ns.EncodeQuest(2, sequence, math.floor(item.id / 65536), 0, item.id % 65536, item.payload, 3)
    end
    local active = false
    for _, id in ipairs(order) do if zones[id].remaining > 0 or #zones[id].updates > 0 then active = true; break end end
    if not active then
        for _, id in ipairs(order) do
            local zone = zones[id]
            zone.remaining = math.max(1,#zone.markers)
            -- Rotate repeats so periodic dropped capture frames do not always
            -- erase the same pin at the same point in every transmission pass.
            if #zone.markers > 0 then zone.cursor = zone.cursor % #zone.markers + 1 end
        end
    end
    -- Finished small zones sit out the rest of this pass. A large zone gets
    -- the remaining bandwidth instead of waiting behind endless small repeats.
    while zones[order[zoneCursor]].remaining == 0 and #zones[order[zoneCursor]].updates == 0 do zoneCursor = zoneCursor % #order + 1 end
    local id = order[zoneCursor]; zoneCursor = zoneCursor % #order + 1
    local zone = zones[id]
    if zone.sent % 8 == 0 or #zone.markers == 0 then
        zone.sent = zone.sent + 1
        if #zone.markers == 0 then zone.remaining = 0 end
        return ns.EncodeQuest(0, sequence, id, zone.generation, #zone.markers, {zone.status, zone.limited and 1 or 0}, 3)
    end
    local index = table.remove(zone.updates,1)
    if index then zone.queued[index] = nil
    else index = zone.cursor; zone.cursor = zone.cursor % #zone.markers + 1; zone.remaining = zone.remaining - 1 end
    local m = zone.markers[index]; zone.sent = zone.sent + 1
    local xhi, xlo = U16(m.x); local yhi, ylo = U16(m.y)
    return ns.EncodeQuest(1, sequence, id, zone.generation, index,
        {math.floor(m.questID / 65536), math.floor(m.questID / 256) % 256, m.questID % 256,
            xhi, xlo, yhi, ylo, m.kind, m.objective, m.collected, m.needed}, 3)
end
