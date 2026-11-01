# Azeroth Live Map

A browser map for World of Warcraft Anniversary. Keep playing on one monitor and watch your position, direction, and recent trail on another. The in-game world map can stay closed.

This is a prototype. The addon targets the installed Anniversary **2.5.6.70577** client (`20506` interface); its TOC also declares Classic Era `11509`. Actual game capture, location accuracy, and zone transitions still need an in-game check on your setup. A moving marker in demo mode is simulated and does not verify the live connection.

## How it works

The `AzerothLiveMap` addon sends map, quest, and character data through an animated pink elephant near the upper-left corner of WoW. Its colored pixels carry the packets; a short black-and-white locator sits underneath. Use `/alm art off` for the original plain strip. When you select **Connect WoW** in the browser, the browser asks you to share the WoW window or the monitor containing the game. The page decodes the strip locally and updates your marker.

With **Questie** enabled, the same strip also sends quest pickups, objective locations and counts, turn-in locations, and quest titles across all zones represented by Questie’s pins for your character. Use the **Questie markers** toggle, hover a pin for details, or select a quest in the sidebar to highlight its locations. The in-game world map can stay closed.

Screen frames and coordinates are not uploaded by this app. Map artwork is fetched from Wowhead's CDN. Equipped item IDs are sent to Wowhead for optional icon lookup; character names, realms, equipment names, attributes, and captured frames stay in browser memory. The addon does not automate gameplay or read process memory; the browser uses ordinary screen capture. This implementation is not a claim of Blizzard approval.

## Install the addon

From the project folder, inspect the planned installation:

```bash
python3 scripts/install_addon.py \
  --addons-dir '/mnt/Shared/World of Warcraft/_anniversary_/Interface/AddOns' \
  --dry-run
```

Install it with:

```bash
python3 scripts/install_addon.py \
  --addons-dir '/mnt/Shared/World of Warcraft/_anniversary_/Interface/AddOns'
```

The installer copies only `addon/AzerothLiveMap` into that AddOns directory. If an `AzerothLiveMap` folder already exists, it preserves that folder under `.AzerothLiveMap-backups/<UTC timestamp>/AzerothLiveMap` before installing the replacement. It does not edit game configuration or other addons. A dry run does not create files or backups.

Alternatively, copy `addon/AzerothLiveMap` manually, or extract the downloadable `AzerothLiveMap.zip` from the map page. The resulting layout must be:

```text
Interface/AddOns/AzerothLiveMap/AzerothLiveMap.toc
Interface/AddOns/AzerothLiveMap/Protocol.lua
Interface/AddOns/AzerothLiveMap/Questie.lua
Interface/AddOns/AzerothLiveMap/Character.lua
Interface/AddOns/AzerothLiveMap/Elephant.lua
Interface/AddOns/AzerothLiveMap/Art.lua
Interface/AddOns/AzerothLiveMap/Elephant.tga
Interface/AddOns/AzerothLiveMap/Main.lua
```

Restart WoW after adding the folder, enable **Azeroth Live Map** in the character selection screen's AddOns list, and log in. Look for the black-and-white position strip near the top-left corner.

## Transfer to a Windows computer

Use [`dist/AzerothLiveMap-Windows.zip`](dist/AzerothLiveMap-Windows.zip). It contains the addon, a copy of the browser companion, a `START-MAP.cmd` launcher, and a Windows `README.txt` with installation and troubleshooting steps. Extract the entire ZIP, then follow that README. The companion requires Python 3.10 or newer and Chrome or Edge on the Windows computer; the addon itself does not require Python. WoW and the companion run on the same computer, with internet access for map artwork. The bundle does not depend on access to the private hosted site.

Rebuild the bundle from this checkout with `python3 scripts/package_windows.py`. Native Windows launching and live game capture still need verification on the destination PC.

## Open the standalone app on Linux

The standalone launcher opens the map in its own Chromium window. It uses a separate browser profile and starts its local server when needed. Python 3, Chromium or Google Chrome, and `desktop-file-validate` (from `desktop-file-utils`) are required.

Preview the installation, then install it:

