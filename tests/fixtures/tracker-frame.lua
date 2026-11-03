-- Minimal frame geometry for exercising the real addon login/drag/logout code.
trackerFixture={width=2560,height=1440,scale=.8,left=0,bottom=0,frames={}}
local methods={}
for _,method in ipairs({'SetFrameStrata','SetMovable','SetClampedToScreen','SetDontSavePosition','RegisterForDrag','SetAllPoints','SetColorTexture','SetTextColor'})do methods[method]=function()end end
function methods:EnableMouse(enabled)self.mouseEnabled=enabled end
function methods:SetText(text)self.text=text end
function methods:SetScale(scale)self.scale=scale end
function methods:GetEffectiveScale()return (self.parent and self.parent:GetEffectiveScale()or 1)*(self.scale or 1)end
function methods:SetSize(width,height)self.width=width;self.height=height end
function methods:GetWidth()return self.width or 0 end
function methods:GetHeight()return self.height or 0 end
function methods:ClearAllPoints()end
function methods:SetPoint(point,parent,relative,x,y)
    self.anchor={point=point,parent=parent,relative=relative,x=x or 0,y=y or 0}
    if self.name=='AzerothLiveMapStrip'then
        self.x=x;self.y=-y
    end
end
function methods:GetLeft()return self.x and (trackerFixture.left+self.x)/self:GetEffectiveScale()end
function methods:GetTop()return self.y and (trackerFixture.bottom+trackerFixture.height-self.y)/self:GetEffectiveScale()end
function methods:SetShown(shown)
    local before=self.shown;self.shown=shown
    if before and not shown and self.scripts.OnHide then self.scripts.OnHide(self)end
end
function methods:Hide()self:SetShown(false)end
function methods:SetScript(name,callback)self.scripts[name]=callback end
function methods:RegisterEvent(name)self.events[name]=true end
function methods:StartMoving()self.moving=true end
function methods:StopMovingOrSizing()self.moving=false end
local function Object(name,parent)
    return setmetatable({name=name,parent=parent,scale=1,scripts={},events={},shown=true},{__index=methods})
end
function methods:CreateTexture()return Object(nil,self)end
function methods:CreateFontString()return Object(nil,self)end
UIParent=Object('UIParent')
function UIParent:GetEffectiveScale()return trackerFixture.scale end
function UIParent:GetWidth()return trackerFixture.width/trackerFixture.scale end
function UIParent:GetHeight()return trackerFixture.height/trackerFixture.scale end
function UIParent:GetLeft()return trackerFixture.left/trackerFixture.scale end
function UIParent:GetTop()return (trackerFixture.height+trackerFixture.bottom)/trackerFixture.scale end
CreateFrame=function(_,name,parent)
    local frame=Object(name,parent)
    if name then trackerFixture.frames[name]=frame end
    return frame
end
C_Map={GetBestMapForUnit=function()return 1429 end,GetPlayerMapPosition=function()return {GetXY=function()return .5,.5 end}end}
GetPlayerFacing=function()return 0 end
GetTime=function()return 1 end
SlashCmdList={}
print=function()end
function trackerFixture.boot(saved)
    AzerothLiveMapDB=saved
    trackerFixture.positionWrites=0;trackerFixture.auxiliaryWrites=0
    local ns={Elephant={height=60,footerRows=8,width=64},QuestSession=1}
    assert(loadfile('addon/AzerothLiveMap/Compat.lua'))('AzerothLiveMap',ns)
assert(loadfile('addon/AzerothLiveMap/Protocol.lua'))('AzerothLiveMap',ns)
    local encode=ns.Encode
    ns.Encode=function(...)
        local bytes=encode(...);trackerFixture.positionPacket=bytes;trackerFixture.positionWrites=trackerFixture.positionWrites+1;return bytes
    end
    ns.CreateArt=function(parent)return {locator=Object(nil,parent),Layout=function(_,_,enabled)trackerFixture.artVisible=enabled end,Render=function()end}end
    ns.QuestiePacket=function(_,_,_,sequence)
        trackerFixture.auxiliaryWrites=trackerFixture.auxiliaryWrites+1
        return ns.EncodeQuest(0,sequence,1429,1,0,{0},3)
    end
    assert(loadfile('addon/AzerothLiveMap/Main.lua'))('AzerothLiveMap',ns)
    trackerFixture.frame=trackerFixture.frames.AzerothLiveMapStrip
    trackerFixture.handle=trackerFixture.frames.AzerothLiveMapDragHandle
    trackerFixture.event('PLAYER_LOGIN')
end
function trackerFixture.event(event)
    local frame=trackerFixture.frame
    assert(frame.events[event],'Missing event registration: '..event)
    frame.scripts.OnEvent(frame,event)
end
function trackerFixture.command(command)SlashCmdList.AZEROTHLIVEMAP(command)end
function trackerFixture.drag(x,y,finish)
    trackerFixture.command('unlock')
    trackerFixture.handle.scripts.OnDragStart(trackerFixture.handle)
    trackerFixture.frame.x=x;trackerFixture.frame.y=y
    if finish then trackerFixture.handle.scripts.OnDragStop(trackerFixture.handle)end
end
function trackerFixture.saved()
    local result={};for key,value in pairs(AzerothLiveMapDB)do result[key]=value end;return result
end
function trackerFixture.position(x,y)
    assert(math.abs(trackerFixture.frame.x-x)<.01,'Unexpected horizontal tracker position')
    assert(math.abs(trackerFixture.frame.y-y)<.01,'Unexpected vertical tracker position')
end
