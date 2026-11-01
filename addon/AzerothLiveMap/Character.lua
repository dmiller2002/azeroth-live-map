local _, ns = ...
local records, order, urgent, queued = {}, {}, {}, {}
local revision, cursor, active, nextRefresh = 0, 1, nil, 0

local function Number(value, maximum)
    if type(value) ~= "number" or value ~= value or value == math.huge or value == -math.huge then return 0 end
    return math.floor(math.max(0, math.min(maximum or 65535, value)))
end
local function Put(bytes, value, size)
    value = Number(value, 256 ^ size - 1)
    for i = size - 1, 0, -1 do bytes[#bytes + 1] = math.floor(value / 256 ^ i) % 256 end
end
local function Text(value, limit)
    value = type(value) == "string" and value or ""
    value = value:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("[%c]", " ")
    if #value > limit then
        local cut = limit + 1
        while cut > 1 and value:byte(cut) >= 128 and value:byte(cut) < 192 do cut = cut - 1 end
        value = value:sub(1, cut - 1)
    end
    return value
end
local function Record(key, kind, index, payload, text)
    local signature = table.concat(payload, ",") .. "|" .. (text or "")
    local old = records[key]
    if old and old.signature == signature then return end
    revision = (revision + 1) % 65536
    local packets = {{kind = kind, index = index, payload = payload}}
    if text and text ~= "" then
        for offset = 0, math.ceil(#text / 10) - 1 do
            local fragment = {offset + ((offset + 1) * 10 >= #text and 128 or 0)}
            for i = 1, 10 do fragment[#fragment + 1] = text:byte(offset * 10 + i) or 0 end
            packets[#packets + 1] = {kind = 2, index = index, payload = fragment}
        end
    end
    records[key] = {signature = signature, generation = revision, packets = packets, cursor = 1}
    if not old then order[#order + 1] = key end
    if not queued[key] then urgent[#urgent + 1] = key; queued[key] = true end
end

local function Refresh()
    if not UnitName or not UnitClass or not GetInventoryItemID then return false end
    local name, realm = UnitName("player")
    if not name then return false end
    local _, _, classID = UnitClass("player")
    local _, _, raceID = UnitRace("player")
    local payload = {}
    Put(payload, UnitLevel("player"), 2)
    payload[3], payload[4], payload[5] = Number(classID, 255), Number(raceID, 255), Number(UnitSex("player"), 3)
    payload[6] = Number(UnitPowerType("player"), 255)
    Record("identity", 0, 0, payload, Text(name, 48) .. "\n" .. Text(realm or (GetRealmName and GetRealmName()), 96))
    payload = {}
    for stat = 1, 5 do local _, effective = UnitStat("player", stat); Put(payload, effective, 2) end
    Record("primary", 3, 1, payload)
    payload = {}
    local _, armor = UnitArmor("player")
    Put(payload, armor, 3); Put(payload, UnitHealthMax("player"), 3); Put(payload, UnitPowerMax("player"), 3)
    Record("defense", 3, 2, payload)
    local itemInfo = C_Item and C_Item.GetItemInfo or GetItemInfo
    for slot = 1, 19 do
        local itemID = Number(GetInventoryItemID("player", slot), 16777215)
        local itemName, quality, itemLevel
        if itemID > 0 and itemInfo then
            local link = GetInventoryItemLink and GetInventoryItemLink("player", slot)
            local info = {itemInfo(link or itemID)}
            itemName, quality, itemLevel = info[1], info[3], info[4]
        end
        local durability, maximum
        if GetInventoryItemDurability then durability, maximum = GetInventoryItemDurability(slot) end
        payload = {}; Put(payload, itemID, 3)
        payload[4] = quality and Number(quality, 7) or 255
        Put(payload, itemLevel, 2); Put(payload, durability, 2); Put(payload, maximum, 2)
        Record("slot" .. slot, 1, slot, payload, itemID > 0 and Text(itemName, 100) or nil)
    end
    return true
end

-- v4 shares the existing auxiliary lanes. Each equipment slot has its own
-- revision, so a stat change cannot restart or mix another item's name.
function ns.CharacterPacket(sequence, now)
    if now >= nextRefresh then
        local ok = pcall(Refresh)
        nextRefresh = now + (ok and 1 or 3)
    end
    if #order == 0 then return nil end
    if not active then
        active = table.remove(urgent, 1)
        if active then queued[active] = nil
        else active = order[cursor]; cursor = cursor % #order + 1 end
    end
    local record = records[active]
    local packet = record.packets[record.cursor]
    record.cursor = record.cursor + 1
    if record.cursor > #record.packets then record.cursor = 1; active = nil end
    return ns.EncodeQuest(packet.kind, sequence, ns.QuestSession or 0, record.generation, packet.index, packet.payload, 4)
end
