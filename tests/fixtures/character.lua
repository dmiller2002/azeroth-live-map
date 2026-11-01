-- Synthetic character, used only in automated tests and their screenshots.
fixture = {
    name = "Éowyn", realm = "Test Realm", level = 65,
    slots = {[1] = 16914, [5] = 16865, [16] = 19019, [17] = 19349},
    items = {
        [16914] = {"Netherwind Crown", 4, 76},
        [16865] = {"Breastplate of Might", 4, 66},
        [19019] = {"Thunderfury, Blessed Blade of the Windseeker", 5, 80},
        [19349] = {"Elementium Reinforced Bulwark", 4, 77},
        [12345] = {"Équipement de l'aventurier", 2, 62},
    },
    stats = {200, 120, 180, 90, 80}, armor = 3480, health = 5420, power = 100,
}
UnitName = function() return fixture.name, fixture.realm end
GetRealmName = function() return fixture.realm end
UnitClass = function() return "Warrior", "WARRIOR", 1 end
UnitRace = function() return "Undead", "Scourge", 5 end
UnitLevel = function() return fixture.level end
UnitSex = function() return 2 end
UnitPowerType = function() return 1 end
UnitStat = function(_, index) return fixture.stats[index], fixture.stats[index], 0, 0 end
UnitArmor = function() return fixture.armor, fixture.armor end
UnitHealthMax = function() return fixture.health end
UnitPowerMax = function() return fixture.power end
GetInventoryItemID = function(_, slot) return fixture.slots[slot] end
GetInventoryItemLink = function(_, slot) return fixture.slots[slot] and "item:" .. fixture.slots[slot] end
GetInventoryItemDurability = function(slot) if fixture.slots[slot] then return 65, 80 end end
GetItemInfo = function(item)
    local id = tonumber(item) or tonumber(item:match("item:(%d+)"))
    local info = fixture.items[id]
    if info then return info[1], "item:" .. id, info[2], info[3] end
end
