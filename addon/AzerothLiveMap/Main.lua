local _, ns = ...
local frame = CreateFrame("Frame", "AzerothLiveMapStrip", UIParent)
frame:SetFrameStrata("TOOLTIP")
frame:SetMovable(true)
frame:SetClampedToScreen(true)
frame:SetDontSavePosition(true) -- AzerothLiveMapDB owns the saved pixel offsets.
-- The signal sits above the game UI, including the minimap tracking button.
-- Keep it click-through even while unlocked; only the external handle drags.
frame:EnableMouse(false)
local background = frame:CreateTexture(nil, "BACKGROUND")
background:SetAllPoints()
background:SetColorTexture(0, 0, 0, 1)
local cells, sequence, elapsed, dragging = {}, 0, 0, false
local IDLE_INTERVAL = 0.5
local lastMap, lastX, lastY, lastFacing
local lastLayout = nil
local auxiliary = false
local auxiliaryCount = 0
local pendingMinimap = nil
local questFrames = {}
local art = ns.Elephant and ns.CreateArt(frame)

-- Auxiliary feeds share the data lanes in a fixed 8-slot rotation. Each slot
-- lists feeds in priority order; the first one with a packet wins, and Questie
-- (or its empty heartbeat) fills whatever is left. Bandwidth per feed, out of 8:
-- map data 1, native quests 1, character 1, bags 1, bank 1, guild 1-2,
-- quest log 1-3, depending on which higher-priority feeds are idle.
local FEEDS = {
    { "MapDataPacket",     { 5 },       function(fn, mapID, x, y, seq, now) return fn(mapID, seq) end },
    { "NativeQuestPacket", { 7 },       function(fn, mapID, x, y, seq, now) return fn(mapID, x, y, seq, now) end },
    { "CharacterPacket",   { 0 },       function(fn, mapID, x, y, seq, now) return fn(seq, now) end },
    { "BagPacket",         { 2 },       function(fn, mapID, x, y, seq, now) return fn(seq, now) end },
    { "BankPacket",        { 6 },       function(fn, mapID, x, y, seq, now) return fn(seq, now) end },
    { "GuildPacket",       { 1, 5 },    function(fn, mapID, x, y, seq, now) return fn(seq, now) end },
    { "QuestLogPacket",    { 3, 6, 7 }, function(fn, mapID, x, y, seq, now) return fn(seq, now) end },
}
local SCHEDULE = {}
for slot = 0, 7 do SCHEDULE[slot] = {} end
for _, feed in ipairs(FEEDS) do
    for _, slot in ipairs(feed[2]) do table.insert(SCHEDULE[slot], feed) end
end

local function AuxiliaryPacket(mapID, x, y, seq, now)
    auxiliaryCount = auxiliaryCount + 1
    for _, feed in ipairs(SCHEDULE[auxiliaryCount % 8]) do
        local fn = ns[feed[1]]
        if fn then
            local packet = ns.Timed(feed[1], feed[3], fn, mapID, x, y, seq, now)
            if packet then return packet end
        end
    end
    return ns.Timed("QuestiePacket", ns.QuestiePacket, mapID, x, y, seq, now)
end

-- Textures remember the bit they show. Most bits are identical from one
-- update to the next, so skipping redundant SetColorTexture calls removes
-- most of the per-update cost (up to ~960 texture writes at 20 updates/sec).
local function Paint(texture, value)
    if texture.dauiBit ~= value then
        texture.dauiBit = value
        texture:SetColorTexture(value, value, value, 1)
    end
end
local function PaintPacket(grid, packet)
    for row = 3, 6 do
        local cellsInRow, offset = grid[row], (row - 3) * 48 - 1
        for col = 1, 48 do Paint(cellsInRow[col], ns.Bit(packet, offset + col)) end
    end
end
local function NewGrid(parent)
    local grid = {}
    for row = 1, 6 do
        grid[row] = {}
        for col = 1, 48 do
            local texture = parent:CreateTexture(nil, "ARTWORK")
            texture:SetColorTexture(0, 0, 0, 1)
            texture.dauiBit = 0
            grid[row][col] = texture
        end
    end
    return grid
end

cells = NewGrid(frame)
-- Four parallel, independently checksummed quest lanes below the position row.
-- The original top rectangle remains readable by older companion versions.
for lane = 1, 4 do
    local child = CreateFrame("Frame", nil, frame)
    child:EnableMouse(false)
    local bg = child:CreateTexture(nil, "BACKGROUND"); bg:SetAllPoints(); bg:SetColorTexture(0, 0, 0, 1)
    questFrames[lane] = { frame = child, cells = NewGrid(child) }
