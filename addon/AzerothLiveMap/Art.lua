local _, ns = ...

function ns.CreateArt(parent)
    local asset = ns.Elephant
    local art = CreateFrame("Frame", "AzerothLiveMapArt", parent)
    art:EnableMouse(false)
    local locator = CreateFrame("Frame", "AzerothLiveMapLocator", parent)
    locator:EnableMouse(false)
    -- Keep this on the parent's BACKGROUND layer. A child-frame background
    -- would cover the locator bits, which belong to the parent's ARTWORK layer.
    local background = parent:CreateTexture(nil,"BACKGROUND")
    background:SetAllPoints(locator); background:SetColorTexture(0,0,0,1)
    local sprite = art:CreateTexture(nil,"BACKGROUND")
    sprite:SetTexture([[Interface\AddOns\AzerothLiveMap\Elephant.tga]],nil,nil,"NEAREST")
    sprite:SetAllPoints()
    local pixels = {}
    for i = 1, #asset.positions do pixels[i] = art:CreateTexture(nil,"ARTWORK") end
    local result = { frame = art, locator = locator }

    function result:Layout(size, shown)
        art:SetShown(shown); locator:SetShown(shown)
        background:SetShown(shown)
        art:SetSize(asset.width*size,asset.height*size)
        art:ClearAllPoints(); art:SetPoint("TOPLEFT",parent,"TOPLEFT",0,0)
        locator:SetSize(50*size,asset.footerRows*size)
        locator:ClearAllPoints(); locator:SetPoint("TOPLEFT",parent,"TOPLEFT",0,-asset.height*size)
        for i, position in ipairs(asset.positions) do
            pixels[i]:SetSize(size,size); pixels[i]:ClearAllPoints()
            pixels[i]:SetPoint("TOPLEFT",art,"TOPLEFT",position%asset.width*size,-math.floor(position/asset.width)*size)
        end
    end

    local length = 0
    for _, duration in ipairs(asset.durations) do length = length + duration end
    local lastFrame = nil
    function result:Render(packets, now)
        local tick = math.floor(now*10)%length
        local frameIndex = 1
        for i, duration in ipairs(asset.durations) do
            if tick < duration then frameIndex = i; break end
            tick = tick-duration
        end
        if frameIndex ~= lastFrame then
            lastFrame = frameIndex
            sprite:SetTexCoord((frameIndex-1)*64/512,((frameIndex-1)*64+asset.width)/512,0,1)
        end
        local colors = asset.frames[frameIndex]
        for i, position in ipairs(asset.positions) do
            local texture, packet = pixels[i], packets[math.floor((i-1)/192)+1]
            local shown = packet ~= nil
            if texture.dauiShown ~= shown then texture.dauiShown = shown; texture:SetShown(shown) end
            if packet then
                local color = asset.palette[colors[position+1]+1]
                local bit = ns.Bit(packet,(i-1)%192)
                -- A brightness change survives NV12/YUV420 capture; red-only
                -- modulation is blurred by chroma subsampling. Reserve gamut
                -- headroom so conversion does not clip the darkest carriers.
                local delta = bit == 1 and asset.delta or -asset.delta
                local r = math.max(48,math.min(207,color[1]))+delta
                local g = math.max(48,math.min(207,color[2]))+delta
                local b = math.max(48,math.min(207,color[3]))+delta
                -- Only repaint carriers whose colour actually changed.
                local key = (r*256+g)*256+b
                if texture.dauiColor ~= key then
                    texture.dauiColor = key
                    texture:SetColorTexture(r/255,g/255,b/255,1)
                end
            end
        end
    end
    return result
end
