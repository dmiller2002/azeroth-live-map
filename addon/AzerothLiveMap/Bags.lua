local _, ns = ...
local records, order, known, urgent, queued, topology = {}, {}, {}, {}, {}, {}
local revision, cursor, active, nextRefresh = 0, 1, nil, 0

local function Number(value, maximum)
    if type(value) ~= "number" or value ~= value or value == math.huge or value == -math.huge then return 0 end
    return math.floor(math.max(0, math.min(maximum or 65535, value)))
end
local function Put(bytes, value, size)
    value = Number(value, 256 ^ size - 1)
    for i = size - 1, 0, -1 do bytes[#bytes + 1] = math.floor(value / 256 ^ i) % 256 end
end
local function Text(value)
    value = type(value) == "string" and value or ""
    value = value:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("[%c]", " ")
    if #value > 100 then
        local cut = 101
        while cut > 1 and value:byte(cut) >= 128 and value:byte(cut) < 192 do cut = cut - 1 end
        value = value:sub(1, cut - 1)
    end
    return value
end
local function Record(index, kind, payload, text)
    text = Text(text)
    local signature = table.concat(payload, ",") .. "|" .. text
    if records[index] and records[index].signature == signature then return end
    revision = (revision + 1) % 65536
    local packets = {{kind = kind, payload = payload}}
    for offset = 0, math.ceil(#text / 10) - 1 do
        local fragment = {offset + ((offset + 1) * 10 >= #text and 128 or 0)}
        for i = 1, 10 do fragment[#fragment + 1] = text:byte(offset * 10 + i) or 0 end
        packets[#packets + 1] = {kind = 2, payload = fragment}
    end
    records[index] = {signature = signature, generation = revision, packets = packets, cursor = 1}
    if not known[index] then known[index] = true; order[#order + 1] = index end
    if not queued[index] then urgent[#urgent + 1] = index; queued[index] = true end
end

local function Refresh()
    local api = C_Container or {}
    local size = api.GetContainerNumSlots or GetContainerNumSlots
    local info = api.GetContainerItemInfo or GetContainerItemInfo
    if not size or not info then return end
    local getID = api.GetContainerItemID or GetContainerItemID
    local inventory = api.ContainerIDToInventoryID or ContainerIDToInventoryID
    local bagName = api.GetBagName or GetBagName
    local itemInfo = C_Item and C_Item.GetItemInfo or GetItemInfo
    -- Gather first: an API exception must not emit a half-refreshed inventory.
    local snapshot = {}
    for bag = 0, 4 do
        local count = Number(size(bag), 64)
        local inv = bag > 0 and inventory and inventory(bag)
        local id = inv and GetInventoryItemID and Number(GetInventoryItemID("player", inv), 16777215) or 0
        local name, quality
        if id > 0 and itemInfo then local data = {itemInfo(id)}; name, quality = data[1], data[3] end
        if bagName and (bag == 0 or count > 0) then name = bagName(bag) or name end
        local entry = {count = count, id = id, quality = quality, name = name, slots = {}}
        for slot = 1, count do
            local data
            if api.GetContainerItemInfo then data = api.GetContainerItemInfo(bag, slot)
            else
                local old = {info(bag, slot)}
                if old[1] then data = {stackCount = old[2], quality = old[4], hyperlink = old[7], itemID = old[10], itemName = nil} end
            end
            local itemID = Number(data and data.itemID or (getID and getID(bag, slot)), 16777215)
            if itemID == 0 and data and data.hyperlink then itemID = Number(tonumber(data.hyperlink:match("item:(%d+)")), 16777215) end
            local itemName, itemQuality, itemLevel = data and data.itemName, data and data.quality, nil
            if itemID > 0 and itemInfo then
                local cached = {itemInfo(data and data.hyperlink or itemID)}
                itemName, itemQuality, itemLevel = itemName or cached[1], itemQuality or cached[3], cached[4]
            end
            entry.slots[slot] = {id = itemID, count = itemID > 0 and math.max(1, Number(data and data.stackCount or 1)) or 0,
                name = itemName, quality = itemQuality, level = itemLevel}
        end
        snapshot[bag] = entry
    end
    for bag = 0, 4 do
        local entry, old = snapshot[bag], topology[bag]
        local epoch = old and old.epoch or 0
        if not old or old.id ~= entry.id or old.count ~= entry.count then epoch = (epoch + 1) % 65536 end
        topology[bag] = {id = entry.id, count = entry.count, epoch = epoch}
        local payload = {entry.count}; Put(payload, entry.id, 3)
        payload[5] = entry.quality and Number(entry.quality, 7) or 255
        Put(payload, epoch, 2)
        Record(512 + bag, 0, payload, entry.name)
        for slot = 1, 64 do
            local index = bag * 64 + slot
            local item = entry.slots[slot]
            if item then
                payload = {}; Put(payload, item.id, 3); Put(payload, item.count, 2)
                payload[6] = item.quality and Number(item.quality, 7) or 255
                Put(payload, item.level, 2); Put(payload, epoch, 2)
                Record(index, 1, payload, item.id > 0 and item.name or nil)
            else records[index] = nil end
        end
    end
end

function ns.InvalidateBags() nextRefresh = 0 end

-- v5: descriptor indices 512..516, slot indices bag*64+slot (1..320).
-- Changed slot metadata goes first; names and full repeats follow round-robin.
-- Topology epochs prevent old slots surviving a removed/replaced bag.
function ns.BagPacket(sequence, now)
    if now >= nextRefresh then
        local ok = pcall(Refresh)
        nextRefresh = now + (ok and 1 or 3)
    end
    while #urgent > 0 do
        local index = table.remove(urgent, 1); queued[index] = nil
        local record = records[index]
        if record then
            local packet = record.packets[1]
            return ns.EncodeQuest(packet.kind, sequence, ns.QuestSession or 0, record.generation, index, packet.payload, 5)
        end
    end
    if #order == 0 then return nil end
    if not active or not records[active] then
        active = nil
        for _ = 1, #order do
            local index = order[cursor]; cursor = cursor % #order + 1
            if records[index] then active = index; break end
        end
    end
    if not active then return nil end
    local record, index = records[active], active
    local packet = record.packets[record.cursor]
    record.cursor = record.cursor + 1
    if record.cursor > #record.packets then record.cursor = 1; active = nil end
    return ns.EncodeQuest(packet.kind, sequence, ns.QuestSession or 0, record.generation, index, packet.payload, 5)
end
