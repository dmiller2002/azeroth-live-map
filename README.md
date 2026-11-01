# Azeroth Live Map

A browser map for World of Warcraft Anniversary. Keep playing on one monitor and watch your position, direction, and recent trail on another. The in-game world map can stay closed.

This is a prototype. The addon targets the installed Anniversary **2.5.6.70577** client (`20506` interface); its TOC also declares Classic Era `11509`. Actual game capture, location accuracy, and zone transitions still need an in-game check on your setup. A moving marker in demo mode is simulated and does not verify the live connection.

## How it works

The `AzerothLiveMap` addon draws your map ID and coordinates as a small black-and-white strip near the upper-left corner of WoW. When you select **Connect WoW** in the browser, the browser asks you to share the WoW window or the monitor containing the game. The page decodes the strip locally and updates your marker.

With **Questie** enabled, the same strip also sends quest pickups, objective locations and counts, turn-in locations, and quest titles for your character’s current zone. Use the **Questie markers** toggle, hover a pin for details, or select a quest in the sidebar to highlight its locations. The in-game world map can stay closed.

Screen frames and coordinates are not uploaded by this app. Map artwork is fetched from Wowhead's CDN. The addon does not automate gameplay or read process memory; the browser uses ordinary screen capture. This implementation is not a claim of Blizzard approval.

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

The smallest strip is **100 × 16 pixels** (`/alm size 2`) and is the default for new installs. Existing saved sizes are preserved; use that command to shrink an older installation. If screen-sharing scaling makes it difficult to read, try `/alm size 3` (150 × 24) or `/alm size 4` (200 × 32).

Use `/alm unlock`, then drag the strip or the handle next to it. Use `/alm lock` afterward so clicks pass through to the game. The handle sits outside the position data and disappears when locked. The strip remembers its position, stays within the game screen, and locks automatically after login or `/reload`. `/alm reset` restores the small strip to the top-left corner.

The strip must stay visible in the captured source. Closing the in-game map is fine; hiding WoW's entire UI, covering the strip, or minimizing the game can stop live updates. After moving or resizing it, the companion automatically searches for the strip again.

## Browse maps like in WoW

**Right-click the map** to go up one level: city → surrounding zone → continent → Azeroth → Worlds. Outland returns directly to Worlds. **Left-click an area** on an overview to open its map. Hover an area to see its name and highlight its selection region. On zone maps, the small arrow buttons open their cities.

Drag to pan; use the mouse wheel or +/− buttons to magnify the current artwork. Dragging does not select an area. The **Up** button, clickable map path, and **Backspace** (with the map focused) also navigate up. The map dropdown includes worlds, continents, every supported zone/city, and battlegrounds.

Manual navigation switches off **Follow my zone** and remembers the map you selected. Live coordinates keep updating while you browse. Enable **Follow my zone** to return to your character; player, trail, and Questie pins appear on their matching zone map. Overview selection regions are manually traced against the artwork, rather than exported from the game; borders may differ slightly from the in-game hit regions.

## Questie integration

Keep Questie installed and enabled alongside **Azeroth Live Map 0.3.0**. Questie is an optional dependency; this project does not bundle or modify it. Update the companion addon and browser app together, then type `/reload` in WoW and reconnect screen sharing. An older companion addon still provides positions, but cannot send quests.

