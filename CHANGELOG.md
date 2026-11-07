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
