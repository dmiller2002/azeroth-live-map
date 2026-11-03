# Live validation on Forever 1.60.1 (69977)

This checklist is pending. Automated Lua fixtures and synthetic desktop capture do not verify a running game client.

1. Install the packaged addon into the official Forever client. Enable it and log in with Blizzard’s native UI. Confirm no Lua error appears and the HUZZAH sprite is visible.
2. Connect the desktop to the game using the OS screen picker. Move, turn, change zones and enter/leave an instance. Confirm the marker and native coordinates agree with the game; unavailable instance positions must not invent a marker.
3. Check Mulgore, Eastern Plaguelands, Redridge and Stormwind against the in-game map. Verify native Wowhead artwork and marker placement on the running build. Visit a new Forever zone and check its artwork, live player, trail and available quest pins. On map ID 2665 or a failed artwork download, confirm the labeled grid and markers. Confirm the toolbar reports the connected client’s actual version/build.
4. Without Questie, accept, progress, complete, abandon and turn in quests. Verify story text, objective counts, completion and failure flags, tracking state, and incremental updates. Keep a quest open in the native UI and confirm desktop sync never changes that selection.
5. Equip/unequip items, move/stack/sell bag items and replace a bag. Confirm equipment, inventory, quantities and durability update. Verify unsupported/restricted stats show a dash and do not stop map/equipment sync.
6. Inspect both primary professions with the Skills UI collapsed and expanded. Run `/daui guild status`. Verify names/ranks and that reading restores collapsed headers.
7. With a consenting guild member using the same addon, enable `/daui guild on` on both clients. Confirm roster, professions and positions. Disable sharing or disconnect and confirm pins disappear or expire. Do not infer precise positions from roster zones.
8. Install a Forever-compatible Questie release with its matching database. Verify supported pickup/objective/turn-in pins, including a new Forever quest with known Questie coverage.
9. Move, lock, resize and switch sprite/strip mode during capture. `/reload`, log out normally and restart; confirm saved position/theme/UI scale survive and a fresh screen-sharing selection is required.
10. Repeat launch, capture selection and clean shutdown on Windows and Linux. Cross-building Windows packages does not verify native Windows behavior.
