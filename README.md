# Drunks Azeroth Companion — WoW Forever

Desktop companion and addon for **Blizzard’s official World of Warcraft Forever** (interface `16001`). Build **1.60.1 (69977)** is the compatibility reference, not a version lock. Version **1.0.0** replaces the former Anniversary/browser project.

Play on one monitor and use the companion on another for live position and trails, Questie pins, readable quests and objectives, equipment, bags, guild roster, and split views. The Electron desktop application includes its runtime in packaged releases.

## Downloads and launch

Download the current packages from [GitHub Releases](https://github.com/dmiller2002/azeroth-live-map/releases). Keep extracted application folders together.

- **Windows:** extract the Windows ZIP and open `Drunks Azeroth Companion - Forever.exe`, or use the Windows `Setup.exe` installer.
- **Linux:** extract the Linux tar archive and run `drunks-azeroth-companion`. The executable AppImage is an alternative; use `--appimage-extract-and-run` if FUSE is unavailable.
- **Source checkout:** install Node.js 24 or later, run `npm ci`, then `npm start`. `./start-companion.sh` and `START-COMPANION.cmd` also launch a local build or installed development dependencies.

The standalone program needs no local web server, hosted site, or separate browser. Internet access supplies map artwork, optional item details, and model assets. These development packages are unsigned.

## Install the Forever addon

1. Extract **DrunksAzerothUI.zip**, supplied beside the desktop executable and through the app’s addon download button.
2. Put its `AzerothLiveMap` folder into the **Forever client’s** `Interface/AddOns` directory. A typical Battle.net path is `World of Warcraft/_forever_/Interface/AddOns/AzerothLiveMap/`.
3. Confirm `AzerothLiveMap.toc` sits directly inside that folder. Enable **Drunks Azeroth UI** in the Forever addon list. Restart after a first installation; use `/reload` after an update.
4. Keep the entire HUZZAH sprite and locator visible in the game. Open the desktop app, choose **Connect WoW**, and select the game window or its monitor in the screen-sharing picker.

The original folder name, slash commands and `AzerothLiveMapDB` saved variable remain so existing preferences can migrate. This addon ZIP targets Forever; install it into your Forever client rather than the Anniversary client.

Questie is optional. Quest text, objectives, equipment and inventory work without it. For map pins, install a **Forever-compatible Questie release and its matching database** separately; Questie is not bundled. New Forever quest coverage depends on Questie’s data.

## Maps and game data

The catalog contains **59 entries**: 49 familiar zone/city/battleground maps, six new Forever map IDs, and four navigation overviews. TBC-only zones and Outland are removed from the catalog.

All live coordinates and map images use the native Forever frame. Artwork comes from Wowhead’s **`classicplus`** asset environment, including updated familiar zones, Mount Hyjal, Zephras Isle, Darkspear Islands, Riverglades and Shen’dralas. It is displayed directly, without stretching Classic artwork or transforming live positions. The second Zephras Isle map ID (`2665`) retains a grid until its artwork coordinate frame is verified. Unknown maps and download failures also retain a grid and live markers. Map art is streamed from Wowhead and is not bundled.

The quest reader uses Forever’s native quest log, indexed text reader, completion/failure APIs, objectives and watch state. It does not change your selected in-game quest. Primary professions support Forever’s `C_SkillInfo` records and preserve collapsed skill headers. Restricted positions produce an unavailable-position signal; restricted or unavailable character stats display `—` while equipment continues syncing.

Equipment names, levels, quantities and durability come from the game. External item links and lookups use Wowhead’s Forever database. Character assets use Wowhead’s native `classicplus` model environment, including available models for races 33 and 34. Some equipment models remain unavailable: the bundled item-to-display lookup is a legacy database, not complete Forever item coverage. The equipment list remains usable when a model is unavailable.

The window, sidebar, About dialog and release packages identify **WoW Forever Edition**. Once character data arrives, the toolbar shows the connected client’s actual version and build. Client build numbers can change without editing the app. If Blizzard changes the addon interface or API, review the TOC/API compatibility before updating the supported interface.

## CurseForge submission

[The release guide](docs/CURSEFORGE_RELEASE.md) covers project setup, the addon-only ZIP, GitHub configuration and publishing. `.pkgmeta` and the pinned BigWigs packager target **Forever**. Tag builds produce a validated addon artifact; CurseForge upload is an explicit workflow option after the project ID and token are configured. Desktop executables never enter the addon ZIP.

## Controls

| Command/control | Action |
| --- | --- |
| `/daui show`, `/daui hide` | Show or hide the sync sprite |
| `/daui art on`, `/daui art off` | Sprite or regular sync strip |
| `/daui size 3` | Set pixel size; values 2–12 |
| `/daui unlock`, `/daui lock` | Move the sprite, then lock it |
| `/daui reset` | Restore its default position |
| `/daui sync fast`, `/daui sync compact` | 20 or 10 visible updates per second |
| `/daui guild on`, `/daui guild off` | Opt into or stop guild profession/location sharing |
| `/daui guild status` | Report locally detected professions |
| `/daui minimap hide`, `/daui minimap show` | Hide or restore Blizzard’s minimap |
| UI scale / Ctrl + plus/minus / Ctrl + 0 | Scale the desktop interface or reset it |
| Whole map / Fill box | Change map framing |
| Right-click map / Backspace | Browse to the parent map |

`/alm` aliases `/daui`. Fast sync carries up to four auxiliary packets per update, shared by quests, equipment, bags and guild data. Actual reception depends on readable game frames and capture rate. Keep the full sprite visible; a minimized game can stop supplying frames.

Guild location/profession sharing defaults off and uses the in-game guild addon channel. Participating members need the same addon. Coordinates expire after 30 seconds without a new sample. A roster zone by itself never creates a precise pin.

## Build and verify

```sh
npm ci
npm run package:addon
npm test
npm run test:desktop
npm run build:linux
npm run build:windows
npm run release:source
```

Addon fixture tests require **LuaJIT**. Desktop QA requires a graphical Linux session, Electron’s system dependencies, and internet access for optional model assets. Windows cross-builds on Linux also need electron-builder’s Wine/NSIS tools. Output is in `release/1.0.0/`. The source archive excludes dependencies, caches, generated QA artifacts, game data and old releases.

Automated verification uses synthetic addon APIs and capture frames. **A live session on build 69977 has not been verified here.** Before relying on live data, follow [the in-game checklist](docs/FOREVER_VALIDATION.md). [Compatibility references](docs/FOREVER_COMPATIBILITY.md) record the exact UI source snapshot and map-data provenance.

Screen capture is selected by the user. The addon displays pixels; the desktop decodes them without reading game memory or automating gameplay. Frames and live character data remain in memory. Asset/item providers receive the requests needed for their lookups; display preferences and window placement are stored locally. Closing the app ends capture. Each new connection requires a fresh capture-source choice.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for artwork and library attribution.
