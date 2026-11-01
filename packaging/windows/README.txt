AZEROTH LIVE MAP - WINDOWS SETUP
===============================

This ZIP includes the WoW addon and its browser map companion. Copy the ZIP
to your Windows computer, right-click it, choose Extract All, and open the
extracted folder. Keep this README and START-MAP.cmd together with the
AzerothLiveMap and Companion folders.

The map and WoW must run on the SAME computer. A second monitor is optional.
This package does not stream your character's location to a different PC.

REQUIREMENTS
------------
- World of Warcraft Anniversary. This addon targets the project's installed
  2.5.6.70577 client (Interface 20506). Its TOC also declares Classic Era
  Interface 11509; Classic Era has not been verified in-game. Retail and
  other client versions are not validated by this package.
- For the companion map: Python 3.10 or newer and Chrome or Microsoft Edge.
  Python is not needed if you only want to install the in-game addon.
- Internet access for map artwork, which is fetched from Wowhead.

1. INSTALL THE ADDON
-------------------
1) Close WoW completely.
2) Find the World of Warcraft installation used by your Anniversary game.
   In Battle.net, select that game version and use the options menu beside
   Play to open its installation folder (usually "Show in Explorer").
3) Open _anniversary_\Interface\AddOns inside the game installation.
   If Interface or AddOns is missing, create it in _anniversary_.
   Example only; your drive and installation directory may be different:
   C:\Program Files (x86)\World of Warcraft\_anniversary_\Interface\AddOns\
4) Copy the extracted AzerothLiveMap folder into AddOns.
   If replacing an older copy, first move that old AzerothLiveMap folder
   somewhere outside AddOns as a backup, then copy the new folder.
5) Check the result. These files must be directly inside AzerothLiveMap:

   ...\Interface\AddOns\AzerothLiveMap\AzerothLiveMap.toc
   ...\Interface\AddOns\AzerothLiveMap\Protocol.lua
   ...\Interface\AddOns\AzerothLiveMap\Questie.lua
   ...\Interface\AddOns\AzerothLiveMap\Elephant.lua
   ...\Interface\AddOns\AzerothLiveMap\Art.lua
   ...\Interface\AddOns\AzerothLiveMap\Elephant.tga
   ...\Interface\AddOns\AzerothLiveMap\Main.lua

   Do not copy the whole Windows package into AddOns, and do not leave an
   extra AzerothLiveMap folder between AddOns and those seven files.
6) Start WoW. At character selection, open AddOns and enable Azeroth Live
   Map for your character. Log in, then type /alm show in game chat.
   A small black-and-white strip should appear near the upper-left corner.

2. OPEN THE COMPANION MAP
------------------------
1) Install Python 3.10 or newer if it is not already installed:
   https://www.python.org/downloads/windows/
   Follow the official Windows instructions:
   https://docs.python.org/3/using/windows.html
   If using the Python install manager, complete its runtime setup. If using
   a traditional installer, select its option to add Python to PATH.
2) Keep the extracted Windows package in a permanent location, such as
   Documents\AzerothLiveMap. The Companion folder stays here, outside AddOns.
3) Double-click START-MAP.cmd. Leave its command window open while playing.
   Wait until it displays: Azeroth Live Map: http://localhost:8765
4) Open Chrome or Edge and enter this address:

   http://localhost:8765/

   Open this address, rather than double-clicking Companion\dist\index.html.
   You do not need a ChatGPT account or access to the original hosted site.
5) Move the browser window to your second monitor if you have one.
6) Click Connect WoW. In the browser sharing prompt, select the WoW window
   or the screen containing WoW. Keep the position strip visible in the
   source you share. If sharing a browser tab is offered, choose a window
   or screen instead.
7) Return to WoW and move your character. The map should report a live
   connection and update your location. Choose an outdoor zone first.

For each new session, start START-MAP.cmd, open the local address, and choose
Connect WoW again. To stop, end sharing in the browser and close the map tab;
in the command window, press Ctrl+C, then close the window. Nothing is added
to Windows startup. The local server listens only on this computer.

3. POSITION STRIP COMMANDS (TYPE IN WOW CHAT)
-------------------------------------------
/alm             Show command help.
/alm show        Show the strip.
/alm hide        Hide it; live tracking will stop.
/alm size 2      Smallest artwork: 100 x 136 pixels, including locator.
/alm art on      Animated pink elephant (default).
/alm art off     Plain strip: 100 x 80 fast, or 100 x 16 compact at size 2.
/alm sync fast   Four quest packets per update (default).
/alm sync compact Fewer quest packets; slower all-zone sync.
/alm size 3      Slightly larger strip if capture scaling makes it hard to read.
/alm size 4      Larger artwork: 200 x 272; plain fast is 200 x 160.
/alm unlock      Show the drag handle and allow moving the strip.
/alm lock        Hide the handle and let clicks pass through to the game.
/alm reset       Restore size 2 at the top-left corner and lock the block.

