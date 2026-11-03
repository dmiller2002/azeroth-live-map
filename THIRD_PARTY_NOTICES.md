# 3D character preview

World of Warcraft models, textures, and artwork belong to Blizzard Entertainment.
The 3D renderer and model assets are requested from Wowhead's public model CDN.
The renderer is not bundled into the app's source or installation. Internet
access and the provider's availability are required for the 3D preview.

`app/vendor/jquery-3.7.1.min.js` is jQuery 3.7.1, copyright OpenJS Foundation
and other contributors, distributed under the MIT license. Its license notice
is retained in the file; see `app/vendor/jquery-LICENSE.txt`.

`app/item-models.json` contains only item IDs, display IDs, and inventory types
extracted from CMaNGOS TBC-DB's item_template table, under the supplied GPL-3.0 license.
It contains no textures or meshes. The source database is
<https://github.com/cmangos/tbc-db/blob/1c54acd200540076c3078d22a66fd417d0f6dd60/Full_DB/TBCDB_1.11.0_Vengeance_One_A_Cmangos_Story.sql.gz>.
The original mapping was extracted from that SQL dump; it is retained as a limited lookup for the optional preview.
See `app/vendor/CMaNGOS-COPYING.txt` for the database license.

# Forever assets

Native Forever map and character assets are fetched from Wowhead’s `classicplus`
asset environment. Artwork and model assets remain owned by Blizzard. The asset
URLs and map-ID provenance are recorded in `assets/forever-map-provenance.json`.
No Questie implementation or quest database is bundled.

The existing CMaNGOS item-display mapping is a legacy lookup used by the optional
3D preview; it does not establish complete Forever equipment model coverage.
