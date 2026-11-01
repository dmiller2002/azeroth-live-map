-- Synthetic inventory for protocol and browser checks; never used as live data.
bagFixture = {
    sizes = {[0]=16,[1]=16,[2]=0,[3]=12,[4]=20},
    bagIDs = {[1]=21841,[3]=2101,[4]=22251},
    names = {[0]="Backpack",[1]="Netherweave Bag",[3]="Light Quiver",[4]="Cenarion Herb Bag"},
    slots = {
        [0]={[1]={6948,1},[2]={13446,12},[3]={27854,20},[4]={2589,17},[5]={22829,5},[6]={12345,1}},
        [1]={[1]={21877,20},[2]={23424,14},[3]={22573,8}},
        [2]={},[3]={[1]={2512,200},[2]={2512,181}},[4]={[1]={22785,12},[2]={22786,7}},
    },
    items = {
        [6948]={"Hearthstone",1,1},[13446]={"Major Healing Potion",1,55},[27854]={"Smoked Talbuk Venison",1,65},
        [2589]={"Linen Cloth",1,5},[22829]={"Super Healing Potion",1,65},[12345]={"Étoffe de l’aventurier",2,62},
        [21877]={"Netherweave Cloth",1,60},[23424]={"Fel Iron Ore",1,60},[22573]={"Mote of Earth",1,65},
        [2512]={"Rough Arrow",1,5},[22785]={"Felweed",1,60},[22786]={"Dreaming Glory",1,60},
        [21841]={"Netherweave Bag",2,60},[2101]={"Light Quiver",1,1},[22251]={"Cenarion Herb Bag",3,60},
        [4496]={"Small Brown Pouch",1,5},
    },
}
local oldItemInfo,oldInventory=GetItemInfo,GetInventoryItemID
GetItemInfo=function(item)
    local id=tonumber(item) or tonumber(item:match("item:(%d+)"))
    local data=bagFixture.items[id]
    if data then return data[1],"item:"..id,data[2],data[3] end
    if oldItemInfo then return oldItemInfo(item) end
end
GetInventoryItemID=function(unit,slot)
    if slot>=20 and slot<=23 then return bagFixture.bagIDs[slot-19] end
    if oldInventory then return oldInventory(unit,slot) end
end
C_Container={
    GetContainerNumSlots=function(bag)return bagFixture.sizes[bag] or 0 end,
    ContainerIDToInventoryID=function(bag)return 19+bag end,
    GetBagName=function(bag)return bagFixture.names[bag] end,
    GetContainerItemID=function(bag,slot)local data=bagFixture.slots[bag][slot];return data and data[1] end,
    GetContainerItemInfo=function(bag,slot)
        local data=bagFixture.slots[bag][slot]
        if data then return {itemID=data[1],stackCount=data[2],quality=bagFixture.items[data[1]] and bagFixture.items[data[1]][2],hyperlink="item:"..data[1]} end
    end,
}