The adapter reads Questie’s generated world-map frames (`QuestieMap.questIdFrames`, `UiMapID`, percent coordinates, and `data.QuestData`/`ObjectiveData`), matching the installed Questie implementation and [upstream QuestieMap](https://github.com/Questie/Questie/blob/master/Modules/Map/QuestieMap.lua). It honors Questie’s map visibility filters without requiring its map window to be shown. Yellow **!** pins are pickups, blue diamonds are objectives, and **?** pins are turn-in locations (including incomplete turn-ins shown by Questie).

The small strip shares bandwidth between position packets and repeating quest snapshots. Markers and UTF-8 titles arrive progressively; the sidebar reports the received/expected marker count. A busy zone can take several minutes to finish a cycle, especially with dropped capture frames. Quest changes are sampled at a completed transmission cycle (at least three seconds between scans), while a zone change interrupts the cycle immediately. Counts describe that snapshot and may lag gameplay. The bridge prioritizes active quests, sends up to 96 pins, and samples up to four nearby spawn points per quest/objective. “Nearby samples” means additional locations were omitted. This is a useful quest overlay, not a complete copy of every Questie spawn, path, tooltip, or party marker.

Quest data stays in browser memory and clears on disconnect, zone changes, or replacement snapshots. Stale captures hide quest pins. Browsing another zone does not show the character’s current-zone pins on unrelated artwork. Missing or incompatible Questie displays an explanatory status and leaves position tracking working. This bridge uses Questie internals, so a future Questie update may require an adapter change. Automated fixtures match the installed fields; actual gameplay, update latency, and marker alignment still need an in-game check.

## Addon commands

| Command | Effect |
| --- | --- |
| `/alm` | Show help. |
| `/alm show` | Show the position strip. |
| `/alm hide` | Hide it; live tracking will stop. |
| `/alm size 2` | Use the smallest strip (100 × 16 pixels); sizes 2–12 are supported. |
| `/alm size 3` | Use a slightly larger strip (150 × 24) if sharing scales it down. |
| `/alm unlock` | Show the drag handle and allow moving the strip. |
| `/alm lock` | Hide the handle and let clicks pass through. |
| `/alm reset` | Restore the small strip to the top-left corner and lock it. |

## Connection and map troubleshooting

- **Sharing canceled or denied:** no live connection has started. Choose Connect WoW again when ready; the browser must allow the requested capture.
- **Searching for the strip:** check that the addon is enabled, run `/alm show`, and confirm the shared window or display includes the strip. Try `/alm size 8` and manual selection if necessary.
- **Stale or interrupted position:** the page has stopped receiving changing valid packets. Keep WoW rendered, restore its UI, and check for a minimized game or ended screen-sharing session. An old marker is not a new location reading.
- **No position available:** the game may not expose coordinates in that area or during a loading screen. Return to an outdoor zone to establish the initial connection.
- **Unsupported map:** the artwork catalog covers 65 Classic and Burning Crusade zones, cities, and selected battlegrounds, plus Kalimdor, Eastern Kingdoms, Outland, Azeroth, and Worlds overviews. Dungeon interiors are not included. Coordinates should never be plotted on unrelated artwork.
- **Map artwork does not load:** the browser needs access to `wow.zamimg.com`. This app does not bundle or claim ownership of Blizzard's map artwork.
- **Questie markers are missing:** enable Questie and Azeroth Live Map 0.3.0, type `/reload`, refresh the companion, reconnect, and enable **Questie markers**. Check Questie’s map filters and the sidebar’s sync status. Only the character’s current zone is shared; names and markers arrive progressively.

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

36 automated protocol/addon tests cover actual Lua emitter/browser interoperability, Lua 5.1 compatibility, addon rendering under mocked WoW APIs, fractional capture scaling, invalid packets, frozen feeds, tiny-strip detection at screen edges, dragging, saved placement, UI scaling, and reset. Questie checks cover filtered pins, titles, progress, bounded sampling, generation replacement, missing/incompatible internals, skipped/reordered fragments, checksum rejection, and alternating real Lua position/quest rendering. Browser integration tests use a synthetic canvas video stream through the real capture decoder and check Questie names, progress, tooltips, layer toggling, removed quests, missing/incompatible status, stale/disconnected cleanup, coordinates, reacquisition after shrinking and moving the strip, zone transitions, missing coordinates, unsupported maps, capture denial, disconnection, and responsive layout. Screenshots of demo mode are labeled simulated. The movement controls and Questie bridge still need an in-game check; complete map-art alignment coverage has not been verified. The standalone server has also been checked for port collisions, authenticated reuse, traversal and symlink escapes, hidden files, directory listings, and invalid Host headers; the installer has been checked in a temporary directory for dry runs, backups, profile preservation, and desktop entry validation.

`scripts/browser_qa.mjs` runs against a separate test Chromium instance with its debugging port at `127.0.0.1:9223` and the local server at port 8765. Never enable remote debugging on your normal browser profile for these tests.

## Map sources and attribution

World of Warcraft and its map artwork belong to **Blizzard Entertainment**. Map images are served by **Wowhead**; no unrestricted artwork redistribution license is claimed. Artwork is separate from this project's own code.

- [Wowhead TBC map image example: Elwynn Forest](https://wow.zamimg.com/images/wow/tbc/maps/enus/original/12.jpg)
- [QuestieDB UI-map-to-area ID crosswalk](https://github.com/Questie/QuestieDB/blob/master/support/Zones/uiMapIdToAreaId.lua)
- [Anniversary map API source](https://github.com/Gethe/wow-ui-source/blob/classic_anniversary/Interface/AddOns/Blizzard_APIDocumentationGenerated/MapDocumentation.lua)
- [Browser screen-sharing API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)

The image URLs were checked during development. Their availability can change. Coordinate alignment with the selected images remains part of live-client validation.
