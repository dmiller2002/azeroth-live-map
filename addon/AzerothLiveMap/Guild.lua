local _, ns = ...
-- Guild roster + optional member-to-member sharing. No notes or chat are read.
local PREFIX, MAX_MEMBERS, TTL = "DAUI_GUILD1", 1000, 30
local guild, rosterKey, members, byName, shared = nil, nil, {}, {}, {}
local records, order, cursor, active = {}, {}, 1, nil
local urgent, queued = {}, {}
local epoch, revision, calls, nextRefresh, nextRequest, nextSend, nextSkills = 0, 0, 0, 0, 0, 0, 0
local skills, skillsKnown = {}, false
local readingSkills=false
local classes = {WARRIOR=1,PALADIN=2,HUNTER=3,ROGUE=4,PRIEST=5,SHAMAN=7,MAGE=8,WARLOCK=9,DRUID=11}
local professions = {[171]=2259,[164]=2018,[333]=7411,[202]=4036,[182]=2366,[165]=2108,[186]=2575,[393]=8613,[197]=3908,[755]=25229}
local professionNames = {[171]='Alchemy',[164]='Blacksmithing',[333]='Enchanting',[202]='Engineering',[182]='Herbalism',[165]='Leatherworking',[186]='Mining',[393]='Skinning',[197]='Tailoring',[755]='Jewelcrafting'}
local function Num(value, max)
    if not ns.IsReadable(value) then return 0 end
    value = tonumber(value)
    if not value or value ~= value or value == math.huge or value == -math.huge then return 0 end
    return math.floor(math.max(0, math.min(max or 65535, value)))
