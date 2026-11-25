local _, ns = ...

-- Forever uses Retail's project ID. Detect the client by its interface version.
local interface = GetBuildInfo and select(4, GetBuildInfo()) or 0
ns.IsForever = interface >= 16000 and interface < 17000

function ns.IsReadable(value)
    return not (issecretvalue and issecretvalue(value))
end

function ns.PlayerPosition()
    local ok, map, x, y, facing = pcall(function()
        if not C_Map or not C_Map.GetBestMapForUnit or not C_Map.GetPlayerMapPosition then return end
        local map = C_Map.GetBestMapForUnit("player")
        if not ns.IsReadable(map) or type(map) ~= "number" then return end
        local pos = C_Map.GetPlayerMapPosition(map, "player")
        if not ns.IsReadable(pos) or not pos then return map end
        local x, y = pos:GetXY()
        if not ns.IsReadable(x) or not ns.IsReadable(y) or type(x) ~= "number" or type(y) ~= "number"
            or x < 0 or x > 1 or y < 0 or y > 1 or (x == 0 and y == 0) then return map end
        local facing = GetPlayerFacing and GetPlayerFacing()
        if not ns.IsReadable(facing) then facing = nil end
        return map, x, y, facing
    end)
    if ok then return map, x, y, facing end
end

-- Adaptive sync. The strip runs at full speed while the player moves, right
-- after a game event, and while any feed still has changed records to send;
-- otherwise it idles at a slow heartbeat (the companion only needs a position
-- every 2.5 s and each feed every 6 s to stay live). ns.pending holds one
-- function per feed that returns true while that feed has changes queued.
ns.pending = {}
local activeUntil = 0
function ns.Wake(seconds)
    local now = GetTime and GetTime() or 0
    if now + (seconds or 2) > activeUntil then activeUntil = now + (seconds or 2) end
end
function ns.IsBusy(now)
    if now < activeUntil then return true end
    for _, pending in ipairs(ns.pending) do
        if pending() then return true end
    end
    return false
end

-- Refresh scheduling. Feeds rescan soon after a relevant game event (no more
-- often than minGap seconds) and otherwise only every maxGap seconds, instead
-- of rescanning unchanged bags, quests and rosters every second or two.
function ns.Schedule(minGap, maxGap)
    local schedule = { dirty = true, last = -math.huge }
    function schedule:Due(now)
        if (self.dirty and now - self.last >= minGap) or now - self.last >= maxGap then
            self.dirty, self.last = false, now
            return true
        end
        return false
    end
    function schedule:Invalidate() self.dirty = true; ns.Wake() end
    return schedule
end

-- /daui cpu: optional timing of each feed, collected only while sampling.
ns.Profile = nil
function ns.Timed(name, fn, ...)
    local profile = ns.Profile
    if not profile or not debugprofilestop then return fn(...) end
    local start = debugprofilestop()
    local a, b, c, d = fn(...)
    profile[name] = (profile[name] or 0) + debugprofilestop() - start
    return a, b, c, d
end
