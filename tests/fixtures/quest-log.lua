-- Synthetic accepted quests; the prose is original test text, not game data.
questLogFixture={selection=4,fail=false,quests={
    {id=900101,title="A Watch on the Ridge",category="Elwynn Forest",level=62,watched=true,complete=0,
        overview="Scout the ridge and recover three signal stones for Captain Élan.",
        description="The watch fires have gone dark along the ridge. Our scouts report strange lights beyond the broken towers.\n\nTake the eastern path and learn what happened. Keep your eyes on the horizon; a quiet ridge is not always an empty one.\n\nBring the signal stones back to Captain Élan at the camp.",
        objectives={{text="Ridge scouts found: 1/4",finished=false,numFulfilled=1,numRequired=4},{text="Signal stones recovered: 3/3",finished=true,numFulfilled=3,numRequired=3}}},
    {id=900102,title="A Letter for Home",category="Stormwind City",level=65,watched=false,complete=1,
        overview="Deliver the letter to Ilyra in Stormwind City.",description="The ink is dry, and the road is long. Carry this letter safely to Ilyra.\n\nTell her that we are coming home.",objectives={}},
    {id=900103,title="A Broken Promise",category="Elwynn Forest",level=64,tag="Group",watched=false,complete=-1,
        overview="Protect the messenger.",description="Meet the messenger at the crossroads before nightfall.",objectives={{text="Messenger protected",finished=false,numFulfilled=0,numRequired=1}}},
}}
local function Entry(index)
    local position=0;local category
    for _,quest in ipairs(questLogFixture.quests)do
        if quest.category~=category then
            category=quest.category;position=position+1
            if position==index then return nil,category end
        end
        position=position+1;if position==index then return quest end
    end
end
GetQuestLogTitle=function(index)
    local quest,category=Entry(index)
    if category then return category,0,nil,true,false end
    if quest then return quest.title,quest.level,quest.tag,false,false,quest.complete,0,quest.id end
end
GetQuestLogSelection=function()return questLogFixture.selection end
SelectQuestLogEntry=function(index)questLogFixture.selection=index end
GetQuestLogQuestText=function()
    if questLogFixture.fail then error("Synthetic quest text API failure")end
    local quest=Entry(questLogFixture.selection)
    if quest then return quest.description,quest.overview end
end
IsQuestWatched=function(index)local quest=Entry(index);return quest and quest.watched or false end
C_QuestLog={GetQuestObjectives=function(id)
    for _,quest in ipairs(questLogFixture.quests)do if quest.id==id then return quest.objectives end end
end}
if not UnitLevel then UnitLevel=function()return 65 end end
function questLogFixture.questie()
    local frames={}
    for i,quest in ipairs(questLogFixture.quests)do
        local name="DAUITestQuestPin"..i
        _G[name]={data={Type=quest.complete==1 and "complete"or"monster",Icon=quest.complete==1 and 8 or 1,QuestData={name=quest.title},ObjectiveIndex=1,ObjectiveData={Collected=1,Needed=4}},
            miniMapIcon=false,UiMapID=i==2 and 1453 or 1429,x=45+i,y=50+i}
        frames[quest.id]={name}
    end
    for i,iconType in ipairs({6,2,4,3,5,10,11,7,12,13,15})do
        local name="DAUITestSymbol"..i
        local kind=(iconType==6 or iconType==10 or iconType==7 or iconType==13 or iconType==15) and "available" or iconType==11 and "complete" or ({[2]="item",[4]="object",[5]="monster"})[iconType] or "event"
        _G[name]={data={Type=kind,Icon=iconType,QuestData={name="Marker example "..iconType}},miniMapIcon=false,UiMapID=1429,x=20+i*5,y=35}
        frames[910000+i]={name}
    end
    QuestieLoader={ImportModule=function(_,module)if module=="QuestieMap"then return {questIdFrames=frames}end end}
end
