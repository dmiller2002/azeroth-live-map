local _, ns = ...
ns.HEADER = { 211, 145, 166, 92, 240, 43 }
ns.COLUMNS, ns.ROWS = 50, 8

-- 24 bytes, big endian. Monochrome bits survive gamma and color correction.
-- Magic/version/flags, sequence:u16, map:u16, x:u16, y:u16,
-- facing:u16, monotonicMilliseconds:u32, questLanes:u8, questSession:u16,
-- artMarker:u8, artEncoding:u8, Fletcher16. Older position decoders ignore
-- these fields. Art encoding 0 is red-only (0.5.0), 1 is brightness (0.5.1).
local function put16(bytes, n)
    n = math.floor(n) % 65536
    bytes[#bytes + 1] = math.floor(n / 256)
    bytes[#bytes + 1] = n % 256
end

function ns.Encode(mapID, x, y, facing, sequence, milliseconds, questLanes, questSession, artMode)
    local valid = type(mapID) == "number" and type(x) == "number" and type(y) == "number"
        and mapID > 0 and mapID <= 65535 and x >= 0 and x <= 1 and y >= 0 and y <= 1
    local hasFacing = valid and type(facing) == "number"
    local bytes = { 167, 1, (valid and 1 or 0) + (hasFacing and 2 or 0) }
    put16(bytes, sequence)
    put16(bytes, valid and mapID or 0)
    put16(bytes, valid and math.floor(x * 65535 + 0.5) or 0)
    put16(bytes, valid and math.floor(y * 65535 + 0.5) or 0)
    put16(bytes, hasFacing and math.floor((facing % (2 * math.pi)) / (2 * math.pi) * 65535 + 0.5) or 0)
    milliseconds = math.floor(milliseconds) % 4294967296
    put16(bytes, math.floor(milliseconds / 65536))
    put16(bytes, milliseconds % 65536)
    bytes[#bytes + 1] = questLanes or 0
    put16(bytes, questSession or 0)
    bytes[#bytes + 1] = artMode and 225 or 0
    bytes[#bytes + 1] = artMode and 1 or 0
    local a, b = 0, 0
    for i = 1, #bytes do a = (a + bytes[i]) % 255; b = (b + a) % 255 end
    bytes[#bytes + 1], bytes[#bytes + 2] = a, b
    return bytes
end

-- Every bit of every byte value, precomputed: the strip reads up to ~19,000
-- bits a second, so a table lookup replaces a power, division and floor each.
local BITS = {}
for byte = 0, 255 do
    for position = 0, 7 do BITS[byte * 8 + position] = math.floor(byte / 2 ^ (7 - position)) % 2 end
end
function ns.Bit(bytes, index)
    local position = index % 8
    return BITS[bytes[(index - position) / 8 + 1] * 8 + position]
end

-- Auxiliary packets share the same 24-byte rectangle as v1 positions.
-- v2: magic/version/type, sequence:u16, map:u16, generation:u16,
-- index:u16, payload:11 bytes, Fletcher16. Positions remain v1-compatible.
-- v3 kind 0/1: independent zone metadata/pins (up to 65535 per zone).
-- v3 kind 2: map/index encode the 24-bit quest ID; text is shared globally.
-- v3 kind 3: global status, zone count, pin total, and addon session epoch.
-- v8: same layout as v3; marker byte 18 packs kind + Questie icon ID * 4.
-- v9: quest-log stable slots; quest ID 0 deletes a slot; epochs identify a quest.
-- v10: stable Questie pin slots with per-pin revisions; kind 4 deletes one pin.
function ns.EncodeQuest(kind, sequence, mapID, generation, index, payload, version)
    local bytes = { 167, version or 2, kind }
    for _, n in ipairs({ sequence, mapID or 0, generation, index }) do
        n = math.floor(n) % 65536
        bytes[#bytes + 1] = math.floor(n / 256)
        bytes[#bytes + 1] = n % 256
    end
    for i = 1, 11 do bytes[#bytes + 1] = payload[i] or 0 end
    local a, b = 0, 0
    for i = 1, #bytes do a = (a + bytes[i]) % 255; b = (b + a) % 255 end
    bytes[#bytes + 1], bytes[#bytes + 2] = a, b
    return bytes
end
