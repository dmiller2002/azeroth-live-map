local _, ns = ...
local kinds = { available = 1, monster = 2, object = 2, item = 2, event = 2, complete = 3 }

local function Finite(n)
    return ns.IsReadable(n) and type(n) == "number" and n == n and n > -math.huge and n < math.huge
end
local function Count(n) return math.floor(math.max(0, math.min(255, Finite(n) and n or 0))) end

local defaultIcons = { available = 6, monster = 1, object = 4, item = 2, event = 3, complete = 8 }

local function Collect()
    if not QuestieLoader or type(QuestieLoader.ImportModule) ~= "function" then return {}, 0 end
    local map = QuestieLoader:ImportModule("QuestieMap")
    if type(map) ~= "table" or type(map.questIdFrames) ~= "table" then return {}, 2 end
    local result, seen = {}, {}
    for questID, names in pairs(map.questIdFrames) do
        if Finite(questID) and questID > 0 and questID < 16777216 and type(names) == "table" then
            for _, name in pairs(names) do
                local icon = type(name) == "string" and _G[name] or nil
                local data = icon and icon.data
                local kind, mapID = data and kinds[data.Type], icon and icon.UiMapID
                -- Read every Questie-generated world pin, regardless of the
                -- player's zone or whether the in-game map is open.
                if kind and icon.miniMapIcon == false and Finite(mapID) and mapID > 0 and mapID <= 65535
                    and Finite(icon.x) and Finite(icon.y) and icon.x >= 0 and icon.x <= 100 and icon.y >= 0 and icon.y <= 100
                    and (not icon.ShouldBeHidden or not icon:ShouldBeHidden()) then
                    local objective = data.ObjectiveData or {}
                    if not objective.Completed then
                        local x, y = math.floor(icon.x / 100 * 65535 + .5), math.floor(icon.y / 100 * 65535 + .5)
                        local index = Count(data.ObjectiveIndex)
                        -- v8/v10 pack the icon ID beside the broad kind in one byte.
                        -- Unknown/custom texture paths retain the matching type default.
                        local iconType = Finite(data.Icon) and math.floor(data.Icon) or defaultIcons[data.Type] or 0
                        if iconType < 0 or iconType > 63 then iconType = defaultIcons[data.Type] or 0 end
                        local key = table.concat({mapID, questID, kind, iconType, index, x, y}, ":")
                        if not seen[key] then
                            seen[key] = true
                            local title = data.QuestData and data.QuestData.name
                            if type(title) ~= "string" or title == "" then title = "Quest #" .. questID end
                            title = title:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("[%c]", " ")
                            if #title > 80 then
                                local cut = 81
                                while cut > 1 and title:byte(cut) >= 128 and title:byte(cut) < 192 do cut = cut - 1 end
                                title = title:sub(1, cut - 1)
                            end
                            result[mapID] = result[mapID] or {}
                            local markers = result[mapID]
                            markers[#markers + 1] = { questID = questID, kind = kind, iconType = iconType, objective = index,
                                x = x, y = y, title = title, collected = Count(objective.Collected), needed = Count(objective.Needed), key = key }
                        end
                    end
                end
            end
        end
    end
    return result, 1
end


ns.QuestiePacket = ns.CreateQuestStream(Collect, 10)