end

-- The handle sits outside the encoded rectangle so it cannot cover any bits.
-- It is scaled back to normal UI size, since the strip itself is pixel-exact.
local HANDLE_WIDTH, HANDLE_HEIGHT = 200, 24
local handle = CreateFrame("Frame", "AzerothLiveMapDragHandle", frame)
handle:SetSize(HANDLE_WIDTH, HANDLE_HEIGHT)
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

-- Returns the screen in physical pixels and the number of physical pixels per
-- UI unit at effective scale 1 (WoW's UI is 768 units tall at that scale).
-- Every saved position, size and strip coordinate is in physical pixels, so
-- each data bit covers a whole number of real pixels with crisp edges.
local function ScreenSize()
    local scale = Number(UIParent:GetEffectiveScale(), 0)
    local uiWidth, uiHeight = Number(UIParent:GetWidth(), 0) * scale, Number(UIParent:GetHeight(), 0) * scale
    if uiWidth <= 0 or uiHeight <= 0 then return 0, 0, 0 end
    local width, height
    if GetPhysicalScreenSize then width, height = GetPhysicalScreenSize() end
    width, height = Number(width, 0), Number(height, 0)
    if width <= 0 or height <= 0 then width, height = uiWidth, uiHeight end
    return width, height, height / uiHeight
end

-- The companion searches a copy of the capture scaled to at most 2560 pixels
-- wide and needs cells of at least ~1.4 pixels there.
local MAX_SIZE = 24
local function MinimumSize(width) return math.max(2, math.ceil(1.5 * width / 2560)) end
local function DefaultSize(width) return math.max(3, MinimumSize(width)) end
local function ClampSize(value, width)
    return math.max(MinimumSize(width), math.min(MAX_SIZE, math.floor(Number(value, DefaultSize(width)) + 0.5)))
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

local function LaneCount(artMode)
    if not ns.QuestiePacket then return 0 end
    return AzerothLiveMapDB.fastSync and 4 or (artMode and 1 or 0)
end

local function PaintHeader(grid)
    for col = 1, 48 do
        local value = ns.Bit(ns.HEADER, col - 1)
        Paint(grid[1][col], value)
        Paint(grid[2][col], 1 - value)
    end
end

local function Layout()
    local db = AzerothLiveMapDB
    local width, height, pixelsPerUnit = ScreenSize()
    -- Login can briefly report an empty/smaller viewport. Wait for a usable
    -- one, and never replace the preferred saved position with its fitted copy.
    if width <= 0 or height <= 0 then return end
    if db.units == "ui" then
        -- Addon 1.0.3 and older stored UI units. Convert once, keeping the
        -- strip at the same place and on-screen size.
        db.x = db.x and Number(db.x, 12) * pixelsPerUnit
        db.y = db.y and Number(db.y, 12) * pixelsPerUnit
        db.size = db.size and Number(db.size, 2) * pixelsPerUnit
    end
    db.units = "px"
    db.size = ClampSize(db.size, width)
    local artMode = art and db.art
    local lanes = LaneCount(artMode)
    local rows = artMode and (ns.Elephant.height + ns.Elephant.footerRows) or ns.ROWS * (1 + lanes)
    local size = math.max(2, math.min(db.size, math.floor(height / rows)))
    local columns = artMode and math.max(ns.COLUMNS, ns.Elephant.width) or ns.COLUMNS
    local stripWidth = columns * size
    local stripHeight = rows * size
    db.x, db.y = math.max(0, Number(db.x, 12)), math.max(0, Number(db.y, 12))
    local x = math.floor(math.max(0, math.min(math.max(0, width - stripWidth), db.x)) + 0.5)
    local y = math.floor(math.max(0, math.min(math.max(0, height - stripHeight), db.y)) + 0.5)
    -- One strip unit is exactly one physical pixel.
    local uiScale = UIParent:GetEffectiveScale()
    frame:SetScale(1 / (uiScale * pixelsPerUnit))
    frame:SetSize(stripWidth, stripHeight)
    frame:ClearAllPoints()
    frame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", x, -y)
    lastLayout = { x = x, y = y }
    background:SetColorTexture(0, 0, 0, artMode and 0 or 1)
    if art then art:Layout(size, artMode) end
    for row = 1, 6 do
        for col = 1, 48 do
            local t = cells[row][col]
            t:SetShown(not artMode or row <= 2)
            t:SetSize(size, size)
            t:ClearAllPoints()
            t:SetPoint("TOPLEFT", artMode and art.locator or frame, "TOPLEFT", col * size, -row * size)
        end
    end
    PaintHeader(cells)
    for lane, data in ipairs(questFrames) do
        data.frame:SetShown(not artMode and lane <= lanes)
        data.frame:SetSize(stripWidth, ns.ROWS * size)
        data.frame:ClearAllPoints()
        data.frame:SetPoint("TOPLEFT", frame, "TOPLEFT", 0, -lane * ns.ROWS * size)
        for row = 1, 6 do
            for col = 1, 48 do
                local texture = data.cells[row][col]
                texture:SetSize(size, size); texture:ClearAllPoints()
                texture:SetPoint("TOPLEFT", data.frame, "TOPLEFT", col * size, -row * size)
            end
        end
        PaintHeader(data.cells)
    end
    -- The handle keeps the game's normal UI scale; place it in physical pixels.
    local handleScale = uiScale * pixelsPerUnit
    handle:SetScale(handleScale)
    handle:EnableMouse(not db.locked)
    label:SetShown(not db.locked)
    local handleWidth = HANDLE_WIDTH * handleScale
    handle:ClearAllPoints()
    local handleX = (math.max(0, math.min(x, width - handleWidth)) - x) / handleScale
    if y + stripHeight + (HANDLE_HEIGHT + 4) * handleScale <= height then
        handle:SetPoint("TOPLEFT", frame, "BOTTOMLEFT", handleX, -4)
    else
        handle:SetPoint("BOTTOMLEFT", frame, "TOPLEFT", handleX, 4)
    end
    handle:SetShown(db.enabled and not db.locked)
    frame:SetShown(db.enabled)
end

local function SavePosition(force)
    if not AzerothLiveMapDB or not lastLayout then return end
    local width, height, pixelsPerUnit = ScreenSize()
    if width <= 0 or height <= 0 then return end
    local left, top = frame:GetLeft(), frame:GetTop()
    if left and top then
        local scale = frame:GetEffectiveScale() * pixelsPerUnit
        local parentScale = UIParent:GetEffectiveScale() * pixelsPerUnit
        local x = Number(left * scale - (UIParent:GetLeft() or 0) * parentScale, nil)
        local y = Number(UIParent:GetTop() * parentScale - top * scale, nil)
        if not x or not y then return end
        x, y = math.floor(math.max(0, x) + .5), math.floor(math.max(0, y) + .5)
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

handle:SetScript("OnDragStart", StartDrag)
handle:SetScript("OnDragStop", StopDrag)
frame:SetScript("OnHide", StopDrag)

local RunUpdate
local function Update()
    local mapID, x, y, facing = ns.PlayerPosition()
    sequence = (sequence + 1) % 65536
    if ns.Profile then local start = debugprofilestop(); RunUpdate(mapID, x, y, facing); ns.Profile.Update = (ns.Profile.Update or 0) + debugprofilestop() - start
    else RunUpdate(mapID, x, y, facing) end
end

function RunUpdate(mapID, x, y, facing)
    -- Any change in where the player is or faces keeps the strip at full speed.
    if mapID ~= lastMap or facing ~= lastFacing or (x and lastX and (math.abs(x - lastX) > 1e-6 or math.abs(y - lastY) > 1e-6)) or (x == nil) ~= (lastX == nil) then
        lastMap, lastX, lastY, lastFacing = mapID, x, y, facing
        ns.Wake()
    end
    local artMode = art and AzerothLiveMapDB.art
    local lanes = LaneCount(artMode)
    local now = GetTime()
    local bytes = ns.Encode(mapID, x, y, facing, sequence, now * 1000, lanes, ns.QuestSession, artMode)
    local packets = { bytes }
    if ns.QuestiePacket and lanes == 0 then
        auxiliary = not auxiliary
        if auxiliary then bytes = AuxiliaryPacket(mapID, x, y, sequence, now) end
    end
    for lane = 1, lanes do
        sequence = (sequence + 1) % 65536
        local packet = AuxiliaryPacket(mapID, x, y, sequence, now)
        packets[#packets + 1] = packet
        if not artMode then PaintPacket(questFrames[lane].cells, packet) end
    end
    if artMode then ns.Timed("Draw", art.Render, art, packets, now) else ns.Timed("Draw", PaintPacket, cells, bytes) end
end

-- /daui cpu: time each part of the addon for a few seconds, then report the
-- average cost. Nothing is timed outside a sample.
local PROFILE_NAMES = { Update = "Total (sync loop)", Draw = "Drawing the strip/sprite", QuestiePacket = "Questie quest pins",
    NativeQuestPacket = "WoW Forever quest pins", QuestLogPacket = "Quest log", CharacterPacket = "Character",
    BagPacket = "Bags", BankPacket = "Bank", GuildPacket = "Guild roster", MapDataPacket = "Map layout",
    GuildBackground = "Guild (background timer)" }
local function ProfileCPU(seconds)
    if ns.Profile then Tell("A CPU sample is already running."); return end
    if not debugprofilestop or not C_Timer then Tell("CPU timing is not available in this client."); return end
    ns.Profile = {}
    local started = debugprofilestop()
    Tell(("Measuring addon CPU for %d seconds. Play normally."):format(seconds))
    C_Timer.After(seconds, function()
        local profile, elapsed = ns.Profile, (debugprofilestop() - started) / 1000
        ns.Profile = nil
        local rows = {}
        for name, ms in pairs(profile) do rows[#rows + 1] = { PROFILE_NAMES[name] or name, ms / elapsed, name } end
        table.sort(rows, function(a, b) return a[2] > b[2] end)
        local total = (profile.Update or 0) + (profile.GuildBackground or 0)
        Tell(("Addon CPU: %.2f ms per second, about %.2f%% of one CPU core."):format(total / elapsed, total / elapsed / 10))
        for _, row in ipairs(rows) do
            if row[3] ~= "Update" then print(("   %s: %.2f ms/s"):format(row[1], row[2])) end
        end
    end)
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
frame:RegisterEvent("UPDATE_INVENTORY_DURABILITY")
frame:RegisterEvent("PLAYER_LEVEL_UP")
-- Character stats: only the player's own unit events.
local characterEvents = { UNIT_STATS = true, UNIT_MAXHEALTH = true, UNIT_MAXPOWER = true, UNIT_DISPLAYPOWER = true, UNIT_RESISTANCES = true, UNIT_INVENTORY_CHANGED = true }
for event in pairs(characterEvents) do
    if frame.RegisterUnitEvent then frame:RegisterUnitEvent(event, "player") else frame:RegisterEvent(event) end
end
local bankEvents = { BANKFRAME_OPENED = true, BANKFRAME_CLOSED = true, BANK_TABS_CHANGED = true, BANK_TAB_SETTINGS_UPDATED = true,
    PLAYERBANKSLOTS_CHANGED = true, PLAYER_ACCOUNT_BANK_TAB_SLOTS_CHANGED = true, BAG_CONTAINER_UPDATE = true }
for event in pairs(bankEvents) do frame:RegisterEvent(event) end
frame:SetScript("OnEvent", function(_, event, unit)
    if characterEvents[event] or event == "UPDATE_INVENTORY_DURABILITY" or event == "PLAYER_LEVEL_UP" then
        if (not characterEvents[event] or unit == "player") and ns.InvalidateCharacter then ns.InvalidateCharacter() end
        return
    end
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
        if event ~= "BAG_UPDATE_DELAYED" and ns.InvalidateCharacter then ns.InvalidateCharacter() end
        return
    end
    if event == "PLAYER_REGEN_ENABLED" then
        if pendingMinimap ~= nil then ApplyMinimap(pendingMinimap, true) end
        return
    end
    if event == "PLAYER_LOGIN" then
        AzerothLiveMapDB = type(AzerothLiveMapDB) == "table" and AzerothLiveMapDB or {}
        local db = AzerothLiveMapDB
        if db.units ~= "px" then
            -- Saved values from 1.0.3 and older are in UI units; Layout converts them.
            db.units = (db.x ~= nil or db.y ~= nil or db.size ~= nil) and "ui" or "px"
        end
        if type(db.enabled) ~= "boolean" then db.enabled = true end
        if type(db.fastSync) ~= "boolean" then db.fastSync = true end
        if type(db.art) ~= "boolean" then db.art = true end
        if type(db.hideMinimap) ~= "boolean" then db.hideMinimap = nil end
        -- Leave other minimap customization alone until the user opts in.
        if db.hideMinimap then ApplyMinimap(true, false) end
        -- Never unexpectedly intercept clicks after a reload or a new login.
        db.locked = true
        Tell("Position and quest sync ready. /daui art on for the sprite, /daui art off for the regular strip. /daui unlock to move, /daui lock when finished.")
    end
    if dragging then
        dragging = false; frame:StopMovingOrSizing(); SavePosition(true)
    end
    if AzerothLiveMapDB then ns.Wake(10); Layout(); Update() end
end)
frame:SetScript("OnUpdate", function(_, dt)
    if not AzerothLiveMapDB then return end
    local interval = AzerothLiveMapDB.fastSync and 0.05 or 0.1
    elapsed = elapsed + dt
    if elapsed + 0.000001 >= interval and AzerothLiveMapDB.adaptive ~= false then
        local now = GetTime()
        if IsPlayerMoving and IsPlayerMoving() then ns.Wake()
        elseif not ns.IsBusy(now) then interval = IDLE_INTERVAL end
    end
    if elapsed + 0.000001 >= interval then
        -- Preserve fractional frame time, but never emit catch-up packets that
        -- the desktop cannot see after a slow game frame or a loading pause.
        elapsed = elapsed % interval
        if elapsed < 0.000001 or interval - elapsed < 0.000001 then elapsed = 0 end
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
        Tell("Drag the handle to move the sprite or strip. Use /alm lock when finished.")
    elseif command == "lock" then
        SavePosition(); AzerothLiveMapDB.locked = true; Layout()
        Tell("Strip locked. Clicks pass through to the game.")
    elseif command == "reset" then
        AzerothLiveMapDB.size, AzerothLiveMapDB.x, AzerothLiveMapDB.y = nil, 12, 12
        AzerothLiveMapDB.enabled, AzerothLiveMapDB.locked = true, true
        Layout(); Tell("Strip reset to the top-left corner at the default size.")
    elseif command == "sync" and (arg == "fast" or arg == "compact") then
        AzerothLiveMapDB.fastSync = arg == "fast"
        Layout(); Update()
        Tell(AzerothLiveMapDB.fastSync and "Fast sync: 20 updates/sec, four data packets alongside your position (up to 80 packets/sec)." or "Compact sync: 10 updates/sec with fewer data packets; all-zone quests take longer to arrive.")
    elseif command == "art" and (arg == "on" or arg == "off") then
        SetArtMode(arg == "on")
    elseif command == "minimap" and (arg == "hide" or arg == "show") then
        AzerothLiveMapDB.hideMinimap = arg == "hide"
        ApplyMinimap(AzerothLiveMapDB.hideMinimap, true)
    elseif command == "guild" and arg == "status" then
        Tell(ns.GuildProfessionStatus())
    elseif command == "guild" and (arg == "on" or arg == "off") then
        ns.SetGuildSharing(arg == "on")
        Tell(arg == "on" and "Guild sharing on: your coordinates and primary professions are shared with guild members using Drunks Azeroth UI." or "Guild sharing off. Your roster remains available in the companion.")
    elseif command == "idle" and (arg == "on" or arg == "off") then
        AzerothLiveMapDB.adaptive = arg == "on"
        Tell(arg == "on" and "Adaptive sync on: full speed while you move or something changes, 2 updates/sec otherwise." or "Adaptive sync off: the strip always runs at full speed.")
    elseif command == "cpu" then
        ProfileCPU(math.max(3, math.min(60, math.floor(Number(arg, 10)))))
    elseif command == "size" and Number(arg, nil) then
        local width = ScreenSize()
        AzerothLiveMapDB.size = ClampSize(arg, width); Layout()
        Tell("Each bit is " .. AzerothLiveMapDB.size .. " screen pixels; the data block is " .. frame:GetWidth() .. " x " .. frame:GetHeight() .. ". Smallest for this screen: " .. MinimumSize(width) .. ". If the companion loses the signal, try a larger size.")
    else
        Tell("/alm cpu [seconds] · /alm idle on|off · /alm guild on|off|status · /alm minimap hide|show · /alm art on|off · /alm size <pixels> (2–24) · /alm sync fast|compact · /alm unlock · /alm lock · /alm reset · /alm show · /alm hide. Keep the full artwork/data block visible while sharing WoW.")
    end
end