```bash
python3 scripts/install_companion.py --dry-run
python3 scripts/install_companion.py
```

Open **Azeroth Live Map** from the application menu and move its window to your second monitor. Choose **Connect WoW** and approve the normal screen-sharing dialog. The app never grants itself capture access; choose the game window or game monitor again whenever you start a new capture session.

App files are installed under `~/.local/share/azeroth-live-map/`, with a dedicated profile in its `browser-profile/` folder. The installer preserves that profile and backs up replaced app files under `~/.local/share/azeroth-live-map-backups/`. It creates `~/.local/share/applications/azeroth-live-map.desktop`; it does not install the addon or change game settings.

The local address is **http://localhost:8766/**. The server serves only the app's `dist/` files on this computer, verifies its identity before the launcher opens it, and refuses to use a port occupied by an unrelated service. Closing the map window leaves the small local server running for the next launch. No startup service is installed. Startup diagnostics are saved in `~/.local/state/azeroth-live-map/server.log` and `browser.log`.

To open the standalone app directly from this checkout:

```bash
python3 scripts/companion.py
```

For development, `python3 scripts/serve.py` remains available at **http://localhost:8765**. Keep that preview terminal running and stop it with Ctrl+C. Port 8765 is separate from the installed standalone app.

The configured hosted address is **https://azeroth-live-map-dylan.spicyleaf18.chatgpt.site** (private to its owner). The local version does not depend on hosted access.

1. Leave WoW visible on your main monitor with the position strip unobstructed.
2. In the browser map, choose **Connect WoW**.
3. In the browser or desktop sharing dialog, select the **WoW window**. If window sharing is unavailable, select the **monitor containing WoW**, not the browser monitor.
4. Return focus to WoW and move your character. The map should report a live connection and update your location.
5. If the strip is not detected automatically, use the page's manual strip selection and select the whole strip, including its black border.

Chromium is the recommended first browser to test on this Linux setup. Screen sharing requires a secure browser context: use `localhost` for the local server, or HTTPS for a hosted page. Open the page directly in its own browser tab if an embedded preview blocks capture. The browser requires a fresh sharing choice when starting a new capture session.

The default skin is your **animated pink elephant**: **100 × 136 pixels** at `/alm size 2`. It blinks, bobs, and wiggles its ears; the red bow tie and transparent silhouette follow your reference. Small brightness variations within opaque sprite pixels carry one position and four quest packets per update. A short locator line underneath allows automatic discovery. Keep the entire elephant and locator visible. [Open the simulated animation preview](dist/elephant-preview.html).

`/alm art off` switches to the original monochrome transport: 100 × 80 pixels in fast mode, or 100 × 16 with `/alm sync compact`. `/alm art on` restores the elephant. Fast artwork mode retains 40 quest packets/second; compact artwork mode carries one quest packet per update (10/s). Cell sizes 2–12 remain supported, with the largest size clamped to fit the screen. Artwork is 50 × 68 cells including its locator (size 3: 150 × 204; size 4: 200 × 272). Existing cell sizes and placement are preserved where they fit.

The skin needs matching addon/companion 0.5.1 or newer. Version 0.5.0 used small red-only signals; these can disappear during NV12/YUV420 window capture even when a lossless screenshot decodes correctly. Version 0.5.1 changes brightness across all three channels, reserves color headroom to avoid clipping, and tries RGB plus BT.601/BT.709 brightness decoding. Checksums still validate every packet; failed quest packets do not invalidate position or siblings. Animation timing is unchanged: moving faster does not improve decoding. Reopen the app, type `/reload` then `/alm art on` in WoW, and reconnect. `/alm art off` remains the known plain-strip fallback. Raw decoding of older 0.5.0 sprites remains supported. Actual capture performance still depends on game rendering and scaling.

Use `/alm unlock`, then drag the strip or the handle next to it. Use `/alm lock` afterward so clicks pass through to the game. The handle sits outside the position data and disappears when locked. The strip remembers its position, stays within the game screen, and locks automatically after login or `/reload`. `/alm reset` restores the small strip to the top-left corner.

