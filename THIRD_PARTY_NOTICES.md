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
The original mapping was extracted from that SQL dump and is retained for provenance;
the character preview no longer uses it to resolve equipment appearances.
See `app/vendor/CMaNGOS-COPYING.txt` for the database license.

# Forever assets

Native Forever map and character assets are fetched from Wowhead’s `classicplus`
asset environment. Artwork and model assets remain owned by Blizzard. The asset
URLs and map-ID provenance are recorded in `assets/forever-map-provenance.json`.
No Questie implementation or quest database is bundled.

Equipment display IDs and inventory types are fetched from Wowhead's public
Forever item XML records. Unavailable item records or model assets are omitted
from the preview. The retained CMaNGOS mapping is not a fallback for these records.
