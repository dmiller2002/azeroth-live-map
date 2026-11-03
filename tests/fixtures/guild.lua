-- Synthetic guild APIs. Nothing is sent to WoW or a real guild.
guildFixture={name="HUZZAH Test Guild",messages={},members={
    {name="Éowyn-TestRealm",rank="Guild Master",level=65,class="WARRIOR",zone="Elwynn Forest",online=true},
    {name="Aelith-TestRealm",rank="Member",level=70,class="MAGE",zone="Elwynn Forest",online=true},
    {name="Borin-TestRealm",rank="Member",level=60,class="HUNTER",zone="Ironforge",online=false},
    {name="Cora-TestRealm",rank="Officer",level=66,class="PRIEST",zone="Stormwind City",online=true},
}}
GetGuildInfo=function()return guildFixture.name end
GetNumGuildMembers=function()return #guildFixture.members end
GetGuildRosterInfo=function(index)
    local m=guildFixture.members[index]
    if m then return m.name,m.rank,1,m.level,m.class,m.zone,"private public note","private officer note",m.online,0,m.class end
end
GuildRoster=function()end
if not UnitName then UnitName=function()return "Éowyn","Test Realm"end end
GetRealmName=function()return "Test Realm"end
GetProfessions=function()return 1,2 end
GetProfessionInfo=function(index)
    if index==1 then return "Mining",nil,375,375,nil,nil,186 end
    return "Blacksmithing",nil,360,375,nil,nil,164
end
C_Map={GetBestMapForUnit=function()return 1429 end,GetPlayerMapPosition=function()return {GetXY=function()return .44,.59 end}end}
C_ChatInfo={SendAddonMessage=function(prefix,message,channel)
    guildFixture.messages[#guildFixture.messages+1]={prefix,message,channel}
end}
function guildFixture.share(ns)
    ns.GuildEvent("CHAT_MSG_ADDON","DAUI_GUILD1","L1:1429:22937:29491","GUILD","Aelith-TestRealm")
    ns.GuildEvent("CHAT_MSG_ADDON","DAUI_GUILD1","P1:1:171:375:182:365","GUILD","Aelith-TestRealm")
end
