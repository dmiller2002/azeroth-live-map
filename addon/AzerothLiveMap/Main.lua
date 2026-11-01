local _, ns = ...
local frame = CreateFrame("Frame", "AzerothLiveMapStrip", UIParent)
frame:SetFrameStrata("TOOLTIP")
frame:SetMovable(true)
frame:SetClampedToScreen(true)
frame:SetDontSavePosition(true) -- AzerothLiveMapDB owns the saved pixel offsets.
frame:RegisterForDrag("LeftButton")
frame:EnableMouse(false)
local background = frame:CreateTexture(nil, "BACKGROUND")
background:SetAllPoints()
background:SetColorTexture(0, 0, 0, 1)
local cells, sequence, elapsed, dragging = {}, 0, 0, false
local auxiliary = false
local auxiliaryCount = 0
local function AuxiliaryPacket(mapID, x, y, sequence, now)
    auxiliaryCount = auxiliaryCount + 1
    if ns.CharacterPacket and auxiliaryCount % 4 == 0 then
        local packet = ns.CharacterPacket(sequence, now)
        if packet then return packet end
    end
    if ns.BagPacket and auxiliaryCount % 4 == 2 then
        local packet = ns.BagPacket(sequence, now)
        if packet then return packet end
    end
    return ns.QuestiePacket(mapID, x, y, sequence, now)
end
local pendingMinimap = nil
local questFrames = {}
local art = ns.Elephant and ns.CreateArt(frame)
for row = 1, 6 do
    cells[row] = {}
    for col = 1, 48 do
        local t = frame:CreateTexture(nil, "ARTWORK")
        t:SetColorTexture(0, 0, 0, 1)
        cells[row][col] = t
    end
end

-- Four parallel, independently checksummed quest lanes below the position row.
-- The original top rectangle remains readable by older companion versions.
for lane = 1, 4 do
    local child = CreateFrame("Frame", nil, frame)
    child:EnableMouse(false)
    local bg = child:CreateTexture(nil, "BACKGROUND"); bg:SetAllPoints(); bg:SetColorTexture(0,0,0,1)
    local grid = {}
    for row = 1, 6 do
        grid[row] = {}
        for col = 1, 48 do
            local texture = child:CreateTexture(nil,"ARTWORK")
            texture:SetColorTexture(0,0,0,1); grid[row][col] = texture
        end
    end
    questFrames[lane] = { frame = child, cells = grid }
end

-- The handle sits outside the encoded rectangle so it cannot cover any bits.
local handle = CreateFrame("Frame", "AzerothLiveMapDragHandle", frame)
handle:SetSize(200, 24)
handle:RegisterForDrag("LeftButton")
handle:EnableMouse(false)
handle:Hide()
local handleBackground = handle:CreateTexture(nil, "BACKGROUND")
handleBackground:SetAllPoints()
handleBackground:SetColorTexture(0.06, 0.1, 0.08, 0.96)
local label = handle:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
label:SetPoint("CENTER", handle, "CENTER")
label:SetText("Drag to move  |  /alm lock")
label:SetTextColor(0.54, 0.88, 0.75)

local function Number(value, fallback)
    value = tonumber(value)
    if not value or value ~= value or value == math.huge or value == -math.huge then return fallback end
    return value
end

local function ScreenSize()
    local scale = UIParent:GetEffectiveScale()
    return UIParent:GetWidth() * scale, UIParent:GetHeight() * scale
end

local function Tell(text)
    print("|cff67d9baDrunks Azeroth UI:|r " .. text)
end

local function ApplyMinimap(hidden, notify)
    if InCombatLockdown and InCombatLockdown() then
        pendingMinimap = hidden
        if notify then Tell("Minimap change queued until combat ends.") end
        return
    end
    local minimap = MinimapCluster
    if not minimap or type(minimap.SetShown) ~= "function" then
        if notify then Tell("The built-in minimap is not available in this client.") end
        return
    end
    minimap:SetShown(not hidden)
    pendingMinimap = nil
    if notify then Tell(hidden and "WoW minimap hidden. /alm minimap show to restore it." or "WoW minimap shown.") end
end

