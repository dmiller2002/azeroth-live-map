local _, ns = ...
ns.HEADER = { 211, 145, 166, 92, 240, 43 }
ns.COLUMNS, ns.ROWS = 50, 8

-- 24 bytes, big endian. Monochrome bits survive gamma and color correction.
-- Magic/version/flags, sequence:u16, map:u16, x:u16, y:u16,
-- facing:u16, monotonicMilliseconds:u32, five reserved bytes, Fletcher16.
function ns.Encode(mapID, x, y, facing, sequence, milliseconds)
    local valid = type(mapID) == "number" and type(x) == "number" and type(y) == "number"
        and mapID > 0 and mapID <= 65535 and x >= 0 and x <= 1 and y >= 0 and y <= 1
    local hasFacing = valid and type(facing) == "number"
    local bytes = { 167, 1, (valid and 1 or 0) + (hasFacing and 2 or 0) }
    local function put16(n)
        n = math.floor(n) % 65536
        bytes[#bytes + 1] = math.floor(n / 256)
        bytes[#bytes + 1] = n % 256
    end
    put16(sequence)
    put16(valid and mapID or 0)
    put16(valid and math.floor(x * 65535 + 0.5) or 0)
    put16(valid and math.floor(y * 65535 + 0.5) or 0)
    put16(hasFacing and math.floor((facing % (2 * math.pi)) / (2 * math.pi) * 65535 + 0.5) or 0)
    milliseconds = math.floor(milliseconds) % 4294967296
    put16(math.floor(milliseconds / 65536))
    put16(milliseconds % 65536)
    for _ = 1, 5 do bytes[#bytes + 1] = 0 end
    local a, b = 0, 0
    for i = 1, #bytes do a = (a + bytes[i]) % 255; b = (b + a) % 255 end
    bytes[#bytes + 1], bytes[#bytes + 2] = a, b
    return bytes
end

function ns.Bit(bytes, index)
    return math.floor(bytes[math.floor(index / 8) + 1] / 2 ^ (7 - index % 8)) % 2
end

-- Auxiliary packets share the same 24-byte rectangle as v1 positions.
-- v2: magic/version/type, sequence:u16, map:u16, generation:u16,
-- index:u16, payload:11 bytes, Fletcher16. Positions remain v1-compatible.
function ns.EncodeQuest(kind, sequence, mapID, generation, index, payload)
    local bytes = { 167, 2, kind }
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
