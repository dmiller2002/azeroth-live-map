# Drunks Azeroth UI — Forever

Addon version **1.0.3**. Use companion **1.0.3** for Bag/bank storage. World-map
alignment and the built-in quest helper need 1.0.2 or newer. Older companions
can still read the existing feeds.

Install this `AzerothLiveMap` folder in your official WoW Forever client's
`Interface/AddOns` folder. Enable **Drunks Azeroth UI - Forever**, then log in.

This addon displays a pixel signal for the separate **Drunks Azeroth Companion —
WoW Forever Edition** desktop application. Download that application from:
https://github.com/dmiller2002/azeroth-live-map/releases

The addon package contains no desktop executable. Use the desktop's **Connect
WoW** button to choose the game window or monitor in your OS capture picker.
Keep the entire HUZZAH sprite and locator visible in the selected source.

`/daui` shows command help. `/daui unlock` enables dragging; `/daui lock` saves
and locks the sprite. `/daui art off` switches to the plain sync strip. The
`/alm` command is an alias. Guild location/profession sharing defaults off;
members can opt in with `/daui guild on` and stop with `/daui guild off`.

In the companion, choose **WoW Forever** or **Questie** above the map. The built-in
helper supplies Blizzard's accepted-quest POIs, next waypoints, and turn-in pins
without Questie. Questie remains an optional, separately installed provider of
its own available-quest and objective markers. The choice is saved by the app.
Neither provider changes your in-game map, selected quest, CVars, or Questie settings.

Map rectangles and parent relationships are read from the current client's
`C_Map` APIs. Positions and markers use those rectangles on continent/world
views. Unknown or restricted map transforms are omitted rather than guessed.

Open your bank in WoW once to record native bank tabs and their items. Personal
and account bank storage are read only when viewable with the bank open; no
tabs are selected or items moved. When the bank closes, the companion labels
the last successful snapshot as cached. Snapshots are saved separately by
character and realm in `AzerothLiveMapDB.bankCache` and survive `/reload`.
Reopen the bank to refresh deposits, withdrawals, and stack changes. Failed or
restricted reads retain the last successful snapshot and report a refresh error.

Build 69977 was used as the 1.60.1 API reference. The addon has no exact build
lock and sends the running client version/build to the desktop automatically.
Future interface/API changes may require an addon update.

The addon displays data made available to ordinary addons. Restricted values
are omitted. It does not automate gameplay or read game memory.
