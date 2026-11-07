# Drunks Azeroth Companion — WoW Forever

Desktop companion and addon for **Blizzard’s official World of Warcraft Forever** (interface `16001`). Build **1.60.1 (69977)** is the compatibility reference, not a version lock. Version **1.0.0** replaces the former Anniversary/browser project.

Play on one monitor and use the companion on another for live position and trails, built-in Forever or Questie markers, readable quests and objectives, equipment, bags, guild roster, and split views. The Electron desktop application includes its runtime in packaged releases.

## Downloads and launch

Download the current packages from [GitHub Releases](https://github.com/dmiller2002/azeroth-live-map/releases). Keep extracted application folders together.

- **Windows:** extract the Windows ZIP and open `Drunks Azeroth Companion - Forever.exe`, or use the Windows `Setup.exe` installer.
- **Linux:** extract the Linux tar archive and run `drunks-azeroth-companion`. The executable AppImage is an alternative; use `--appimage-extract-and-run` if FUSE is unavailable.
- **Source checkout:** install Node.js 24 or later, run `npm ci`, then `npm start`. `./start-companion.sh` and `START-COMPANION.cmd` also launch a local build or installed development dependencies.

The standalone program needs no local web server, hosted site, or separate browser. Internet access supplies map artwork, optional item details, and model assets. These development packages are unsigned.

## Companion updates

Open **What’s new → Update companion** and choose **Check for updates → Download
update → Restart & install**. Packaged Windows and Linux copies download, verify,
and install updates inside the app; no browser is needed.
Checks use stable releases from `dmiller2002/azeroth-live-map` on GitHub. Downloads
and installation require their own button clicks; closing the app normally does
not install a downloaded update. Restarting ends capture; reconnect WoW afterward.
Linux copies install the verified AppImage under the companion's user-data folder
and relaunch it without requiring FUSE. Existing AppImage and tar-package shortcuts
forward to the newer managed copy. Windows ZIP copies use the verified NSIS
installer to update their existing folder. Preferences remain in the shared user
profile. Source checkouts keep their code and dependencies managed separately.

Users of the old 1.0.0 release need to install an updater-enabled build (1.0.1 or newer)
once. The existing `addon-v1.0.0-beta2` release has no update manifests and cannot
serve in-app updates.

For each future desktop release, increase the desktop version in `package.json`
and its lockfile before building. Publish a **stable GitHub release** with these
files from the same build (do not reuse manifests from an older build):

- Windows: the `Windows-Setup.exe`, its `.blockmap`, and `latest.yml`.
- Linux: the `.AppImage` and `latest-linux.yml`.

The build scripts generate the manifests using the configured GitHub feed but do
not upload files. Keep the filenames from the build intact and upload them as
release assets, not as source attachments. The updater verifies downloads against
the hashes in the release manifest. Addon ZIPs alone do not update the companion;
beta releases remain available through the GitHub releases button.

## Install the Forever addon

1. Extract **DrunksAzerothUI.zip**, supplied beside the desktop executable and through the app’s addon download button.
2. Put its `AzerothLiveMap` folder into the **Forever client’s** `Interface/AddOns` directory. A typical Battle.net path is `World of Warcraft/_forever_/Interface/AddOns/AzerothLiveMap/`.
3. Confirm `AzerothLiveMap.toc` sits directly inside that folder. Enable **Drunks Azeroth UI** in the Forever addon list. Restart after a first installation; use `/reload` after an update.
4. Keep the entire HUZZAH sprite and locator visible in the game. Open the desktop app, choose **Connect WoW**, and select the game window or its monitor in the screen-sharing picker.

The original folder name, slash commands and `AzerothLiveMapDB` saved variable remain so existing preferences can migrate. This addon ZIP targets Forever; install it into your Forever client rather than the Anniversary client.

Questie is optional. Above the map, choose **WoW Forever** for Blizzard's accepted-quest POIs, next waypoints, and turn-in markers, or **Questie** for its available-quest and objective pins. The selected provider is saved; switching keeps the capture session and both feeds. Install a **Forever-compatible Questie release and its matching database** separately to use that provider. Native helper coverage depends on what the client exposes; Questie coverage depends on its database. Quest text, objectives, equipment and inventory work without Questie.

Install **both desktop and addon 1.0.2**, then `/reload` in WoW, for the built-in helper and synced world/continent layout. The source selector stays visible when the sidebar is collapsed. **Quest markers** in the sidebar shows or hides the selected provider's pins.

## Maps and game data

The catalog contains **59 entries**: 49 familiar zone/city/battleground maps, six new Forever map IDs, and four navigation overviews. TBC-only zones and Outland are removed from the catalog.

All live coordinates and map images use the native Forever frame. Artwork comes from Wowhead’s **`classicplus`** asset environment, including updated familiar zones, Mount Hyjal, Zephras Isle, Darkspear Islands, Riverglades and Shen’dralas. Zone artwork uses native zone coordinates directly. The second Zephras Isle map ID (`2665`) retains a grid until its artwork coordinate frame is verified. Unknown maps and download failures also retain a grid and live markers. Map art is streamed from Wowhead and is not bundled.

The addon reads the current client's `C_Map.GetMapInfo` and `GetMapRectOnMap`
relationships. Player, quest, guild, and trail positions are projected through
those rectangles on continent/world maps, and the same rectangles supply map
navigation hit targets. The old TBC artwork traces are removed. Overview maps
open in Whole map framing. Layout data stays in memory and clears on disconnect;
before connecting, use the map picker for offline browsing. Unavailable or
restricted transforms do not produce guessed positions.

The quest reader uses Forever’s native quest log, indexed text reader, completion/failure APIs, objectives and watch state. It does not change your selected in-game quest. Primary professions support Forever’s `C_SkillInfo` records and preserve collapsed skill headers. Restricted positions produce an unavailable-position signal; restricted or unavailable character stats display `—` while equipment continues syncing.

Equipment names, levels, quantities and durability come from the game. External item links and lookups use Wowhead’s Forever database. Character assets use Wowhead’s native `classicplus` model environment, including available models for races 33 and 34. Equipment appearances are resolved from Wowhead’s Forever item records rather than the legacy item-to-display database. Items without a verified Forever appearance or available model are omitted from the preview and counted in its status. Use **Refresh gear** to retry missing appearances. The equipment list remains usable when a model is unavailable.

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
| Collapse sidebar / Show sidebar | Give the main view the sidebar’s space, or restore its controls; the choice is saved |
| Refresh gear (Character) | Reload current equipment appearances and retry unavailable models |
| Quest helper (above map) | Switch between WoW Forever and Questie markers without reconnecting |
| Whole map / Fill box | Change map framing |
| Right-click map / Backspace | Browse to the parent map |

`/alm` aliases `/daui`. Fast sync carries up to four auxiliary packets per update, shared by quests, equipment, bags and guild data. Actual reception depends on readable game frames and capture rate. Keep the full sprite visible; a minimized game can stop supplying frames.

Guild location/profession sharing defaults off and uses the in-game guild addon channel. Participating members need the same addon. Coordinates expire after 30 seconds without a new sample. A roster zone by itself never creates a precise pin.

## Build and verify

```sh
npm ci
npm run package:addon
npm test
npm run test:updates
npm run test:maps
npm run test:desktop
npm run build:linux
npm run build:windows
npm run release:source
```

Addon fixture tests require **LuaJIT**. Desktop QA requires a graphical Linux session, Electron’s system dependencies, and internet access for optional model assets. Windows cross-builds on Linux also need electron-builder’s Wine/NSIS tools. Output is in `release/1.0.2/`. The source archive excludes dependencies, caches, generated QA artifacts, game data and old releases.

The Linux updater QA uses a local HTTP server and synthetic payload to exercise
the real Electron downloader, checksum verification, and managed staging. It
records a restart request without executing the downloaded test payload.

Automated verification uses synthetic addon APIs and capture frames. **A live session on build 69977 has not been verified here.** Before relying on live data, follow [the in-game checklist](docs/FOREVER_VALIDATION.md). [Compatibility references](docs/FOREVER_COMPATIBILITY.md) record the exact UI source snapshot and map-data provenance.

Screen capture is selected by the user. The addon displays pixels; the desktop decodes them without reading game memory or automating gameplay. Frames and live character data remain in memory. Asset/item providers receive the requests needed for their lookups; display preferences and window placement are stored locally. Closing the app ends capture. Each new connection requires a fresh capture-source choice.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for artwork and library attribution.
