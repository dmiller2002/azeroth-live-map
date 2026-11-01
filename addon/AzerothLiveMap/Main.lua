local _, ns = ...
local frame = CreateFrame("Frame", "AzerothLiveMapStrip", UIParent)
frame:SetFrameStrata("TOOLTIP")
frame:EnableMouse(false)
local background = frame:CreateTexture(nil, "BACKGROUND")
background:SetAllPoints()
background:SetColorTexture(0, 0, 0, 1)
local cells, sequence, elapsed = {}, 0, 0
for row = 1, 6 do
    cells[row] = {}
    for col = 1, 48 do
        local t = frame:CreateTexture(nil, "ARTWORK")
        t:SetColorTexture(0, 0, 0, 1)
        cells[row][col] = t
    end
end

local function Layout()
    local db = AzerothLiveMapDB
    frame:SetScale(1 / UIParent:GetEffectiveScale())
    frame:SetSize(ns.COLUMNS * db.size, ns.ROWS * db.size)
    frame:ClearAllPoints()
    frame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 12, -12)
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
    frame:SetShown(db.enabled)
end

local function Update()
    local mapID = C_Map.GetBestMapForUnit("player")
    local position = mapID and C_Map.GetPlayerMapPosition(mapID, "player")
    local x, y
    if position then x, y = position:GetXY() end
    -- (0,0) is a common unavailable-position sentinel.
    if x == 0 and y == 0 then x, y = nil, nil end
    sequence = (sequence + 1) % 65536
    local bytes = ns.Encode(mapID, x, y, GetPlayerFacing(), sequence, GetTime() * 1000)
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
        db.size = math.max(4, math.min(12, tonumber(db.size) or 6))
        if db.enabled == nil then db.enabled = true end
        print("|cff67d9baAzeroth Live Map:|r Position strip ready. Open the browser map and choose Connect WoW. /alm for help.")
    end
    if AzerothLiveMapDB then Layout(); Update() end
end)
frame:SetScript("OnUpdate", function(_, dt)
    elapsed = elapsed + dt
    if elapsed >= 0.1 and AzerothLiveMapDB then elapsed = 0; Update() end
end)
SLASH_AZEROTHLIVEMAP1 = "/alm"
SlashCmdList.AZEROTHLIVEMAP = function(message)
    local command, arg = message:match("^(%S*)%s*(.-)$")
    command = command:lower()
    if command == "show" then AzerothLiveMapDB.enabled = true; Layout()
    elseif command == "hide" then AzerothLiveMapDB.enabled = false; Layout()
    elseif command == "size" and tonumber(arg) then
        AzerothLiveMapDB.size = math.max(4, math.min(12, math.floor(tonumber(arg)))); Layout()
    else
        print("|cff67d9baAzeroth Live Map|r /alm show · /alm hide · /alm size 6 (4–12). Keep the strip visible while sharing WoW with your browser.")
    end
end
