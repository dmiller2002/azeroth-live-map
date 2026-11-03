local _, ns = ...
-- The accepted quest log is independent of Questie's optional map markers.
-- v9 records (v7 layout, stable quest slots and per-quest identity epochs): 0 manifest, 1..64 quests, 129..192 descriptions,
-- 4096..6143 objectives. Text uses a u16 fragment offset + nine UTF-8 bytes.
local records, order, urgent, queued, bodyOrder = {}, {}, {}, {}, {}
local epoch, nextRefresh, status, calls = 0, 0, 2, 0
local slots, identities, generations, pending = {}, {}, {}, {}
local cursor, bodyCursor, active, bodyActive = 1, 1, nil, nil
local descriptions, reading, loading = {}, false, false
local function Num(value,max)
    if not ns.IsReadable(value) or type(value)~="number" or value~=value or value==math.huge or value==-math.huge then return 0 end
    return math.floor(math.max(0,math.min(max or 65535,value)))
end
local function Put(bytes,value,size)
    value=Num(value,256^size-1)
    for i=size-1,0,-1 do bytes[#bytes+1]=math.floor(value/256^i)%256 end
end
local function Text(value,limit)
    value=ns.IsReadable(value) and type(value)=="string" and value or ""
    value=value:gsub("|c%x%x%x%x%x%x%x%x",""):gsub("|r",""):gsub("\r\n","\n"):gsub("\r","\n"):gsub("[%z\1-\8\11-\31\127]","")
    local limited=#value>limit
    if limited then
        local cut=limit+1
        while cut>1 and value:byte(cut)>=128 and value:byte(cut)<192 do cut=cut-1 end
        value=value:sub(1,cut-1)
    end
    return value,limited
end
local function Record(index,kind,payload,text,body)
    local signature=table.concat(payload,",").."|"..(text or "")
    local old=records[index]
    if old and old.signature==signature then return end
    generations[index]=((generations[index] or 0)+1)%65536
    local packets={{kind=kind,payload=payload}}
    for offset=0,math.ceil(#(text or "")/9)-1 do
        local fragment={};Put(fragment,offset+((offset+1)*9>=#text and 32768 or 0),2)
        for i=1,9 do fragment[#fragment+1]=text:byte(offset*9+i)or 0 end
        packets[#packets+1]={kind=2,payload=fragment}
    end
    if not old then
        local list=body and bodyOrder or order;list[#list+1]=index
    end
    records[index]={signature=signature,generation=generations[index],packets=packets,cursor=1}
    if index~=0 then
        pending[index]=1
        if not queued[index]then urgent[#urgent+1]=index;queued[index]=true end
    end
end
local function Title(index)
    local info=C_QuestLog and C_QuestLog.GetInfo and C_QuestLog.GetInfo(index)
    if info then
        local id=info.questID
        local complete,tag=0,nil
        if not info.isHeader and ns.IsReadable(id) and type(id)=="number" and id>0 then
            if C_QuestLog.IsFailed and C_QuestLog.IsFailed(id) then complete=-1
            elseif C_QuestLog.IsComplete and C_QuestLog.IsComplete(id) then complete=1 end
            local data=C_QuestLog.GetQuestTagInfo and C_QuestLog.GetQuestTagInfo(id)
            tag=data and data.tagName
        end
        return info.title,info.level,tag,info.isHeader,info.isCollapsed,complete,info.frequency,id
    end
    if not (C_QuestLog and C_QuestLog.GetInfo) and GetQuestLogTitle then return GetQuestLogTitle(index)end
end
local function ReadText(index,id,now)
    local cached=descriptions[id]
    if cached and cached.available and now-cached.at<30 then return cached end
    local description,overview
    if GetQuestLogQuestText and C_QuestLog and C_QuestLog.GetInfo then
        -- Forever's global reader takes a log index; it does not require
        -- selecting the quest or touching the player's open quest reader.
        description,overview=GetQuestLogQuestText(index)
    elseif GetQuestLogQuestText and SelectQuestLogEntry and GetQuestLogSelection then
        SelectQuestLogEntry(index)
        description,overview=GetQuestLogQuestText()
    elseif C_QuestLog and C_QuestLog.GetQuestLogQuestText then
        description,overview=C_QuestLog.GetQuestLogQuestText(index)
    end
    local body,limited=Text(description,12288)
    local data={description=body,overview=Text(overview,3000),limited=limited,available=type(description)=="string",at=now}
    -- Keep the previous reading during transient client cache misses.
    if not data.available and cached then return cached end
    descriptions[id]=data;return data
end
local function Collect(now)
    if loading then return nil,2 end
    if not GetQuestLogTitle and not(C_QuestLog and C_QuestLog.GetInfo)then return {},0 end
    local snapshot,category={},"Quest log"
    local tracker
    if QuestieLoader and type(QuestieLoader.ImportModule)=="function"then
        local ok,module=pcall(QuestieLoader.ImportModule,QuestieLoader,"QuestieTracker")
        if ok and type(module)=="table"then tracker=module end
    end
    for index=1,512 do
        local title,level,tag,header,_,complete,frequency,id=Title(index)
        if not title then break end
        if header then category=Text(title,160)
        elseif type(id)=="number" and id>0 and id<16777216 then
            local objectives={}
            local raw=C_QuestLog and C_QuestLog.GetQuestObjectives and C_QuestLog.GetQuestObjectives(id)
            if type(raw)=="table"then
                for i=1,math.min(32,#raw)do
                    local obj=raw[i];local text,limited=Text(obj.text,1000)
                    objectives[#objectives+1]={text=text,limited=limited,finished=obj.finished==true,fulfilled=Num(obj.numFulfilled),required=Num(obj.numRequired)}
                end
            elseif GetNumQuestLeaderBoards and GetQuestLogLeaderBoard then
                for i=1,Num(GetNumQuestLeaderBoards(index),32)do
                    local text,_,finished=GetQuestLogLeaderBoard(i,index)
                    local clean,limited=Text(text,1000);local fulfilled,required=clean:match("(%d+)%s*/%s*(%d+)")
                    objectives[#objectives+1]={text=clean,limited=limited,finished=finished==true,fulfilled=Num(tonumber(fulfilled)),required=Num(tonumber(required))}
                end
            end
            local watched
            if tracker and type(tracker.IsTrackedByQuestie)=="function"then
                local ok,value=pcall(tracker.IsTrackedByQuestie,id)
                if ok and type(value)=="boolean"then watched=value end
            end
            if watched==nil and C_QuestLog and C_QuestLog.GetQuestWatchType then watched=C_QuestLog.GetQuestWatchType(id)~=nil end
            if watched==nil then watched=IsQuestWatched and IsQuestWatched(index)end
            snapshot[#snapshot+1]={id=id,title=Text(title,240),category=category,tag=Text(tag,80),level=Num(level,255),complete=complete==1,failed=complete==-1,
                watched=watched==true or watched==1,frequency=Num(frequency,255),objectives=objectives,text=ReadText(index,id,now)}
            if #snapshot>=64 then break end
        end
    end
    return snapshot,1
end
local function Refresh(now)
    if now<nextRefresh or reading then return end
    nextRefresh=now+2;reading=true
    local selection
    if not (C_QuestLog and C_QuestLog.GetInfo) and GetQuestLogSelection then selection=GetQuestLogSelection() end
    local ok,snapshot,newStatus=pcall(Collect,now)
    -- Restore even when the client errors while selecting/reading a quest.
    if selection~=nil and SelectQuestLogEntry then pcall(SelectQuestLogEntry,selection)end
    reading=false
    if not ok then snapshot=nil end
    status=ok and newStatus or 2
    if snapshot then
        local keep={};for _,quest in ipairs(snapshot)do keep[quest.id]=true end
        -- Never renumber existing quests when WoW inserts a quest or reorders headers.
        -- A tombstone removes just one slot; its identity prevents late text from
        -- being attached to a different quest when that slot is reused.
        for id,slot in pairs(slots)do
            if not keep[id]then
                local payload={};Put(payload,0,3);Put(payload,identities[slot],2)
                payload[6],payload[7],payload[8],payload[9]=0,0,0,0
                Record(slot,1,payload)
                slots[id]=nil;descriptions[id]=nil
            end
        end
        local occupied={};for _,slot in pairs(slots)do occupied[slot]=true end
        local live={[0]=true}
        for _,quest in ipairs(snapshot)do
            local slot=slots[quest.id]
            if not slot then
                for index=1,64 do if not occupied[index]then slot=index;break end end
                slots[quest.id]=slot;occupied[slot]=true
                epoch=(epoch+1)%65536;identities[slot]=epoch
            end
            local identity=identities[slot]
            live[slot]=true;live[128+slot]=true
            keep[quest.id]=true
            local payload={};Put(payload,quest.id,3);Put(payload,identity,2)
            payload[6],payload[7],payload[8],payload[9]=quest.level,(quest.watched and 1 or 0)+(quest.complete and 2 or 0)+(quest.failed and 4 or 0),#quest.objectives,quest.frequency
            Record(slot,1,payload,table.concat({quest.title,quest.category,quest.tag,quest.text.overview},string.char(31)))
            payload={};Put(payload,identity,2);Put(payload,#quest.text.description,2)
            payload[5],payload[6]=quest.text.limited and 1 or 0,quest.text.available and 1 or 0
            Record(128+slot,4,payload,quest.text.description,true)
            for i,objective in ipairs(quest.objectives)do
                payload={};Put(payload,identity,2)
                payload[3]=(objective.finished and 1 or 0)+(objective.limited and 2 or 0)
                Put(payload,objective.fulfilled,2);Put(payload,objective.required,2)
                local index=4096+(slot-1)*32+i-1;live[index]=true
                Record(index,3,payload,objective.text)
            end
        end
        -- Retain root tombstones for lossy captures; discard obsolete child records.
        for index in pairs(records)do
            if index>64 and not live[index]then records[index]=nil;pending[index]=nil;queued[index]=nil end
        end
        local function Prune(list)
            local result={};for _,index in ipairs(list)do if records[index]then result[#result+1]=index end end
            return result
        end
        order=Prune(order);bodyOrder=Prune(bodyOrder);urgent=Prune(urgent)
        cursor=math.min(cursor,math.max(1,#order));bodyCursor=math.min(bodyCursor,math.max(1,#bodyOrder))
    end
    local payload={};Put(payload,epoch,2)
    payload[3],payload[4],payload[5]=snapshot and #snapshot or (records[0]and records[0].packets[1].payload[3]or 0),status,Num(UnitLevel and UnitLevel("player"),255)
    Record(0,0,payload)
end
local function NextRecord(body)
    local list=body and bodyOrder or order
    if #list==0 then return nil end
    local index
    if body then index=bodyActive else index=active end
    if not index or not records[index]then
        local position=body and bodyCursor or cursor
        index=list[position]
        if body then bodyCursor=position%#list+1;bodyActive=index else cursor=position%#list+1;active=index end
    end
    local record=records[index];local packet=record.packets[record.cursor]
    record.cursor=record.cursor+1
    if record.cursor>#record.packets then record.cursor=1;if body then bodyActive=nil else active=nil end end
    return index,packet,record.generation
end
function ns.QuestLogPacket(sequence,now)
    Refresh(now)
    if not records[0]then return nil end
    calls=calls+1
    local index,packet,generation
    if calls%16==1 then index=0;packet=records[0].packets[1];generation=records[0].generation
    elseif calls%3~=0 and #urgent>0 then
        index=table.remove(urgent,1)
        local record=records[index];local position=pending[index] or 1
        packet=record.packets[position];generation=record.generation
        if position<#record.packets then pending[index]=position+1;urgent[#urgent+1]=index
        else pending[index]=nil;queued[index]=nil end
    else index,packet,generation=NextRecord(calls%3~=0 and #bodyOrder>0)end
    if not packet then return nil end
    return ns.EncodeQuest(packet.kind,sequence,ns.QuestSession or 0,generation,index,packet.payload,9)
end
function ns.InvalidateQuestLog(event)
    if reading then return end
    if event=="PLAYER_LEAVING_WORLD" or event=="LOADING_SCREEN_ENABLED"then loading=true
    elseif event=="PLAYER_ENTERING_WORLD" or event=="LOADING_SCREEN_DISABLED"then loading=false end
    nextRefresh=0
end
if CreateFrame then
    local events=CreateFrame("Frame")
    for _,event in ipairs({"QUEST_LOG_UPDATE","QUEST_WATCH_UPDATE","QUEST_WATCH_LIST_CHANGED","QUEST_ACCEPTED","QUEST_REMOVED","PLAYER_ENTERING_WORLD","PLAYER_LEAVING_WORLD","LOADING_SCREEN_ENABLED","LOADING_SCREEN_DISABLED"})do events:RegisterEvent(event)end
    events:SetScript("OnEvent",function(_,event)ns.InvalidateQuestLog(event)end)
end
