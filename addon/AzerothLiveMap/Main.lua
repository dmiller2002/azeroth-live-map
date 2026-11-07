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
local lastLayout = nil
local auxiliary = false
local auxiliaryCount = 0
local function AuxiliaryPacket(mapID, x, y, sequence, now)
    auxiliaryCount = auxiliaryCount + 1
    if ns.MapDataPacket and auxiliaryCount % 8 == 5 then
        local packet = ns.MapDataPacket(mapID, sequence)
        if packet then return packet end
    end
    if ns.NativeQuestPacket and auxiliaryCount % 8 == 7 then
        local packet = ns.NativeQuestPacket(mapID, x, y, sequence, now)
        if packet then return packet end
    end
    if ns.CharacterPacket and auxiliaryCount % 8 == 0 then
        local packet = ns.CharacterPacket(sequence, now)
        if packet then return packet end
    end
    if ns.BagPacket and auxiliaryCount % 8 == 2 then
        local packet = ns.BagPacket(sequence, now)
        if packet then return packet end
    end
    if ns.BankPacket and auxiliaryCount % 8 == 6 then
        local packet = ns.BankPacket(sequence, now)
        if packet then return packet end
    end
    if ns.GuildPacket and (auxiliaryCount % 8 == 1 or auxiliaryCount % 8 == 5) then
        local packet = ns.GuildPacket(sequence, now)
        if packet then return packet end
    end
    if ns.QuestLogPacket and (auxiliaryCount % 8 == 3 or auxiliaryCount % 8 == 6 or auxiliaryCount % 8 == 7) then
        local packet = ns.QuestLogPacket(sequence, now)
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
    local scale = Number(UIParent:GetEffectiveScale(), 0)
    return Number(UIParent:GetWidth(), 0) * scale, Number(UIParent:GetHeight(), 0) * scale
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
    -- Login can briefly report an empty/smaller viewport. Wait for a usable
    -- one, and never replace the preferred saved position with its fitted copy.
    if width <= 0 or height <= 0 then return end
    db.size = math.max(2, math.min(12, math.floor(Number(db.size, 2))))
    local artMode = art and db.art
    local lanes = ns.QuestiePacket and (db.fastSync and 4 or (artMode and 1 or 0)) or 0
    local rows = artMode and (ns.Elephant.height+ns.Elephant.footerRows) or ns.ROWS*(1+lanes)
    local size = math.max(2,math.min(db.size,math.floor(height/rows)))
    local columns = artMode and math.max(ns.COLUMNS,ns.Elephant.width) or ns.COLUMNS
    local stripWidth = columns * size
    local stripHeight = rows * size
    -- Stored offsets are physical pixels, independent of the game's UI scale.
    db.x, db.y = math.max(0, Number(db.x, 12)), math.max(0, Number(db.y, 12))
    local x = math.floor(math.max(0, math.min(math.max(0, width - stripWidth), db.x)) + 0.5)
    local y = math.floor(math.max(0, math.min(math.max(0, height - stripHeight), db.y)) + 0.5)
    frame:SetScale(1 / UIParent:GetEffectiveScale())
    frame:SetSize(stripWidth, stripHeight)
    frame:ClearAllPoints()
    frame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", x, -y)
    lastLayout = {x=x,y=y}
    background:SetColorTexture(0,0,0,artMode and 0 or 1)
    if art then art:Layout(size,artMode) end
    for row = 1, 6 do
        for col = 1, 48 do
            local t = cells[row][col]
            t:SetShown(not artMode or row <= 2)
            t:SetSize(size, size)
            t:ClearAllPoints()
            t:SetPoint("TOPLEFT", artMode and art.locator or frame, "TOPLEFT", col * size, -row * size)
            if row <= 2 then
                local v = ns.Bit(ns.HEADER, col - 1)
                if row == 2 then v = 1 - v end
                t:SetColorTexture(v, v, v, 1)
            end
        end
    end
    for lane, data in ipairs(questFrames) do
        data.frame:SetShown(not artMode and lane <= lanes)
        data.frame:SetSize(stripWidth, ns.ROWS * size)
        data.frame:ClearAllPoints()
        data.frame:SetPoint("TOPLEFT",frame,"TOPLEFT",0,-lane * ns.ROWS * size)
        for row = 1, 6 do
            for col = 1, 48 do
                local texture = data.cells[row][col]
                texture:SetSize(size,size); texture:ClearAllPoints()
                texture:SetPoint("TOPLEFT",data.frame,"TOPLEFT",col * size,-row * size)
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
    label:SetShown(not db.locked)
    local handleWidth = 200
    handle:ClearAllPoints()
    local handleX = math.max(0, math.min(x, width-handleWidth)) - x
    if y + stripHeight + 28 <= height then
        handle:SetPoint("TOPLEFT", frame, "BOTTOMLEFT", handleX, -4)
    else
        handle:SetPoint("BOTTOMLEFT", frame, "TOPLEFT", handleX, 4)
    end
    handle:SetShown(db.enabled and not db.locked)
    frame:SetShown(db.enabled)
end

local function SavePosition(force)
    if not AzerothLiveMapDB or not lastLayout then return end
    local width, height = ScreenSize()
    if width <= 0 or height <= 0 then return end
    local left, top = frame:GetLeft(), frame:GetTop()
    if left and top then
        local scale, parentScale = frame:GetEffectiveScale(), UIParent:GetEffectiveScale()
        local x = Number(left * scale - (UIParent:GetLeft() or 0) * parentScale, nil)
        local y = Number(UIParent:GetTop() * parentScale - top * scale, nil)
        if not x or not y then return end
        x, y = math.floor(math.max(0,x)+.5), math.floor(math.max(0,y)+.5)
        -- A fitted/clamped display is temporary. Only a move should replace
        -- the preferred coordinates, including moves by another frame addon.
        if not force and x == lastLayout.x and y == lastLayout.y then return end
        AzerothLiveMapDB.x, AzerothLiveMapDB.y = x, y
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
    SavePosition(true)
    Layout()
