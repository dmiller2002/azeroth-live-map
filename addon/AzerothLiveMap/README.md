# Drunks Azeroth UI — Forever

Addon version **1.0.1**. Compatible with companion **1.0.0**.

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

Questie is optional for map pins and must be installed separately in a
Forever-compatible version. Native quest text, objectives, equipment and bags
do not require Questie.

Build 69977 was used as the 1.60.1 API reference. The addon has no exact build
lock and sends the running client version/build to the desktop automatically.
Future interface/API changes may require an addon update.

The addon displays data made available to ordinary addons. Restricted values
are omitted. It does not automate gameplay or read game memory.