end
local function Put(bytes, value)
    value = Num(value); bytes[#bytes+1] = math.floor(value/256); bytes[#bytes+1] = value%256
end
local function Text(value, limit)
    value = ns.IsReadable(value) and type(value)=="string" and value or ""
    value = value:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("[%c]", " ")
    if #value > limit then
        local cut=limit+1
        while cut>1 and value:byte(cut)>=128 and value:byte(cut)<192 do cut=cut-1 end
        value=value:sub(1,cut-1)
    end
    return value
end
local function Name(name)
    if not ns.IsReadable(name) or type(name)~="string" or name=="" then return nil end
    if not name:find("-",1,true) then name=name.."-"..(GetRealmName and GetRealmName() or "") end
    return name:gsub("%s",""):lower()
end
local function SelfName()
    local name,realm=UnitName("player")
    if realm==""then realm=nil end
    return Name(name and (name.."-"..(realm or (GetRealmName and GetRealmName()) or "")))
end
local function Record(index,kind,payload,text)
    local signature=table.concat(payload,",").."|"..(text or "")
    local old=records[index]
    if old and old.signature==signature then return end
    revision=(revision+1)%65536
    local packets={{kind=kind,payload=payload}}
    for offset=0,math.ceil(#(text or "")/10)-1 do
        local fragment={offset+((offset+1)*10>=#text and 128 or 0)}
        for i=1,10 do fragment[#fragment+1]=text:byte(offset*10+i) or 0 end
        packets[#packets+1]={kind=2,payload=fragment}
    end
    if not records[index] then order[#order+1]=index end
    records[index]={signature=signature,generation=old and (old.generation+1)%65536 or revision,packets=packets,cursor=1}
    if index~=0 and not queued[index]then urgent[#urgent+1]=index;queued[index]=true end
end
local function Refresh(now)
    if now<nextRefresh then return end
    nextRefresh=now+2
    local current=GetGuildInfo and GetGuildInfo("player")
    if current~=guild then
        guild=current; rosterKey=nil; shared={}; members={}; byName={}; nextRequest=0; nextSend=0
    end
    if current and now>=nextRequest then
        nextRequest=now+30
        local request=C_GuildInfo and C_GuildInfo.GuildRoster or GuildRoster
        if request then pcall(request) end
    end
    local snapshot={}
    if current and GetNumGuildMembers and GetGuildRosterInfo then
        for i=1,Num(GetNumGuildMembers(),MAX_MEMBERS) do
            local name,rank,_,level,_,zone,_,_,online,_,class=GetGuildRosterInfo(i)
            local key=Name(name)
            if key then snapshot[#snapshot+1]={key=key,name=Text(name,96),rank=Text(rank,48),level=Num(level,255),class=classes[class] or 0,zone=Text(zone,64),online=online==true} end
        end
    end
    table.sort(snapshot,function(a,b)return a.key<b.key end)
    local keys={current or ""};for _,member in ipairs(snapshot)do keys[#keys+1]=member.key end
    local key=table.concat(keys,"\n")
    if key~=rosterKey then
        rosterKey=key;epoch=(epoch+1)%65536
        records={};order={};cursor=1;active=nil;urgent={};queued={}
    end
    members=snapshot;byName={}
    for i,member in ipairs(members)do
        byName[member.key]=i
        local payload={};Put(payload,epoch)
        payload[3],payload[4],payload[5]=member.level,member.class,member.online and 1 or 0
        Record(i,1,payload,member.name.."\n"..member.rank.."\n"..member.zone)
        if not member.online then shared[member.key]=nil end
    end
    for name in pairs(shared)do if not byName[name]then shared[name]=nil end end
    local payload={current and (#members>0 and 2 or 1) or 0}
    Put(payload,#members);Put(payload,epoch)
    payload[6]=AzerothLiveMapDB and AzerothLiveMapDB.guildShare==true and 1 or 0
    Record(0,0,payload,Text(current,100))
end
local function ReadSkills()
    local found,names,known={},{},false
    for id,spell in pairs(professions)do
        names[professionNames[id]]=id
        local ok,name=pcall(function()
            if GetSpellInfo then return GetSpellInfo(spell)end
            if C_Spell and C_Spell.GetSpellName then return C_Spell.GetSpellName(spell)end
        end)
        if ok and type(name)=="string"then names[name]=id end
    end
    -- Questie's cache supplies localized skill names (not cached ranks), so
    -- Herbalism's gathering spell name need not match the skill-line name.
    if QuestieLoader and type(QuestieLoader.ImportModule)=="function"then
        pcall(function()
            local module=QuestieLoader:ImportModule('QuestieProfessions')
            if module and type(module.GetPlayerProfessions)=="function"then
                for id,entry in pairs(module:GetPlayerProfessions()or{})do
                    if professions[id] and type(entry)=="table" and type(entry[1])=="string"then names[entry[1]]=id end
                end
            end
        end)
    end
    local function Add(id,name,rank)
        id=tonumber(id)
        if not professions[id]then id=names[name]end
        if id and type(rank)=="number" and rank>=0 then found[id]=Num(rank);return true end
        return false
    end
    local expected
    if GetNumPrimaryProfessions then
        local ok,count=pcall(GetNumPrimaryProfessions)
        if ok and type(count)=="number" and count>=0 and count<=2 then expected=count end
    end
    if GetProfessions and GetProfessionInfo then
        local ok,first,second=pcall(GetProfessions)
        local resolved,hadIndex=true,false
        if ok then for _,index in pairs({first,second})do
            hadIndex=true
            local read,name,_,rank,_,_,_,id=pcall(GetProfessionInfo,index)
            if not read or not Add(id,name,rank)then resolved=false end
        end end
        known=ok and hadIndex and resolved
    end
    local function FoundCount()local n=0;for _ in pairs(found)do n=n+1 end;return n end
    -- Some Classic clients expose empty/stub modern APIs. Scan skill lines
    -- whenever the modern result cannot account for the character's skills.
    if not known or (expected and FoundCount()<expected)then
        local api=C_SkillInfo or {}
        local count,info=api.GetNumSkillLines or GetNumSkillLines,api.GetSkillLineInfo or GetSkillLineInfo
        local expand,collapse=api.ExpandSkillHeader or ExpandSkillHeader,api.CollapseSkillHeader or CollapseSkillHeader
        if count and info then
            local expanded,complete={},true
            readingSkills=true
            local ok=pcall(function()
                local index=1
                while index<=Num(count(),1000)do
                    local name,header,isExpanded,rank=info(index)
                    local id
                    if type(name)=="table"then
                        local entry=name
                        name,header,rank,id=entry.name or entry.skillName,entry.isHeader,entry.rank or entry.skillRank,entry.skillID or entry.skillLineID
                        if entry.isCollapsed~=nil then isExpanded=not entry.isCollapsed else isExpanded=entry.isExpanded end
                    end
                    if header and not isExpanded then
                        if expand and collapse then
                            -- Indices are recorded at expansion time, then
                            -- restored in reverse so earlier headers stay put.
                            expanded[#expanded+1]=index;expand(index)
                        else complete=false end
                    elseif not header then Add(id,name,rank)end
                    index=index+1
                end
            end)
            for i=#expanded,1,-1 do
                local restored=pcall(collapse,expanded[i]);if not restored then complete=false end
            end
            readingSkills=false
            if ok and complete then known=FoundCount()>0 or expected==0 end
        end
    end
    if expected then known=FoundCount()==expected end
    if FoundCount()>=2 then known=true end
    local result={};for id,rank in pairs(found)do result[#result+1]={id,rank}end
    table.sort(result,function(a,b)return a[1]<b[1]end)
    skills,skillsKnown=result,known
end
local function Position(now)
    local map,x,y=ns.PlayerPosition()
    local valid=type(x)=="number" and type(y)=="number" and x>=0 and x<=1 and y>=0 and y<=1 and not(x==0 and y==0)
    return {map=valid and Num(map) or 0,x=valid and Num(x*65535+.5) or 0,y=valid and Num(y*65535+.5) or 0,at=now}
end
local function Send(message)
    if not guild then return end
    local send=C_ChatInfo and C_ChatInfo.SendAddonMessage or SendAddonMessage
    if send then pcall(send,PREFIX,message,"GUILD")end
end
function ns.SetGuildSharing(enabled)
    if not AzerothLiveMapDB then return end
    AzerothLiveMapDB.guildShare=enabled==true
    if not enabled then Send("X1")end
    nextRefresh=0;nextSend=0;nextSkills=0
end
function ns.GuildEvent(event,...)
    if readingSkills and event=="SKILL_LINES_CHANGED"then return end
    if event=="SKILL_LINES_CHANGED" or event=="PLAYER_ENTERING_WORLD" or event=="TRADE_SKILL_SHOW" or event=="CRAFT_SHOW"then nextSkills=0 end
    if event=="CHAT_MSG_ADDON" then
        local prefix,message,channel,sender=...
        if prefix~=PREFIX or channel~="GUILD" or type(message)~="string" or #message>100 then return end
        local key=Name(sender)
        if not key or not byName[key] or not members[byName[key]].online or key==SelfName()then return end
        if message=="X1"then shared[key]={revokedAt=GetTime()};return end
        local now=GetTime()
        local entry=shared[key] or {};shared[key]=entry
        local map,x,y=message:match("^L1:(%d+):(%d+):(%d+)$")
        if map and #map<=5 and #x<=5 and #y<=5 and tonumber(map)<=65535 and tonumber(x)<=65535 and tonumber(y)<=65535 then
            if entry.location and now-entry.location.at<1 then return end
            entry.location={map=tonumber(map),x=tonumber(x),y=tonumber(y),at=now}
            return
        end
        local known,p1,r1,p2,r2=message:match("^P1:([01]):(%d+):(%d+):(%d+):(%d+)$")
        if known and #p1<=3 and #p2<=3 and #r1<=3 and #r2<=3 then
            p1,p2,r1,r2=tonumber(p1),tonumber(p2),tonumber(r1),tonumber(r2)
            if (p1==0 or professions[p1])and(p2==0 or professions[p2])and r1<=450 and r2<=450 and (p1==0 or p1~=p2)then
                entry.skills={{p1,r1},{p2,r2}};entry.known=known=="1";entry.skillsAt=now
            end
        end
    else nextRefresh=0 end
end
function ns.UpdateGuild(now)
    Refresh(now)
    if now>=nextSkills then
        local ok=pcall(ReadSkills);if not ok then skills={};skillsKnown=false end
        nextSkills=now+(skillsKnown and 30 or 2)
    end
    if guild and AzerothLiveMapDB and AzerothLiveMapDB.guildShare==true and now>=nextSend then
        nextSend=now+5
        local pos=Position(now)
        Send("L1:"..pos.map..":"..pos.x..":"..pos.y)
        if calls%3==0 then
            local p1,p2=skills[1]or{0,0},skills[2]or{0,0}
            Send(table.concat({"P1",skillsKnown and 1 or 0,p1[1],p1[2],p2[1],p2[2]},":"))
        end
        calls=calls+1
    end
end
function ns.GuildProfessionStatus()
    pcall(ReadSkills)
    if not skillsKnown then return "Professions are still loading from WoW. Open your Skills or profession window, then try /daui guild status again."end
    if #skills==0 then return "WoW reports no primary professions learned."end
    local names={};for _,skill in ipairs(skills)do names[#names+1]=professionNames[skill[1]].." "..skill[2]end
    return "Local professions: "..table.concat(names," · ")..". Guild sharing is "..(AzerothLiveMapDB and AzerothLiveMapDB.guildShare and "on."or"off.")
end
local locationCursor=1
local function Details(index,now)
    local member=members[index];if not member then return nil end
    local self=member.key==SelfName()
    local data=self and {location=Position(now),skills=skills,known=skillsKnown,skillsAt=now} or shared[member.key]
    local location=data and data.location
    local valid=member.online and location and location.map>0 and now-location.at<TTL
    local payload={};Put(payload,epoch);Put(payload,valid and location.map or 0)
    Put(payload,valid and location.x or 0);Put(payload,valid and location.y or 0)
    Put(payload,valid and math.ceil(now-location.at) or 65535);payload[11]=valid and 1 or 0
    return payload
end
local packetCount=0
local function NextDetails(now)
    for _=1,#members do
        locationCursor=(locationCursor-1)%#members+1
        local member=members[locationCursor];local data=shared[member.key]
        if member.online and (member.key==SelfName() or (data and (
            (data.location and now-data.location.at<TTL) or (data.skillsAt and now-data.skillsAt<90) or (data.revokedAt and now-data.revokedAt<90))))then return true end
        locationCursor=locationCursor%#members+1
    end
    return false
end
function ns.GuildPacket(sequence,now)
    local ok=pcall(ns.UpdateGuild,now);if not ok or not records[0]then return nil end
    packetCount=packetCount+1
    local index,packet,generation
    if packetCount%10==1 then index=0;packet=records[0].packets[1];generation=records[0].generation
    elseif packetCount%5==0 and #urgent>0 then
        index=table.remove(urgent,1);queued[index]=nil
        local record=records[index];packet=record.packets[1];generation=record.generation
    elseif packetCount%3==0 and #members>0 and NextDetails(now) then
        local member=members[locationCursor];local self=member.key==SelfName()
        local data=self and {skills=skills,known=skillsKnown,skillsAt=now}or shared[member.key]
        if packetCount%2==0 then
            local payload=Details(locationCursor,now)
            revision=(revision+1)%65536;generation=revision
            packet={kind=3,payload=payload};index=2048+locationCursor
            locationCursor=locationCursor%#members+1
        else
            local known=member.online and data and data.known and now-(data.skillsAt or -math.huge)<90
            local p1=known and data.skills[1]or{0,0};local p2=known and data.skills[2]or{0,0}
            local payload={};Put(payload,epoch);payload[3]=known and 1 or 0
            Put(payload,p1 and p1[1]or 0);Put(payload,p1 and p1[2]or 0);Put(payload,p2 and p2[1]or 0);Put(payload,p2 and p2[2]or 0)
            revision=(revision+1)%65536
            index=1024+locationCursor;generation=revision;packet={kind=4,payload=payload}
        end
    else
        if not active or not records[active]then active=order[cursor];cursor=cursor%#order+1 end
        index=active;local record=records[index];packet=record.packets[record.cursor];generation=record.generation
        record.cursor=record.cursor+1
        if record.cursor>#record.packets then record.cursor=1;active=nil end
    end
    if not packet then return nil end
    return ns.EncodeQuest(packet.kind,sequence,ns.QuestSession or 0,generation,index,packet.payload,6)
end
if CreateFrame then
    local events=CreateFrame("Frame")
    for _,event in ipairs({"PLAYER_LOGIN","PLAYER_ENTERING_WORLD","PLAYER_GUILD_UPDATE","GUILD_ROSTER_UPDATE","CHAT_MSG_ADDON","SKILL_LINES_CHANGED","TRADE_SKILL_SHOW"})do events:RegisterEvent(event)end
    events:SetScript("OnEvent",function(_,event,...)
        if event=="PLAYER_LOGIN"then
            local register=C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix or RegisterAddonMessagePrefix
            if register then pcall(register,PREFIX)end
        end
        ns.GuildEvent(event,...)
    end)
    local elapsed=0
    events:SetScript("OnUpdate",function(_,dt)elapsed=elapsed+dt;if elapsed>=1 then elapsed=0;pcall(ns.UpdateGuild,GetTime())end end)
end
