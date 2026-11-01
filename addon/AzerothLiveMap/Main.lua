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
for row = 1, 6 do
    cells[row] = {}
    for col = 1, 48 do
        local t = frame:CreateTexture(nil, "ARTWORK")
        t:SetColorTexture(0, 0, 0, 1)
        cells[row][col] = t
    end
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
    print("|cff67d9baAzeroth Live Map:|r " .. text)
end

local function Layout()
    local db = AzerothLiveMapDB
    local width, height = ScreenSize()
    db.size = math.max(2, math.min(12, math.floor(Number(db.size, 2))))
    local stripWidth, stripHeight = ns.COLUMNS * db.size, ns.ROWS * db.size
    -- Stored offsets are physical pixels, independent of the game's UI scale.
    db.x = math.floor(math.max(0, math.min(math.max(0, width - stripWidth), Number(db.x, 12))) + 0.5)
    db.y = math.floor(math.max(0, math.min(math.max(0, height - stripHeight), Number(db.y, 12))) + 0.5)
    frame:SetScale(1 / UIParent:GetEffectiveScale())
    frame:SetSize(stripWidth, stripHeight)
    frame:ClearAllPoints()
    frame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", db.x, -db.y)
    for row = 1, 6 do
        for col = 1, 48 do
            local t = cells[row][col]
            t:SetSize(db.size, db.size)
            t:ClearAllPoints()
            t:SetPoint("TOPLEFT", frame, "TOPLEFT", col * db.size, -row * db.size)
            if row <= 2 then
                local v = ns.Bit(ns.HEADER, col - 1)
                if row == 2 then v = 1 - v end
                t:SetColorTexture(v, v, v, 1)
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
    local bytes = ns.Encode(mapID, x, y, GetPlayerFacing(), sequence, GetTime() * 1000)
    if ns.QuestiePacket then
        auxiliary = not auxiliary
        if auxiliary then bytes = ns.QuestiePacket(mapID, x, y, sequence, GetTime()) end
    end
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
frame:SetScript("OnEvent", function(_, event)
    if event == "PLAYER_LOGIN" then
        AzerothLiveMapDB = type(AzerothLiveMapDB) == "table" and AzerothLiveMapDB or {}
        local db = AzerothLiveMapDB
        db.size = math.max(2, math.min(12, math.floor(Number(db.size, 2))))
        if type(db.enabled) ~= "boolean" then db.enabled = true end
        -- Never unexpectedly intercept clicks after a reload or a new login.
        db.locked = true
        Tell("Position strip ready. /alm size 2 for tiny, /alm unlock to move, /alm lock when finished.")
    end
    if dragging then dragging = false; frame:StopMovingOrSizing() end
    if AzerothLiveMapDB then Layout(); Update() end
end)
frame:SetScript("OnUpdate", function(_, dt)
    elapsed = elapsed + dt
    if elapsed >= (ns.QuestiePacket and 0.2 or 0.1) and AzerothLiveMapDB then elapsed = 0; Update() end
end)
SLASH_AZEROTHLIVEMAP1 = "/alm"
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
        Layout(); Tell("Strip reset to 100 x 16 pixels in the top-left corner.")
    elseif command == "size" and Number(arg, nil) then
        AzerothLiveMapDB.size = math.max(2, math.min(12, math.floor(Number(arg, 2)))); Layout()
        Tell("Strip size: " .. ns.COLUMNS * AzerothLiveMapDB.size .. " x " .. ns.ROWS * AzerothLiveMapDB.size .. " pixels. If sharing scales it down too far, try /alm size 3 or 4.")
    else
        Tell("/alm size 2 (2–12) · /alm unlock · /alm lock · /alm reset · /alm show · /alm hide. Keep the strip visible while sharing WoW.")
    end
end
