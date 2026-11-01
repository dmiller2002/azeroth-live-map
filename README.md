# Azeroth Live Map

A browser map for World of Warcraft Anniversary. Keep playing on one monitor and watch your position, direction, and recent trail on another. The in-game world map can stay closed.

This is a prototype. The addon targets the installed Anniversary **2.5.6.70577** client (`20506` interface); its TOC also declares Classic Era `11509`. Actual game capture, location accuracy, and zone transitions still need an in-game check on your setup. A moving marker in demo mode is simulated and does not verify the live connection.

## How it works

The `AzerothLiveMap` addon draws your map ID and coordinates as a small black-and-white strip near the upper-left corner of WoW. When you select **Connect WoW** in the browser, the browser asks you to share the WoW window or the monitor containing the game. The page decodes the strip locally and updates your marker.

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
Interface/AddOns/AzerothLiveMap/Main.lua
```

Restart WoW after adding the folder, enable **Azeroth Live Map** in the character selection screen's AddOns list, and log in. Look for the black-and-white position strip near the top-left corner.

## Open the browser map

For local use, run:

```bash
python3 scripts/serve.py
```

Open **http://localhost:8765** in Chromium on the same computer as WoW, then move the browser to your second monitor. The server listens only on this computer. Keep its terminal running while using the map; stop it with Ctrl+C.

The configured hosted address is **https://azeroth-live-map-dylan.spicyleaf18.chatgpt.site** (private to its owner). The local version does not depend on hosted access.

1. Leave WoW visible on your main monitor with the position strip unobstructed.
2. In the browser map, choose **Connect WoW**.
3. In the browser or desktop sharing dialog, select the **WoW window**. If window sharing is unavailable, select the **monitor containing WoW**, not the browser monitor.
4. Return focus to WoW and move your character. The map should report a live connection and update your location.
5. If the strip is not detected automatically, use the page's manual strip selection and select the whole strip, including its black border.

Chromium is the recommended first browser to test on this Linux setup. Screen sharing requires a secure browser context: use `localhost` for the local server, or HTTPS for a hosted page. Open the page directly in its own browser tab if an embedded preview blocks capture. The browser requires a fresh sharing choice when starting a new capture session.

The default strip is approximately **300 × 48 pixels**. It must stay visible in the captured source. Closing the in-game map is fine; hiding WoW's entire UI, covering the strip, or minimizing the game can stop live updates.

## Addon commands

| Command | Effect |
| --- | --- |
| `/alm` | Show help. |
| `/alm show` | Show the position strip. |
| `/alm hide` | Hide it; live tracking will stop. |
| `/alm size 6` | Set cell size; allowed range is 4–12. Increase it if capture scaling makes the strip hard to read. |

## Connection and map troubleshooting

- **Sharing canceled or denied:** no live connection has started. Choose Connect WoW again when ready; the browser must allow the requested capture.
- **Searching for the strip:** check that the addon is enabled, run `/alm show`, and confirm the shared window or display includes the strip. Try `/alm size 8` and manual selection if necessary.
- **Stale or interrupted position:** the page has stopped receiving changing valid packets. Keep WoW rendered, restore its UI, and check for a minimized game or ended screen-sharing session. An old marker is not a new location reading.
- **No position available:** the game may not expose coordinates in that area or during a loading screen. Return to an outdoor zone to establish the initial connection.
- **Unsupported map:** the artwork catalog covers 65 Classic and Burning Crusade zones, cities, and selected battlegrounds. Continent/world maps and dungeon interiors are not included. Coordinates should never be plotted on unrelated artwork.
- **Map artwork does not load:** the browser needs access to `wow.zamimg.com`. This app does not bundle or claim ownership of Blizzard's map artwork.
- **Questie markers are missing:** this version tracks your position. It does not copy the in-game map or import other addons' markers.

Use demo mode to inspect the browser interface without WoW. Demo positions are explicitly simulated; stop demo mode and connect the game to see your real location.

## Development

The browser uses buildless HTML and JavaScript in `dist/`; the addon is Lua in `addon/AzerothLiveMap/`. Python 3 is sufficient to serve the page and install or package the addon. Node.js and Lua are used for development verification.

```bash
npm test
python3 scripts/package_addon.py
```

The ZIP is written to `dist/AzerothLiveMap.zip`. The position protocol has synchronization rows, a checksum, and a changing sequence/clock so a frozen screen does not remain labeled live. Source data and trail history are held locally by the browser.

### Verification

23 automated protocol tests cover actual Lua emitter/browser interoperability, Lua 5.1 compatibility, addon rendering under mocked WoW APIs, fractional capture scaling, invalid packets, and frozen feeds. Browser integration tests use a synthetic canvas video stream through the real capture decoder and check live coordinates, zone transitions, missing coordinates, unsupported maps, capture denial, disconnection, and responsive layout. Screenshots of demo mode are labeled simulated. Actual WoW gameplay and map-art alignment have not yet been verified.

`scripts/browser_qa.mjs` runs against a separate test Chromium instance with its debugging port at `127.0.0.1:9223` and the local server at port 8765. Never enable remote debugging on your normal browser profile for these tests.

## Map sources and attribution

World of Warcraft and its map artwork belong to **Blizzard Entertainment**. Map images are served by **Wowhead**; no unrestricted artwork redistribution license is claimed. Artwork is separate from this project's own code.

- [Wowhead TBC map image example: Elwynn Forest](https://wow.zamimg.com/images/wow/tbc/maps/enus/original/12.jpg)
- [QuestieDB UI-map-to-area ID crosswalk](https://github.com/Questie/QuestieDB/blob/master/support/Zones/uiMapIdToAreaId.lua)
- [Anniversary map API source](https://github.com/Gethe/wow-ui-source/blob/classic_anniversary/Interface/AddOns/Blizzard_APIDocumentationGenerated/MapDocumentation.lua)
- [Browser screen-sharing API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)

The image URLs were checked during development. Their availability can change. Coordinate alignment with the selected images remains part of live-client validation.
