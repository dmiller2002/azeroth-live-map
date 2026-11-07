local _, ns = ...
ns.QuestSession = math.floor(((GetServerTime and GetServerTime() or 0) + (GetTime and GetTime() * 1000 or 0)) % 65536)

local function Finite(n)
    return ns.IsReadable(n) and type(n) == "number" and n == n and n > -math.huge and n < math.huge
end
local function Count(n) return math.floor(math.max(0, math.min(255, Finite(n) and n or 0))) end
local function U16(n) return math.floor(n / 256), n % 256 end


function ns.CreateQuestStream(collect, version)
    local zones, order, zoneCursor = {}, {}, 1
    local titles, titleQueue, titleCursor, titleUpdates = {}, {}, 1, {}
    local generation, sent, nextRefresh, status, total, limited = 0, 0, 0, 0, 0, false
    local function Refresh(mapID)
        -- Providers only read game/addon data. API failures are isolated from
        -- position tracking and reported through this source's global status.
        local ok, collected, newStatus = pcall(collect, mapID)
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

    local function Packet(mapID, x, y, sequence, now)
        if now >= nextRefresh or #order == 0 then Refresh(mapID); nextRefresh = now + 2 end
        sent = sent + 1
        -- Global heartbeats keep all zones fresh. Pins and text have independent
        -- queues so long titles cannot hold up the locations of every quest.
        if sent % 32 == 1 or #order == 0 then
            local count = 0
            for _, id in ipairs(order) do if zones[id].count > 0 then count = count + 1 end end
            return ns.EncodeQuest(3, sequence, 0, ns.QuestSession, count,
                {status, limited and 1 or 0, math.floor(total / 16777216) % 256, math.floor(total / 65536) % 256,
                    math.floor(total / 256) % 256, total % 256}, version)
        end
        if sent % 4 == 0 and #titleQueue > 0 then
            local item = table.remove(titleUpdates,1)
            if not item then item = titleQueue[titleCursor]; titleCursor = titleCursor % #titleQueue + 1 end
            return ns.EncodeQuest(2, sequence, math.floor(item.id / 65536), 0, item.id % 65536, item.payload, version)
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
            return ns.EncodeQuest(0, sequence, id, zone.generation, zone.count, {zone.status, zone.limited and 1 or 0}, version)
        end
        local index = table.remove(zone.updates,1)
        if index then zone.queued[index] = nil
        else index = zone.cursor; zone.cursor = zone.cursor % #zone.markers + 1; zone.remaining = zone.remaining - 1 end
        local m = zone.markers[index]; zone.sent = zone.sent + 1
        if m.removed then return ns.EncodeQuest(4, sequence, id, m.generation, index, {}, version) end
        local xhi, xlo = U16(m.x); local yhi, ylo = U16(m.y)
        return ns.EncodeQuest(1, sequence, id, m.generation, index,
            {math.floor(m.questID / 65536), math.floor(m.questID / 256) % 256, m.questID % 256,
                xhi, xlo, yhi, ylo, m.kind + m.iconType * 4, m.objective, m.collected, m.needed}, version)
    end

    return Packet
end
