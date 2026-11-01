# 3D character preview

World of Warcraft models, textures, and artwork belong to Blizzard Entertainment.
The 3D renderer and model assets are requested from Wowhead's public model CDN.
The renderer is not bundled into the app's source or installation. Internet
access and the provider's availability are required for the 3D preview.

`dist/vendor/jquery-3.7.1.min.js` is jQuery 3.7.1, copyright OpenJS Foundation
and other contributors, distributed under the MIT license. Its license notice
is retained in the file; see `dist/vendor/jquery-LICENSE.txt`.

`dist/item-models.json` contains only item IDs, display IDs, and inventory types
extracted from CMaNGOS TBC-DB's item_template table, under the supplied GPL-3.0 license.
It contains no textures or meshes. The source database is
<https://github.com/cmangos/tbc-db/blob/1c54acd200540076c3078d22a66fd417d0f6dd60/Full_DB/TBCDB_1.11.0_Vengeance_One_A_Cmangos_Story.sql.gz>.
`scripts/build_item_models.py` reproduces this file from that SQL dump.
See `dist/vendor/CMaNGOS-COPYING.txt` for the database license.
