-- Synthetic native Forever bank. No game storage is accessed or modified.
bankFixture={open=false,types={
    [0]={{ID=20,name="Supplies"},{ID=21,name="Spare gear"}},
    [2]={{ID=30,name="Shared materials"}},
},sizes={[20]=98,[21]=16,[30]=98},slots={
    [20]={[1]={2589,20},[98]={13446,12}},[21]={[3]={6948,1}},[30]={[97]={2589,55}},
}}
Enum={BankType={Character=0,Account=2}}
C_Bank={
    CanViewBank=function()return bankFixture.open end,
    CanUseBank=function()return bankFixture.open end,
    FetchPurchasedBankTabData=function(bankType)
        assert(bankFixture.open,"Never read bank items while closed")
        return bankFixture.types[bankType]
    end,
    PurchaseBankTab=function()error("Never purchase bank tabs")end,
    UpdateBankTabSettings=function()error("Never change bank settings")end,
}
local sizes,info,itemID=C_Container.GetContainerNumSlots,C_Container.GetContainerItemInfo,C_Container.GetContainerItemID
C_Container.GetContainerNumSlots=function(bag)
    if bankFixture.sizes[bag] then assert(bankFixture.open);return bankFixture.sizes[bag]end
    return sizes(bag)
end
C_Container.GetContainerItemInfo=function(bag,slot)
    if bankFixture.sizes[bag] then
        assert(bankFixture.open);local item=bankFixture.slots[bag][slot]
        if item then return {itemID=item[1],stackCount=item[2],quality=1}end
        return
    end
    return info(bag,slot)
end
C_Container.GetContainerItemID=function(bag,slot)
    if bankFixture.sizes[bag] then
        assert(bankFixture.open);local item=bankFixture.slots[bag][slot];return item and item[1]
    end
    return itemID(bag,slot)
end
C_Container.PickupContainerItem=function()error("Never move bank items")end
