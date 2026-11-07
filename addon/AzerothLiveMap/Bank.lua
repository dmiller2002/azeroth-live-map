local _, ns = ...
-- Bank records have their own stream, so a large bank cannot delay bag changes.
-- Only read native tabs while the bank is open. Never select tabs or move items.
local records, order, known, urgent, queued = {}, {}, {}, {}, {}
local revision, cursor, active, sent, nextRefresh = 0, 1, nil, 0, 0
local opened, loadedKey = false, nil
local banks = {{epoch=0, topology={}}, {epoch=0, topology={}}}
local function Finite(n)
    return ns.IsReadable(n) and type(n) == "number" and n == n and n > -math.huge and n < math.huge
end
local function Number(n, max) return Finite(n) and math.floor(math.max(0, math.min(max or 65535, n))) or 0 end
local function Text(value)
    if not ns.IsReadable(value) or type(value) ~= "string" then return "" end
    value = value:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("[%c]", " ")
    if #value > 100 then
        local cut = 101
        while cut > 1 and value:byte(cut) >= 128 and value:byte(cut) < 192 do cut = cut - 1 end
        value = value:sub(1, cut - 1)
    end
    return value
end
local function Put(bytes, value, size)
    value = Number(value, 256 ^ size - 1)
    for i = size - 1, 0, -1 do bytes[#bytes + 1] = math.floor(value / 256 ^ i) % 256 end
end
local function Record(index, kind, payload, text)
    text = Text(text)
    local signature = table.concat(payload, ",") .. "|" .. text
    if records[index] and records[index].signature == signature then return end
    revision = (revision + 1) % 65536
    local packets = {{kind=kind,payload=payload}}
    for offset = 0, math.ceil(#text / 10) - 1 do
        local fragment = {offset + ((offset + 1) * 10 >= #text and 128 or 0)}
        for i = 1, 10 do fragment[#fragment + 1] = text:byte(offset * 10 + i) or 0 end
        packets[#packets + 1] = {kind=2,payload=fragment}
    end
    records[index] = {signature=signature,generation=revision,packets=packets,cursor=1}
    if not known[index] then known[index]=true;order[#order+1]=index end
    if not queued[index] then urgent[#urgent+1]=index;queued[index]=true end
end
local function ReadNumber(value, max)
    if not Finite(value) or value < 0 or value > max or value ~= math.floor(value) then error("Unavailable bank data") end
    return value
end
local function Validate(snapshot)
    if type(snapshot) ~= "table" or type(snapshot.tabs) ~= "table" or #snapshot.tabs > 16 then return end
    ReadNumber(snapshot.updatedAt, 4294967295)
    for _, tab in ipairs(snapshot.tabs) do
        if type(tab) ~= "table" or type(tab.slots) ~= "table" or tab.id == 0 then return end
        ReadNumber(tab.id, 65535);ReadNumber(tab.count, 256)
        for slot = 1, tab.count do
            local item=tab.slots[slot]
            if type(item) ~= "table" then return end
            ReadNumber(item.id,16777215);ReadNumber(item.count,65535)
            ReadNumber(item.quality,255);ReadNumber(item.level,65535)
            if (item.quality>7 and item.quality~=255) or (item.id>0 and item.count==0) or (item.id==0 and item.count~=0) then return end
        end
    end
    return snapshot
end
local function LoadCache()
    if loadedKey or type(AzerothLiveMapDB) ~= "table" then return end
    local name, realm
    if UnitName then name,realm=UnitName("player") end
    if not ns.IsReadable(name) or type(name) ~= "string" or name == "" then return end
    realm = Text(realm);if realm == "" and GetRealmName then realm=Text(GetRealmName()) end
    if realm == "" then return end
    loadedKey = name .. "-" .. realm
    local cache = AzerothLiveMapDB.bankCache
    cache = type(cache) == "table" and cache[loadedKey]
    for group, bank in ipairs(banks) do
        local ok, snapshot=pcall(Validate,type(cache)=="table" and cache[group])
        if ok then bank.snapshot=snapshot end
    end
end
local function Save(group, snapshot)
    if not loadedKey then return end
    local db=AzerothLiveMapDB
    if type(db.bankCache) ~= "table" then db.bankCache={} end
    if type(db.bankCache[loadedKey]) ~= "table" then db.bankCache[loadedKey]={} end
    db.bankCache[loadedKey][group]=snapshot
end
local function Collect(bankType)
    local snapshot={tabs={},updatedAt=Number(GetServerTime and GetServerTime(),4294967295),limited=false}
    local tabs=C_Bank.FetchPurchasedBankTabData(bankType)
    if not ns.IsReadable(tabs) or type(tabs) ~= "table" then error("Bank tabs not ready") end
    local itemInfo=C_Item and C_Item.GetItemInfo or GetItemInfo
    for index, info in ipairs(tabs) do
        if index > 16 then snapshot.limited=true;break end
        if not ns.IsReadable(info) or type(info) ~= "table" then error("Bank tab not readable") end
        local id=ReadNumber(info.ID,65535);if id==0 then error("Invalid bank tab") end
        local count=ReadNumber(C_Container.GetContainerNumSlots(id),65535)
        if count>256 then count=256;snapshot.limited=true end
        local tab={id=id,count=count,name=Text(info.name),slots={}}
        for slot=1,count do
            local data=C_Container.GetContainerItemInfo(id,slot)
            if not ns.IsReadable(data) or (data~=nil and type(data)~="table") then error("Bank item unavailable") end
            if data then
                for _,key in ipairs({"itemID","stackCount","quality","itemName"}) do
                    if not ns.IsReadable(data[key]) then error("Restricted bank item") end
                end
            end
            local itemID=data and data.itemID
            if itemID==nil and C_Container.GetContainerItemID then itemID=C_Container.GetContainerItemID(id,slot) end
            if not ns.IsReadable(itemID) then error("Restricted bank item ID") end
            itemID=ReadNumber(itemID or 0,16777215)
            local quantity=itemID>0 and ReadNumber(data and data.stackCount or 1,65535) or 0
            if itemID>0 and quantity==0 then error("Bank count unavailable") end
            local name,quality,level=data and data.itemName,data and data.quality,nil
            if itemID>0 and itemInfo then
                local cached={itemInfo(itemID)}
                name=name or cached[1];quality=quality or cached[3];level=cached[4]
            end
            tab.slots[slot]={id=itemID,count=quantity,name=Text(name),quality=Finite(quality) and Number(quality,7) or 255,level=Number(level)}
        end
        snapshot.tabs[#snapshot.tabs+1]=tab
    end
    return snapshot
end
local function Publish(group, bank)
    local snapshot=bank.snapshot
    local tabs=snapshot and snapshot.tabs or {}
    local topology={}
    for _,tab in ipairs(tabs) do topology[#topology+1]=tab.id .. ":" .. tab.count end
    local signature=table.concat(topology,",")
    if bank.signature~=signature then bank.epoch=(bank.epoch+1)%65536;bank.signature=signature end
    local summary={bank.status,#tabs};Put(summary,bank.epoch,2);Put(summary,snapshot and snapshot.updatedAt or 0,4)
    summary[9]=snapshot and snapshot.limited and 1 or 0
    Record(60031+group,0,summary)
    for position=1,16 do
        local bag=(group-1)*16+position-1
        local tab=tabs[position]
        if tab then
            local old=bank.topology[position]
            local epoch=old and old.epoch or 0
            if not old or old.id~=tab.id or old.count~=tab.count or old.groupEpoch~=bank.epoch then epoch=(epoch+1)%65536 end
            bank.topology[position]={id=tab.id,count=tab.count,epoch=epoch,groupEpoch=bank.epoch}
            local payload={};Put(payload,tab.count,2);Put(payload,tab.id,2);Put(payload,epoch,2);Put(payload,bank.epoch,2)
            Record(60000+bag,0,payload,tab.name)
            for slot=1,256 do
                local index,item=bag*256+slot,tab.slots[slot]
                if item then
                    payload={};Put(payload,item.id,3);Put(payload,item.count,2)
                    payload[6]=Number(item.quality,255);Put(payload,item.level,2);Put(payload,epoch,2)
                    Record(index,1,payload,item.id>0 and item.name or nil)
                else records[index]=nil end
            end
        else
            records[60000+bag]=nil
            for slot=1,256 do records[bag*256+slot]=nil end
        end
    end
end
local function Refresh()
    LoadCache()
    local types=Enum and Enum.BankType or {}
    for group, key in ipairs({"Character","Account"}) do
        local bank=banks[group]
        bank.status=bank.snapshot and 2 or 0
        if not C_Bank or not C_Bank.FetchPurchasedBankTabData or not C_Bank.CanViewBank or types[key]==nil
            or not C_Container or not C_Container.GetContainerNumSlots or not C_Container.GetContainerItemInfo then bank.status=4
        elseif opened then
            local ok, viewable=pcall(C_Bank.CanViewBank,types[key])
            if ok and ns.IsReadable(viewable) and viewable==true and C_Bank.CanUseBank then
                ok,viewable=pcall(C_Bank.CanUseBank,types[key])
            end
            if ok and ns.IsReadable(viewable) and viewable==true then
                local success,snapshot=pcall(Collect,types[key])
                if success then bank.snapshot=snapshot;bank.status=1;Save(group,snapshot)
                else bank.status=3 end
            elseif not ok or not ns.IsReadable(viewable) then bank.status=3 end
        end
        Publish(group,bank)
    end
end
function ns.BankEvent(event)
    if event=="BANKFRAME_OPENED" then opened=true
    elseif event=="BANKFRAME_CLOSED" or event=="PLAYER_ENTERING_WORLD" then opened=false end
    nextRefresh=0
end
function ns.BankPacket(sequence,now)
    if now>=nextRefresh then Refresh();nextRefresh=now+1 end
    sent=sent+1
    local index
    -- Repeat availability often even while thousands of slots are transmitting.
    if sent%8==1 then index=60032+(math.floor(sent/8)%2) end
    while not index and #urgent>0 do
        local candidate=table.remove(urgent,1);queued[candidate]=nil
        if records[candidate] then index=candidate end
    end
    if index then
        local record=records[index];local packet=record.packets[1]
        return ns.EncodeQuest(packet.kind,sequence,ns.QuestSession or 0,record.generation,index,packet.payload,13)
    end
    if not active or not records[active] then
        active=nil
        for _=1,#order do local candidate=order[cursor];cursor=cursor%#order+1;if records[candidate] then active=candidate;break end end
    end
    if not active then return end
    local record=records[active];index=active
    local packet=record.packets[record.cursor];record.cursor=record.cursor+1
    if record.cursor>#record.packets then record.cursor=1;active=nil end
    return ns.EncodeQuest(packet.kind,sequence,ns.QuestSession or 0,record.generation,index,packet.payload,13)
end