end

frame:SetScript("OnDragStart", StartDrag)
frame:SetScript("OnDragStop", StopDrag)
handle:SetScript("OnDragStart", StartDrag)
handle:SetScript("OnDragStop", StopDrag)
frame:SetScript("OnHide", StopDrag)

local function Update()
    local mapID, x, y, facing = ns.PlayerPosition()
    sequence = (sequence + 1) % 65536
    local artMode = art and AzerothLiveMapDB.art
    local lanes = ns.QuestiePacket and (AzerothLiveMapDB.fastSync and 4 or (artMode and 1 or 0)) or 0
    local bytes = ns.Encode(mapID, x, y, facing, sequence, GetTime() * 1000, lanes, ns.QuestSession, artMode)
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

local function SetArtMode(enabled)
    if not AzerothLiveMapDB then return end
    StopDrag()
    AzerothLiveMapDB.art = enabled
    Layout()
    Update()
    Tell(enabled and "HUZZAH sprite enabled." or "Regular sync strip enabled.")
end

frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_LOGOUT")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("UI_SCALE_CHANGED")
frame:RegisterEvent("DISPLAY_SIZE_CHANGED")
frame:RegisterEvent("PLAYER_REGEN_ENABLED")
frame:RegisterEvent("BAG_UPDATE_DELAYED")
frame:RegisterEvent("PLAYER_EQUIPMENT_CHANGED")
frame:RegisterEvent("GET_ITEM_INFO_RECEIVED")
local bankEvents={BANKFRAME_OPENED=true,BANKFRAME_CLOSED=true,BANK_TABS_CHANGED=true,BANK_TAB_SETTINGS_UPDATED=true,PLAYERBANKSLOTS_CHANGED=true,PLAYER_ACCOUNT_BANK_TAB_SLOTS_CHANGED=true,BAG_CONTAINER_UPDATE=true}
for event in pairs(bankEvents) do frame:RegisterEvent(event) end
frame:SetScript("OnEvent", function(_, event)
    if ns.BankEvent then ns.BankEvent(event) end
    if bankEvents[event] then return end
    if event == "PLAYER_LOGOUT" then
        local wasDragging = dragging
        dragging = false
        if wasDragging then frame:StopMovingOrSizing() end
        SavePosition(wasDragging)
        return
    end
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
        Tell("Position and quest sync ready. /daui art on for the sprite, /daui art off for the regular strip. /daui unlock to move, /daui lock when finished.")
    end
    if dragging then
        dragging = false; frame:StopMovingOrSizing(); SavePosition(true)
    end
    if AzerothLiveMapDB then Layout(); Update() end
end)
frame:SetScript("OnUpdate", function(_, dt)
    if not AzerothLiveMapDB then return end
    local interval = AzerothLiveMapDB.fastSync and 0.05 or 0.1
    elapsed = elapsed + dt
    if elapsed + 0.000001 >= interval then
        -- Preserve fractional frame time, but never emit catch-up packets that
        -- the desktop cannot see after a slow game frame or a loading pause.
        elapsed = elapsed % interval
        if elapsed < 0.000001 or interval-elapsed < 0.000001 then elapsed = 0 end
        Update()
    end
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
        SavePosition(); AzerothLiveMapDB.locked = true; Layout()
        Tell("Strip locked. Clicks pass through to the game.")
    elseif command == "reset" then
        AzerothLiveMapDB.size, AzerothLiveMapDB.x, AzerothLiveMapDB.y = 2, 12, 12
        AzerothLiveMapDB.enabled, AzerothLiveMapDB.locked = true, true
        Layout(); Tell("Strip reset to the top-left corner at size 2.")
    elseif command == "sync" and (arg == "fast" or arg == "compact") then
        AzerothLiveMapDB.fastSync = arg == "fast"
        Layout(); Update()
        Tell(AzerothLiveMapDB.fastSync and "Fast sync: 20 updates/sec, four data packets alongside your position (up to 80 packets/sec)." or "Compact sync: 10 updates/sec with fewer data packets; all-zone quests take longer to arrive.")
    elseif command == "art" and (arg == "on" or arg == "off") then
        SetArtMode(arg == "on")
    elseif command == "minimap" and (arg == "hide" or arg == "show") then
        AzerothLiveMapDB.hideMinimap = arg == "hide"
        ApplyMinimap(AzerothLiveMapDB.hideMinimap,true)
    elseif command == "guild" and arg == "status" then
        Tell(ns.GuildProfessionStatus())
    elseif command == "guild" and (arg == "on" or arg == "off") then
        ns.SetGuildSharing(arg == "on")
        Tell(arg == "on" and "Guild sharing on: your coordinates and primary professions are shared with guild members using Drunks Azeroth UI." or "Guild sharing off. Your roster remains available in the companion.")
    elseif command == "size" and Number(arg, nil) then
        AzerothLiveMapDB.size = math.max(2, math.min(12, math.floor(Number(arg, 2)))); Layout()
        Tell("Data block: " .. frame:GetWidth() .. " x " .. frame:GetHeight() .. " pixels. Keep every row visible. If sharing scales it down too far, try /alm size 3 or 4.")
    else
        Tell("/alm guild on|off|status · /alm minimap hide|show · /alm art on|off · /alm size 2 (2–12) · /alm sync fast|compact · /alm unlock · /alm lock · /alm reset · /alm show · /alm hide. Keep the full artwork/data block visible while sharing WoW.")
    end
end
