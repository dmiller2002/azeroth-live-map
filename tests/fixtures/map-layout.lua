-- Synthetic rectangles deliberately differ from the old traced artwork.
mapFixture = {
    [946] = {parentMapID=0,mapType=0,rect={0,1,0,1}},
    [947] = {parentMapID=946,mapType=1,rect={.4,.9,.2,.8}},
    [1415] = {parentMapID=947,mapType=2,rect={.65,.95,.1,.9}},
    [1429] = {parentMapID=1415,mapType=3,rect={.4,.6,.7,.9}},
    [1453] = {parentMapID=1429,mapType=3,rect={.1,.3,.2,.4}},
    [1436] = {parentMapID=1415,mapType=3,rect={.2,.4,.75,.95}},
    [3000] = {parentMapID=1429,mapType=3,rect={-.2,.4,.1,.7}},
}
C_Map = {
    GetMapInfo=function(id)return mapFixture[id]end,
    GetMapRectOnMap=function(id,parent)
        local info=mapFixture[id]
        if info and info.parentMapID==parent then return unpack(info.rect) end
    end,
    GetMapChildrenInfo=function()return {{mapID=3000,mapType=3}}end,
}