The strip saves its position and locks again after login or /reload.

QUESTIE OVERLAY
--------------
Enable Questie alongside Azeroth Live Map 0.5.0. Questie is optional and
must be installed separately. Update both the addon and Companion folder
from this package, then /reload in WoW and refresh the browser map.

Enable Questie markers in the map controls. Pickups (!), objective diamonds,
and turn-in locations (?) sync across all Questie-generated zones. Hover
pins for titles and objective counts; select a sidebar quest to highlight
its locations. Questie's map filters apply even when its map is closed.

Keep the entire elephant and its short locator line visible. Use /alm art off
for the plain strip if game color settings affect capture. The elephant
requires the updated companion from this package. Preview it by opening
elephant-preview.html through the local server. Colored pixels within the elephant carry the data. Fast mode sends up to 40 quest
packets per second, versus 2.5 in addon 0.3.0. Pins and names arrive
progressively; the sidebar shows overall pins, zones, names, and observed
packet rate. Browse another zone to see its received quests without moving
your character there. Questie's character/map filters still apply.

The former 96-pin and four-spawn sampling limits are removed. Questie is
sampled every two seconds; changed quests replace only their affected zone.
All-zone data stays in browser memory while changing zones, and clears on
disconnect or a new addon session. Stale capture hides the pins. Initial sync
time depends on total pins/titles and delivered capture frames. Live gameplay,
performance, and alignment still need checking on your PC.

MAP NAVIGATION
--------------
Right-click the map to go up from a city to its zone, continent, and world.
Left-click an area on an overview to open its map; hover to see its name.
The small arrow buttons on zone maps open their cities. Drag to pan; the
wheel and +/- buttons magnify the artwork. Up and the map path also navigate.
Browsing switches off Follow my zone. Enable it to return to your character.

TROUBLESHOOTING
---------------
- Addon is missing: check the exact folder layout above and make sure you
  installed it for the game version you actually launch. Restart WoW.
- Addon is out of date: compare your game version with the target above.
  Loading an outdated addon does not guarantee compatibility with a new patch.
- Launcher reports Python missing: complete Python installation, then try
  again. In a new Command Prompt, "py -3 --version" or "python --version"
  should report Python 3.10 or newer.
- Launcher reports missing files: extract the entire ZIP before launching.
  Keep START-MAP.cmd next to Companion, with its dist and scripts subfolders.
- Port 8765 is already in use: if an earlier map command window is still
  running, use it or close it before restarting. For a different port, open
  Command Prompt in the extracted package folder and run:
  py -3 "Companion\scripts\serve.py" --port 8767
  Then open http://localhost:8767/ in Chrome or Edge. If you use the python
  command instead of py, replace "py -3" with "python".
- Page cannot be reached: keep the launcher window open and check its error
  text. This package serves the map on localhost, not on your network address.
- Sharing was canceled: choose Connect WoW again and select the game window
  or screen. The browser requires your permission for each capture session.
- Searching for the strip: use /alm show and /alm size 4. Keep the strip
  unobstructed. Try "Select position strip manually" and select the entire
  strip, including its black border. If the captured game is black, try
  windowed/borderless mode and share the monitor containing WoW.
- Frozen location: keep WoW visible and rendered. Minimizing WoW, hiding its
  entire UI, covering the strip, or stopping sharing can interrupt tracking.
- No map artwork: allow internet access to wow.zamimg.com. Artwork is not
  bundled, so this is not a fully offline map.
- Unsupported map or no position: dungeon interiors and some map types are
  not included; return to a supported outdoor zone. Demo mode shows
  simulated movement, not your real character.
- Questie markers missing: enable Questie and the updated companion addon,
  /reload, reconnect screen sharing, and check Questie's map filters. The
  sidebar reports missing/incompatible Questie or progress while syncing.

REMOVAL
-------
Close WoW, then remove only Interface\AddOns\AzerothLiveMap. Stop the local
server and delete the extracted Windows package when you no longer need it.
WoW may retain saved addon preferences in its WTF folder.

STATUS AND CREDITS
------------------
This is a prototype. Live capture, map alignment, zone transitions, and
native Windows launcher behavior still need testing on your Windows PC.
The addon emits coordinates through visible pixels; the companion reads
them using browser screen sharing. This app does not upload screen frames
or coordinates and does not automate gameplay or read game process memory.

World of Warcraft and its map artwork belong to Blizzard Entertainment.
Map artwork is served by Wowhead; no artwork redistribution license or
Blizzard approval is claimed.

Screen-sharing permission documentation:
https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
