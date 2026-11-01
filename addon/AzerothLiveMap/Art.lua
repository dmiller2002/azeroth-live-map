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

    function result:Render(packets, now)
        local length = 0
        for _, duration in ipairs(asset.durations) do length = length + duration end
        local tick = math.floor(now*10)%length
        local frameIndex = 1
        for i, duration in ipairs(asset.durations) do
            if tick < duration then frameIndex = i; break end
            tick = tick-duration
        end
        sprite:SetTexCoord((frameIndex-1)*64/512,((frameIndex-1)*64+asset.width)/512,0,1)
        local colors = asset.frames[frameIndex]
        for i, position in ipairs(asset.positions) do
            local texture, packet = pixels[i], packets[math.floor((i-1)/192)+1]
            texture:SetShown(packet ~= nil)
            if packet then
                local color = asset.palette[colors[position+1]+1]
                local bit = ns.Bit(packet,(i-1)%192)
                texture:SetColorTexture((color[1]+(bit == 1 and asset.delta or -asset.delta))/255,color[2]/255,color[3]/255,1)
            end
        end
    end
    return result
end