local function Layout()
    local db = AzerothLiveMapDB
    local width, height = ScreenSize()
    db.size = math.max(2, math.min(12, math.floor(Number(db.size, 2))))
    local artMode = art and db.art
    local lanes = ns.QuestiePacket and (db.fastSync and 4 or (artMode and 1 or 0)) or 0
    local rows = artMode and (ns.Elephant.height+ns.Elephant.footerRows) or ns.ROWS*(1+lanes)
    db.size = math.max(2,math.min(db.size,math.floor(height/rows)))
    local columns = artMode and math.max(ns.COLUMNS,ns.Elephant.width) or ns.COLUMNS
    local stripWidth = columns * db.size
    local stripHeight = rows * db.size
    -- Stored offsets are physical pixels, independent of the game's UI scale.
    db.x = math.floor(math.max(0, math.min(math.max(0, width - stripWidth), Number(db.x, 12))) + 0.5)
    db.y = math.floor(math.max(0, math.min(math.max(0, height - stripHeight), Number(db.y, 12))) + 0.5)
    frame:SetScale(1 / UIParent:GetEffectiveScale())
    frame:SetSize(stripWidth, stripHeight)
    frame:ClearAllPoints()
    frame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", db.x, -db.y)
    background:SetColorTexture(0,0,0,artMode and 0 or 1)
    if art then art:Layout(db.size,artMode) end
    for row = 1, 6 do
        for col = 1, 48 do
            local t = cells[row][col]
            t:SetShown(not artMode or row <= 2)
            t:SetSize(db.size, db.size)
            t:ClearAllPoints()
            t:SetPoint("TOPLEFT", artMode and art.locator or frame, "TOPLEFT", col * db.size, -row * db.size)
            if row <= 2 then
                local v = ns.Bit(ns.HEADER, col - 1)
                if row == 2 then v = 1 - v end
                t:SetColorTexture(v, v, v, 1)
            end
        end
    end
    for lane, data in ipairs(questFrames) do
        data.frame:SetShown(not artMode and lane <= lanes)
        data.frame:SetSize(stripWidth, ns.ROWS * db.size)
        data.frame:ClearAllPoints()
        data.frame:SetPoint("TOPLEFT",frame,"TOPLEFT",0,-lane * ns.ROWS * db.size)
        for row = 1, 6 do
            for col = 1, 48 do
                local texture = data.cells[row][col]
                texture:SetSize(db.size,db.size); texture:ClearAllPoints()
                texture:SetPoint("TOPLEFT",data.frame,"TOPLEFT",col * db.size,-row * db.size)
                if row <= 2 then
                    local value = ns.Bit(ns.HEADER,col-1)
                    if row == 2 then value = 1-value end
                    texture:SetColorTexture(value,value,value,1)
                end
            end
        end
    end
    frame:EnableMouse(not db.locked)
    handle:EnableMouse(not db.locked)
    handle:ClearAllPoints()
    local right = db.x + 200 > width
    if db.y + stripHeight + 28 <= height then
        handle:SetPoint(right and "TOPRIGHT" or "TOPLEFT", frame, right and "BOTTOMRIGHT" or "BOTTOMLEFT", 0, -4)
    else
        handle:SetPoint(right and "BOTTOMRIGHT" or "BOTTOMLEFT", frame, right and "TOPRIGHT" or "TOPLEFT", 0, 4)
    end
    handle:SetShown(db.enabled and not db.locked)
    frame:SetShown(db.enabled)
end

local function SavePosition()
    local left, top = frame:GetLeft(), frame:GetTop()
    if left and top then
        local scale, parentScale = frame:GetEffectiveScale(), UIParent:GetEffectiveScale()
        AzerothLiveMapDB.x = left * scale - (UIParent:GetLeft() or 0) * parentScale
        AzerothLiveMapDB.y = UIParent:GetTop() * parentScale - top * scale
    end
end

local function StartDrag()
    if not AzerothLiveMapDB or AzerothLiveMapDB.locked then return end
    dragging = true
    frame:StartMoving()
end

local function StopDrag()
    if not dragging then return end
    dragging = false
    frame:StopMovingOrSizing()
    SavePosition()
    Layout()
end

frame:SetScript("OnDragStart", StartDrag)
frame:SetScript("OnDragStop", StopDrag)
handle:SetScript("OnDragStart", StartDrag)
handle:SetScript("OnDragStop", StopDrag)
frame:SetScript("OnHide", StopDrag)