The strip must stay visible in the captured source. Closing the in-game map is fine; hiding WoW's entire UI, covering the strip, or minimizing the game can stop live updates. After moving or resizing it, the companion automatically searches for the strip again.

## Browse maps like in WoW

**Right-click the map** to go up one level: city → surrounding zone → continent → Azeroth → Worlds. Outland returns directly to Worlds. **Left-click an area** on an overview to open its map. Hover an area to see its name and highlight its selection region. On zone maps, the small arrow buttons open their cities.

Drag to pan; use the mouse wheel or +/− buttons to magnify the current artwork. Dragging does not select an area. The **Up** button, clickable map path, and **Backspace** (with the map focused) also navigate up. The map dropdown includes worlds, continents, every supported zone/city, and battlegrounds.

Manual navigation switches off **Follow my zone** and remembers the map you selected. Live coordinates keep updating while you browse. Enable **Follow my zone** to return to your character; player, trail, and Questie pins appear on their matching zone map. Overview selection regions are manually traced against the artwork, rather than exported from the game; borders may differ slightly from the in-game hit regions.

## Questie integration

Keep Questie installed and enabled alongside **Azeroth Live Map 0.5.2**. Questie is an optional dependency; this project does not bundle or modify it. Update the companion addon and browser app together, then type `/reload` in WoW and reopen/reconnect the app. Version 0.4.0 supplies the original fast all-zone strip; version 0.3.0 still supplies its slower current-zone quest feed; earlier addons supply positions only.

