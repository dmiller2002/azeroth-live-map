local _, ns = ...
ns.QuestSession = math.floor(((GetServerTime and GetServerTime() or 0) + (GetTime and GetTime() * 1000 or 0)) % 65536)
local zones, order, zoneCursor = {}, {}, 1
local titles, titleQueue, titleCursor, titleUpdates = {}, {}, 1, {}
local generation, sent, nextRefresh, status, total, limited = 0, 0, 0, 0, 0, false
local kinds = { available = 1, monster = 2, object = 2, item = 2, event = 2, complete = 3 }

local function Finite(n)
    return ns.IsReadable(n) and type(n) == "number" and n == n and n > -math.huge and n < math.huge
end
local function Count(n) return math.floor(math.max(0, math.min(255, Finite(n) and n or 0))) end
local function U16(n) return math.floor(n / 256), n % 256 end

local defaultIcons = { available = 6, monster = 1, object = 4, item = 2, event = 3, complete = 8 }

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
                        -- v8/v10 pack the icon ID beside the broad kind in one byte.
                        -- Unknown/custom texture paths retain the matching type default.
                        local iconType = Finite(data.Icon) and math.floor(data.Icon) or defaultIcons[data.Type] or 0
                        if iconType < 0 or iconType > 63 then iconType = defaultIcons[data.Type] or 0 end
                        local key = table.concat({mapID, questID, kind, iconType, index, x, y}, ":")
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
                            markers[#markers + 1] = { questID = questID, kind = kind, iconType = iconType, objective = index,
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
        local previous = zones[id]
        if not previous then previous = { generation = 0, cursor = 1, sent = 0, remaining = 0, updates = {}, queued = {}, markers = {} } end
        local indices, incoming, free = {}, {}, {}
        for index,marker in ipairs(previous.markers)do if not marker.removed then indices[marker.key] = index end end
        for _,marker in ipairs(markers)do incoming[marker.key] = true;newTitles[marker.questID] = marker.title end
        local function Queue(index)
            if not previous.queued[index] then previous.updates[#previous.updates+1] = index;previous.queued[index] = true end
        end
        -- Slots and revisions belong to individual pins, never to the whole zone.
        for index,old in ipairs(previous.markers)do
            if old.removed or not incoming[old.key] then
                free[#free+1] = index
                if not old.removed then
                    previous.markers[index] = {removed=true,generation=(old.generation+1)%65536}
                    Queue(index)
                end
            end
        end
        local freeCursor=1
        for _,marker in ipairs(markers)do
            local index=indices[marker.key]
            if not index then
                index=free[freeCursor] or (#previous.markers+1);freeCursor=freeCursor+1
            end
            local old=previous.markers[index]
            local changed=not old or old.key~=marker.key or old.collected~=marker.collected or old.needed~=marker.needed
            marker.generation=changed and ((old and old.generation or 0)+1)%65536 or old.generation
            previous.markers[index]=marker
            if changed then Queue(index) end
        end
        if previous.count~=#markers or previous.status~=status or previous.limited~=wasLimited then
            generation=(generation+1)%65536;previous.generation=generation;previous.sent=0
        end
        previous.remaining=math.max(previous.remaining,#previous.markers- (previous.highWater or 0))
        previous.highWater=#previous.markers
        previous.count, previous.status, previous.limited = #markers, status, wasLimited
        zones[id] = previous; newOrder[#newOrder + 1] = id
    end
    table.sort(newOrder)
    order = newOrder
    zoneCursor = math.min(zoneCursor, math.max(1, #order))
    local titleKeys, changed = {}, false
    for id, title in pairs(newTitles) do
        titleKeys[#titleKeys + 1] = id
        if titles[id] ~= title then
            changed = true
            for offset = 0, math.max(0, math.ceil(#title / 10) - 1) do
                local payload = { offset + ((offset + 1) * 10 >= #title and 128 or 0) }
                for i = 1, 10 do payload[#payload + 1] = title:byte(offset * 10 + i) or 0 end
                titleUpdates[#titleUpdates+1] = {id=id,payload=payload}
            end
        end
    end
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
        for _, id in ipairs(order) do if zones[id].count > 0 then count = count + 1 end end
        return ns.EncodeQuest(3, sequence, 0, ns.QuestSession, count,
            {status, limited and 1 or 0, math.floor(total / 16777216) % 256, math.floor(total / 65536) % 256,
                math.floor(total / 256) % 256, total % 256}, 10)
    end
    if sent % 4 == 0 and #titleQueue > 0 then
        local item = table.remove(titleUpdates,1)
        if not item then item = titleQueue[titleCursor]; titleCursor = titleCursor % #titleQueue + 1 end
        return ns.EncodeQuest(2, sequence, math.floor(item.id / 65536), 0, item.id % 65536, item.payload, 10)
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
    for _,candidate in ipairs(order)do if #zones[candidate].updates>0 then id=candidate;break end end
    local zone = zones[id]
    if zone.sent % 8 == 0 or #zone.markers == 0 then
        zone.sent = zone.sent + 1
        if #zone.markers == 0 then zone.remaining = 0 end
        return ns.EncodeQuest(0, sequence, id, zone.generation, zone.count, {zone.status, zone.limited and 1 or 0}, 10)
    end
    local index = table.remove(zone.updates,1)
    if index then zone.queued[index] = nil
    else index = zone.cursor; zone.cursor = zone.cursor % #zone.markers + 1; zone.remaining = zone.remaining - 1 end
    local m = zone.markers[index]; zone.sent = zone.sent + 1
    if m.removed then return ns.EncodeQuest(4, sequence, id, m.generation, index, {}, 10) end
    local xhi, xlo = U16(m.x); local yhi, ylo = U16(m.y)
    return ns.EncodeQuest(1, sequence, id, m.generation, index,
        {math.floor(m.questID / 65536), math.floor(m.questID / 256) % 256, m.questID % 256,
            xhi, xlo, yhi, ylo, m.kind + m.iconType * 4, m.objective, m.collected, m.needed}, 10)
end
