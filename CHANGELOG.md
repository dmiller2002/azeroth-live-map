# Desktop and addon 1.0.5 — 2026-11-25

- Cut the addon's CPU use. Bags, bank, character, guild roster, quest log and
  quest pins are rescanned after the game events that change them (at most
  every 0.5–2 seconds), with slow fallbacks of 6–60 seconds, instead of every
  1–2 seconds regardless.
- Stop republishing every cached bank slot each second while the bank is
  closed; read the bank every second only while it is open.
- Clean each Questie quest title once instead of once per map pin, and cache
  the realm and character name used for guild roster keys.
- Make each sync update about 3× cheaper in Lua: bits come from a lookup table
  and the sprite's carrier colours are worked out once per animation frame.
- Add `/daui cpu [seconds]`, which measures the addon for a few seconds and
  lists the cost of each part.

The data sent is unchanged, so desktop 1.0.4 can read addon 1.0.5. Update the
addon and `/reload`. Bag, gear and quest changes reach the companion as before;
changes that fire no game event can take up to the fallback interval.

# Desktop and addon 1.0.4 — 2026-11-25

- Draw the sync strip and sprite on exact screen pixels. Each bit now covers
  whole physical pixels with crisp edges at any resolution or UI scale, so the
  signal can be smaller. `/daui size` now sets real screen pixels (2–24); the
  smallest allowed size depends on your resolution.
- Move your saved 1.0.3 position and size over once, so the strip stays where
  you left it after updating.
- Redraw only the bits that changed instead of recoloring every cell 20 times
  a second (up to ~960 texture updates each time). The hidden strip behind the
  sprite is no longer recolored at all.
- Keep the sprite and data rows click-through while unlocked, so an overlay
  placed over the minimap cannot block its tracking button. Move it with the
  drag handle shown by `/daui unlock`.
- Clearer internals: a table-driven feed schedule and a tidier quest stream,
  with no change to the data sent.

Desktop 1.0.3 can read addon 1.0.4. Update the addon and `/reload`. Live
Forever validation of the click-through fix is still pending.

# Desktop and addon 1.0.3 — 2026-11-07

- Rename Bags to Bag/bank and display native personal/account bank tabs,
  item details, stack quantities, empty slots, and used/free capacity.
- Refresh bank contents while the bank is open. Keep a saved snapshot per
  character and realm and label closed-bank contents with their last-seen time.
- Give bank data its own incremental stream, preserving bag/quest sync bandwidth.
- Sort the guild roster by Member, Status, Primary professions, or Location.
  Click again to reverse the order; keep the selected sort during live updates,
  filtering and relaunches. Unshared professions and unavailable locations stay last.
- Move the realm from the character details line into the name heading.

Bank sync requires both desktop and addon 1.0.3. Update the addon and `/reload`,
then visit the bank to record its contents. Live Forever validation is pending.

# Desktop and addon 1.0.2 — 2026-11-07

- Read native map rectangles and parent relationships from Forever instead of
  using hit regions traced from older artwork.
- Project player positions, quest markers, guild pins, and recent trails onto
  continent and world views. Keep overview artwork fully visible by default.
- Add a saved Quest helper selector above the map: WoW Forever or Questie.
- Sync Blizzard's accepted-quest POIs, next waypoints, and turn-in markers
  independently of Questie without changing the in-game map or quest selection.
- Preserve both helper feeds while switching, and show the selected provider's
  status and quest-reader marker availability.

Both desktop and addon 1.0.2 are required for the native map/helper features.
Live Forever validation is still pending; automated checks use synthetic APIs.

# Desktop 1.0.1 — 2026-11-07

- Add companion update controls under What's new, with manual checks, download
  progress, and explicit restart/install for packaged Windows and Linux copies.
- Update Windows ZIP folders through the installer; install Linux updates into
  a managed AppImage and keep existing shortcuts opening the newer copy.
- Configure GitHub update manifests and verify downloads before installation.
- Add a visible Collapse sidebar button and Show sidebar control, retaining
  connection access and remembering the choice across launches.
- Resolve equipment appearances from Forever item records instead of the
  legacy database; omit unverified models rather than displaying incorrect gear.
- Prevent delayed gear lookups from restoring an older outfit, clear unequipped
  items promptly, and add Refresh gear to retry missing appearances.
- Start and reset the character preview at the renderer's front-facing angle.

# Addon 1.0.1 — CurseForge package

- Version the Forever addon package for CurseForge submission.
- Clarify the addon version and compatibility with companion 1.0.0.
- Retain the existing addon behavior, commands, and saved settings.

Desktop sidebar, model-preview, and updater changes are distributed separately
with the companion application.

# 1.0.0 — WoW Forever Edition

- Port the addon to Blizzard's official Forever client and interface 16001.
- Read native quest stories, objectives, watch state, completion and failure.
- Support Forever profession records while preserving collapsed skill headers.
- Handle restricted/unavailable map positions and character stats without
  interrupting the other data streams.
- Send the running client's race/class names and game version/build to the
  companion; no exact build number is required.
- Retain `/daui` and `/alm` commands, saved sprite placement, optional guild
  sharing and the existing addon folder/SavedVariables name.
- Update the desktop to native Wowhead Forever artwork and character assets,
  Forever item links, and visible WoW Forever Edition branding.

Live validation on the release client remains pending. The desktop application
is downloaded separately from GitHub Releases.