local function Update()
    local mapID = C_Map.GetBestMapForUnit("player")
    local position = mapID and C_Map.GetPlayerMapPosition(mapID, "player")
    local x, y
    if position then x, y = position:GetXY() end
    -- (0,0) is a common unavailable-position sentinel.
    if x == 0 and y == 0 then x, y = nil, nil end
    sequence = (sequence + 1) % 65536
    local artMode = art and AzerothLiveMapDB.art
    local lanes = ns.QuestiePacket and (AzerothLiveMapDB.fastSync and 4 or (artMode and 1 or 0)) or 0
    local bytes = ns.Encode(mapID, x, y, GetPlayerFacing(), sequence, GetTime() * 1000, lanes, ns.QuestSession, artMode)
    local packets = {bytes}
    if ns.QuestiePacket and lanes == 0 then
        auxiliary = not auxiliary
        if auxiliary then bytes = AuxiliaryPacket(mapID, x, y, sequence, GetTime()) end
    end
    for lane = 1, lanes do
        sequence = (sequence + 1) % 65536
        local packet = AuxiliaryPacket(mapID,x,y,sequence,GetTime())
        packets[#packets+1] = packet
        if not artMode then for row = 3, 6 do
            for col = 1, 48 do
                local value = ns.Bit(packet,(row-3)*48+col-1)
                questFrames[lane].cells[row][col]:SetColorTexture(value,value,value,1)
            end
        end end
    end
    if artMode then art:Render(packets,GetTime()) end
    for row = 3, 6 do
        for col = 1, 48 do
            local v = ns.Bit(bytes, (row - 3) * 48 + col - 1)
            cells[row][col]:SetColorTexture(v, v, v, 1)
        end
    end
end

frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("UI_SCALE_CHANGED")
frame:RegisterEvent("DISPLAY_SIZE_CHANGED")
frame:RegisterEvent("PLAYER_REGEN_ENABLED")
frame:RegisterEvent("BAG_UPDATE_DELAYED")
frame:RegisterEvent("PLAYER_EQUIPMENT_CHANGED")
frame:RegisterEvent("GET_ITEM_INFO_RECEIVED")
frame:SetScript("OnEvent", function(_, event)
    if event == "BAG_UPDATE_DELAYED" or event == "PLAYER_EQUIPMENT_CHANGED" or event == "GET_ITEM_INFO_RECEIVED" then
        if ns.InvalidateBags then ns.InvalidateBags() end
        return
    end
    if event == "PLAYER_REGEN_ENABLED" then
        if pendingMinimap ~= nil then ApplyMinimap(pendingMinimap,true) end
        return
    end
    if event == "PLAYER_LOGIN" then
        AzerothLiveMapDB = type(AzerothLiveMapDB) == "table" and AzerothLiveMapDB or {}
        local db = AzerothLiveMapDB
        db.size = math.max(2, math.min(12, math.floor(Number(db.size, 2))))
        if type(db.enabled) ~= "boolean" then db.enabled = true end
        if type(db.fastSync) ~= "boolean" then db.fastSync = true end
        if type(db.art) ~= "boolean" then db.art = true end
        if type(db.hideMinimap) ~= "boolean" then db.hideMinimap = nil end
        -- Leave other minimap customization alone until the user opts in.
        if db.hideMinimap then ApplyMinimap(true,false) end
        -- Never unexpectedly intercept clicks after a reload or a new login.
        db.locked = true
        Tell("Position and quest sync ready. /alm art on|off for HUZZAH/plain strip, /alm unlock to move, /alm lock when finished.")
    end
    if dragging then dragging = false; frame:StopMovingOrSizing() end
    if AzerothLiveMapDB then Layout(); Update() end
end)
frame:SetScript("OnUpdate", function(_, dt)
    elapsed = elapsed + dt
    if elapsed >= 0.1 and AzerothLiveMapDB then elapsed = 0; Update() end
end)
SLASH_AZEROTHLIVEMAP1 = "/alm"
SLASH_AZEROTHLIVEMAP2 = "/daui"
SlashCmdList.AZEROTHLIVEMAP = function(message)
    if not AzerothLiveMapDB then return end
    local command, arg = message:match("^(%S*)%s*(.-)$")
    command = command:lower()
    StopDrag()
    if command == "show" then AzerothLiveMapDB.enabled = true; Layout()
    elseif command == "hide" then AzerothLiveMapDB.enabled = false; Layout()
    elseif command == "unlock" then
        AzerothLiveMapDB.locked = false; AzerothLiveMapDB.enabled = true; Layout()
        Tell("Drag the strip or its handle. Use /alm lock when finished.")
    elseif command == "lock" then
        AzerothLiveMapDB.locked = true; Layout()
        Tell("Strip locked. Clicks pass through to the game.")
    elseif command == "reset" then
        AzerothLiveMapDB.size, AzerothLiveMapDB.x, AzerothLiveMapDB.y = 2, 12, 12
        AzerothLiveMapDB.enabled, AzerothLiveMapDB.locked = true, true
        Layout(); Tell("Strip reset to the top-left corner at size 2.")
    elseif command == "sync" and (arg == "fast" or arg == "compact") then
        AzerothLiveMapDB.fastSync = arg == "fast"
        Layout(); Update()
        Tell(AzerothLiveMapDB.fastSync and "Fast sync: four quest packets alongside your position." or "Compact sync: fewer quest packets; all-zone quests take longer to arrive.")
    elseif command == "art" and (arg == "on" or arg == "off") then
        AzerothLiveMapDB.art = arg == "on"
        Layout(); Update()
        Tell(AzerothLiveMapDB.art and "Animated HUZZAH crest enabled. Keep the crest and its short locator line visible." or "Plain data strip enabled.")
    elseif command == "minimap" and (arg == "hide" or arg == "show") then
        AzerothLiveMapDB.hideMinimap = arg == "hide"
        ApplyMinimap(AzerothLiveMapDB.hideMinimap,true)
    elseif command == "size" and Number(arg, nil) then
        AzerothLiveMapDB.size = math.max(2, math.min(12, math.floor(Number(arg, 2)))); Layout()
        Tell("Data block: " .. frame:GetWidth() .. " x " .. frame:GetHeight() .. " pixels. Keep every row visible. If sharing scales it down too far, try /alm size 3 or 4.")
    else
        Tell("/alm minimap hide|show · /alm art on|off · /alm size 2 (2–12) · /alm sync fast|compact · /alm unlock · /alm lock · /alm reset · /alm show · /alm hide. Keep the full artwork/data block visible while sharing WoW.")
    end
end