The adapter reads Questie’s generated world-map frames (`QuestieMap.questIdFrames`, `UiMapID`, percent coordinates, and `data.QuestData`/`ObjectiveData`), matching the installed Questie implementation and [upstream QuestieMap](https://github.com/Questie/Questie/blob/master/Modules/Map/QuestieMap.lua). It honors Questie’s map visibility filters without requiring its map window to be shown. Yellow **!** pins are pickups, blue diamonds are objectives, and **?** pins are turn-in locations (including incomplete turn-ins shown by Questie).

The bridge sends Questie-generated pins from **all zones**, without the former 96-pin or four-spawn sampling limits. Open any supported zone in the app to inspect its received quests without visiting that zone in game. Questie's character eligibility, phasing, tracking, and map filters still determine which pins exist. This covers Questie's map locations; paths, full tooltip contents, and party data are not part of the bridge. The wire index supports up to 65,535 unique pins per zone and reports if that bound is exceeded.

Fast sync emits four auxiliary packets alongside each position update, nominally **40 data packets per second**. In addon 0.6.0, three quarters carry Questie data (30/s) and one quarter carries character/equipment data (10/s), without enlarging the strip or changing position cadence. Versions 0.4–0.5 dedicate all four lanes to quests. Browser decoding follows delivered video frames. Initial sync time depends on the total number of pins/titles and on delivered capture frames. A deterministic 300-pin, three-zone fixture, including all shared UTF-8 titles, completes in 11.95 simulated seconds at 40 packets/s. This is a protocol benchmark, not a promise of live-game latency. The sidebar shows per-map pin counts and overall pins, zones, names, and observed packet rate.

Questie is sampled every two seconds. Locations and titles use separate repeating queues; titles are shared between zones, active objectives/turn-ins precede pickups within a zone, and finished small zones give the remaining bandwidth to larger snapshots. Progress updates preserve snapshot cursors, and removed quests produce empty replacement snapshots in affected zones. Repeats rotate their starting pin to avoid repeatedly losing the same location with periodic capture drops. Busy structural changes and dropped frames can still delay completion.

Quest pins use a stable eight-color palette keyed by quest ID. Pins for the same quest keep their color across zones and reloads, and match the sidebar title, accent, and tooltip border. Colors repeat when needed; the `!`, diamond, and `?` shapes still distinguish pickups, objectives, and turn-ins. Select a sidebar quest or map pin to highlight all its pins and dim other quests.

Quest data stays in browser memory through player zone changes and while browsing. A replacement snapshot clears only its affected zone; disconnects, reconnects, or a new addon session clear the character feed. A global quest heartbeat keeps remote zones usable during long transmission cycles. Stale captures hide pins. Missing or incompatible Questie reports its status while position tracking continues. This bridge uses Questie internals, so a future Questie update may require an adapter change. Actual gameplay, game performance, update latency, and alignment still need an in-game check.

## App tabs

Use **Map**, **Character**, and **Updates** at the top of the app. Map contains zone navigation, position, and Questie tracking; Character has a full equipment and attributes view; Updates lists recent improvements and has space for future additions. The connection, minimap commands, fullscreen, and Show/Hide controls remain shared. Map-specific sidebar controls appear only on Map.

Changing tabs keeps the capture running and retains the selected map, zoom and pan. Character and quest data continue syncing in the background. The last selected tab is remembered as a display preference; refreshing still requires a new screen-sharing choice. Use Left/Right arrows, Home, and End when a tab has focus; hidden panels are excluded from keyboard navigation. Future views use the same tab/panel navigation without creating a new capture connection.

## Character and equipment

Choose the **Character** tab to open the full equipment view. With addon **0.6.0**, it shows your name, realm, level, race, class, all 19 equipment slots, quality colors, detailed item tooltips, and effective Strength, Agility, Stamina, Intellect, Spirit, Armor, maximum health and maximum power. The equipment layout follows WoW’s two columns and bottom weapon slots; it uses a simple silhouette, without a 3D character renderer. Hover or keyboard-focus an equipped item for its TBC description: binding, armor or damage/speed, attributes, requirements, and equip/use effects. The header uses the synced name/item level and durability uses the live captured value rather than the database maximum. Tooltips stay within the viewport, can be hovered/scrolled, and dismiss with Escape; the character panel stays open. On touch screens the first tap shows details and the second opens Wowhead. Select an equipped item with a mouse to open its TBC Wowhead page. Descriptions are **base item data**: enchants, socketed gems, random bonuses and active set bonuses are not synced by addon 0.6.0. The tooltip labels this limit. Item icons and descriptions share one cached request, with a short retry delay after errors. Remote markup is rebuilt with an allowlist; scripts, links, images, styles and event handlers are excluded. If item lookup fails, the tooltip retains the synced name, slot, level and durability with an unavailable message.

Update the addon and companion together, type `/reload` in WoW, refresh/reopen the companion, reconnect, then open **Character**. Character sync works without Questie. Existing older addons keep map/quest tracking but cannot populate this panel. Fast mode carries nominally ten character packets per second; long names and dropped capture frames can delay a complete equipment pass. Compact mode has less bandwidth. Gear changes and attributes are sampled once per second and repeated; an item’s metadata and UTF-8 name share a revision to prevent mixing old/new gear. Frozen or disconnected captures hide character details. A new addon session clears the previous character. Nothing is written back to WoW. Live gameplay verification remains necessary after reload.

## Hide or restore WoW’s minimap

Use **WoW minimap** in the browser toolbar, then **Copy hide command**. Paste `/alm minimap hide` into WoW chat and press Enter. **Copy show command** gives `/alm minimap show` to restore it. This requires addon 0.5.2; type `/reload` after updating.

The browser reads the game’s data strip and cannot send commands to WoW, so copying does not claim the game has already changed. If clipboard access is unavailable, the app selects the command for manual copying. These controls remain available with the sidebar hidden and on mobile layouts.

The addon remembers the hidden preference after reload/login. It delays requested changes while in combat and applies the latest request when combat ends. It operates on Blizzard’s [Anniversary MinimapCluster](https://github.com/Gethe/wow-ui-source/blob/classic_anniversary/Interface/AddOns/Blizzard_Minimap/Classic/Minimap.xml); the position/quest bridge remains independent. Other minimap customization is left alone until you explicitly use the command.

## Addon commands

| Command | Effect |
| --- | --- |
| `/alm` | Show help. |
| `/alm show` | Show the position strip. |
| `/alm hide` | Hide it; live tracking will stop. |
| `/alm size 2` | Use 100 × 136 artwork, or 100 × 80 plain fast / 100 × 16 plain compact. |
| `/alm size 3` | Use 150 × 204 artwork (150 × 120 plain fast / 150 × 24 plain compact). |
| `/alm minimap hide` | Hide WoW’s built-in minimap; remember the choice. |
| `/alm minimap show` | Restore WoW’s minimap and clear the hidden preference. |
| `/alm art on` | Show the animated elephant carrying position and quest data (default). |
| `/alm art off` | Return to the monochrome strip. |
| `/alm sync fast` | Send four quest packets per update alongside the position (default). |
| `/alm sync compact` | Reduce quest traffic: one quest packet per artwork update, or alternating packets on the plain strip. |
| `/alm unlock` | Show the drag handle and allow moving the strip. |
| `/alm lock` | Hide the handle and let clicks pass through. |
| `/alm reset` | Restore size 2 at the top-left corner and lock the block. |

## Connection and map troubleshooting

- **Sharing canceled or denied:** no live connection has started. Choose Connect WoW again when ready; the browser must allow the requested capture.
- **Searching for the strip:** check that the addon is enabled, run `/alm show`, and confirm the shared window or display includes the strip. Try `/alm size 8` and manual selection if necessary.
- **Stale or interrupted position:** the page has stopped receiving changing valid packets. Keep WoW rendered, restore its UI, and check for a minimized game or ended screen-sharing session. An old marker is not a new location reading.
- **No position available:** the game may not expose coordinates in that area or during a loading screen. Return to an outdoor zone to establish the initial connection.
- **Unsupported map:** the artwork catalog covers 65 Classic and Burning Crusade zones, cities, and selected battlegrounds, plus Kalimdor, Eastern Kingdoms, Outland, Azeroth, and Worlds overviews. Dungeon interiors are not included. Coordinates should never be plotted on unrelated artwork.
- **Map artwork does not load:** the browser needs access to `wow.zamimg.com`. This app does not bundle or claim ownership of Blizzard's map artwork.
- **Questie markers are missing:** enable Questie and Azeroth Live Map 0.5.2, type `/reload`, refresh the companion, reconnect, and enable **Questie markers**. Check Questie’s map filters and the sidebar’s sync status. Keep the whole elephant and locator visible, or all five rows of the plain fast strip. All Questie-generated zones are shared; check the overall sync progress and observed packet rate.

Use demo mode to inspect the browser interface without WoW. Demo positions are explicitly simulated; stop demo mode and connect the game to see your real location.

## Development

The browser uses buildless HTML and JavaScript in `dist/`; the addon is Lua in `addon/AzerothLiveMap/`. Python 3 is sufficient to serve the page and install or package the addon. Node.js and Lua are used for development verification.

```bash
npm test
python3 scripts/package_addon.py
```

The ZIP is written to `dist/AzerothLiveMap.zip`. The position protocol has synchronization rows, a checksum, and a changing sequence/clock so a frozen screen does not remain labeled live. Source data and trail history are held locally by the browser.

### Verification

Four navigation tests check the complete map hierarchy, representative geographic targets, empty ocean clicks, city entrances, and hit testing after panning/zooming or resizing. Browser integration uses real mouse events during synthetic live capture to check right-click parents, left-click world/continent/zone/city selection, hover highlights, drag-versus-click, zoomed selection, breadcrumbs, Up/Backspace, saved browsing, and follow pause/resume.

53 automated protocol/addon tests cover actual Lua emitter/browser interoperability, Lua 5.1 compatibility, addon rendering under mocked WoW APIs, fractional capture scaling, invalid packets, frozen feeds, tiny-strip detection at screen edges, dragging, saved placement, UI scaling, and reset. Questie checks cover filtered pins, titles, progress, complete spawn export, independent zone replacement, missing/incompatible internals, skipped/reordered fragments, checksum rejection, and actual Lua rendering of four quest rows alongside positions. All-zone checks cover 300 pins and shared titles, 20% deterministic packet loss, rotating repeats, progress-update fairness, session replacement, fractional multi-lane decoding, and damaged-row isolation. Browser integration tests use a synthetic canvas video stream through the real capture decoder and check Questie names, progress, tooltips, layer toggling, removed quests, missing/incompatible status, stale/disconnected cleanup, coordinates, reacquisition after shrinking and moving the strip, zone transitions, missing coordinates, unsupported maps, capture denial, disconnection, and responsive layout. Screenshots of demo mode are labeled simulated. The movement controls and Questie bridge still need an in-game check; complete map-art alignment coverage has not been verified. The standalone server has also been checked for port collisions, authenticated reuse, traversal and symlink escapes, hidden files, directory listings, and invalid Host headers; the installer has been checked in a temporary directory for dry runs, backups, profile preservation, and desktop entry validation.

Minimap tests cover saved hiding/restoration, preserving other minimap customization by default, missing-frame handling, and latest-request deferral during combat. Browser checks cover both copied commands, clipboard-denied fallback, hidden-sidebar access, and narrow layouts.

The elephant test rasterizes the actual Lua renderer in all eight poses at integer and fractional sizes, verifies five packet decoding, automatic discovery, gamma variation, independent 4:2:0 video round-trips in BT.601 and BT.709, damaged-packet isolation, dragging, art on/off, compact mode, and saved preferences.

`scripts/quest_sync_qa.mjs --art --yuv420` converts synthetic frames through native I420 video frames at a fractional initial scale, then checks automatic location, all 210 pins/titles, relocation, manual selection, stale capture, and cleanup.

`scripts/character_qa.mjs` and `--art` exercise actual Lua character packets through browser capture, including all equipment slots, icons, name fragments, stats, replacements/removals, session changes, mobile layouts, keyboard focus, equipment hover details, formatting sanitization, touch interaction, and stale/disconnected cleanup. Screenshots use an explicitly synthetic character fixture.

`scripts/quest_sync_qa.mjs --art` checks the animated transport through real browser capture, including locator discovery, all-zone quests/titles, relocation, whole-mascot manual calibration, removal, stale capture, and disconnects.

`scripts/quest_sync_qa.mjs` sends actual Lua packets through a synthetic browser capture and checks remote-zone pins, names, the overall rate, complete-block relocation, remote-zone removal, retained sibling zones, frozen feeds, and disconnect cleanup.

`scripts/browser_qa.mjs` runs against a separate test Chromium instance with its debugging port at `127.0.0.1:9223` and the local server at port 8765. Never enable remote debugging on your normal browser profile for these tests.

## Map sources and attribution

World of Warcraft and its map artwork belong to **Blizzard Entertainment**. Map images are served by **Wowhead**; no unrestricted artwork redistribution license is claimed. Artwork is separate from this project's own code.

- [Wowhead TBC map image example: Elwynn Forest](https://wow.zamimg.com/images/wow/tbc/maps/enus/original/12.jpg)
- [QuestieDB UI-map-to-area ID crosswalk](https://github.com/Questie/QuestieDB/blob/master/support/Zones/uiMapIdToAreaId.lua)
- [Anniversary map API source](https://github.com/Gethe/wow-ui-source/blob/classic_anniversary/Interface/AddOns/Blizzard_APIDocumentationGenerated/MapDocumentation.lua)
- [Browser screen-sharing API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)

The image URLs were checked during development. Their availability can change. Coordinate alignment with the selected images remains part of live-client validation.

### Artwork source

The built-in image generation tool created the eight-frame sheet from the user-supplied pink elephant reference. The saved source is `assets/elephant-idle-source.png`; the exact generation prompt is `assets/elephant-prompt.txt`. `python3 scripts/build_elephant.py` (Pillow required) packs it into `Elephant.tga`, `Elephant.lua`, `dist/elephant-art.json`, and `dist/elephant-atlas.png`. These matching assets define both the visible skin and its decoder reference; regenerate and update them together.

Character item fields follow the [Anniversary item API source](https://github.com/Gethe/wow-ui-source/blob/classic_anniversary/Interface/AddOns/Blizzard_APIDocumentationGenerated/ItemDocumentation.lua); no Blizzard account API credentials are required.
