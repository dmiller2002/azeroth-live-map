# CurseForge release setup

The GitHub repository is configured to build a **WoW Forever addon** independently of the Electron desktop application. This setup does not create a CurseForge project or submit an upload by itself.

## First submission

1. Create a **World of Warcraft addon** project in CurseForge’s author dashboard, named **Drunks Azeroth UI - Forever**. Select the relevant map/quest categories and the Forever game version offered by the dashboard.
2. Set its Source URL to `https://github.com/dmiller2002/azeroth-live-map` and issue tracker to `https://github.com/dmiller2002/azeroth-live-map/issues`. The addon code lives in `addon/AzerothLiveMap/`.
3. Describe that the addon supplies data to the separate free desktop companion, linked from GitHub Releases. Explain the visible pixel signal, user-selected capture, and optional Questie/guild features. Use the addon README as the basis for the description.
4. Choose your project license in the dashboard. No new open-source license has been granted by this conversion. Third-party desktop lookup/library licenses remain in `THIRD_PARTY_NOTICES.md`; those desktop files do not ship in the addon ZIP.
5. Build with `npm run package:addon`, then run `python3 scripts/validate_addon_zip.py app/DrunksAzerothUI.zip`. Upload **that addon ZIP**, not the source ZIP, Windows installer, Linux archive or GitHub auto-generated source archive. Follow CurseForge’s project/file review process.

The ZIP contains one `AzerothLiveMap/` folder with its TOC, declared Lua files, texture and install README. Questie is optional and is not bundled. The desktop application remains a separate GitHub download.

## GitHub configuration after creating the project

In this repository’s **Settings → Secrets and variables → Actions**:

- Set repository **variable** `CURSEFORGE_PROJECT_ID` to the numeric ID from your CurseForge project’s About Project box.
- Set repository **secret** `CF_API_TOKEN` to an author upload API token. Do not commit it to a file or put it in the issue tracker.

`.pkgmeta` excludes desktop code, app assets, dependency manifests, tests, scripts, docs and old builds. It flattens `addon/AzerothLiveMap/` into the single install folder, declares Questie as optional, and supplies `CHANGELOG.md`. The release workflow pins **BigWigsMods/packager v2.6.1**, which supports Forever; `-g forever` selects the appropriate CurseForge flavor from the TOC. No exact client build is embedded into the workflow.

The project ID is passed via `-p`, so no guessed or placeholder `X-Curse-Project-ID` is committed. You may add the real numeric ID to the TOC later; keep it consistent with the repository variable.

## Release steps

1. Complete live validation in `FOREVER_VALIDATION.md`. Update the addon/desktop version and `CHANGELOG.md`. Update the TOC `Interface` only when the client’s actual addon interface changes; an ordinary build-number change does not require that edit.
2. Commit the release and create an annotated **`addon-v1.0.0-beta1`** tag (use your current version). Push it to GitHub. Tags containing `alpha` or `beta` are classified accordingly by the packager; an unqualified version tag is a release.
3. The **Forever addon / CurseForge** workflow runs tests, builds without uploading, validates the archive, and saves it as a GitHub Actions artifact. Inspect/download the artifact.
4. When ready to upload, run that workflow manually from Actions, enter the existing `addon-v*` tag and enable **publish**. The workflow verifies the project ID/token and sends the validated addon to CurseForge. Token values never appear in logs.

Tag pushes alone do not upload to CurseForge. The workflow uses the same packaging configuration for dry runs and publishing. `CF_API_TOKEN` authorizes the upload, but CurseForge still controls project eligibility, supported game versions and moderation. A successful local dry run does not verify credentials or project approval.

References: [BigWigs packager documentation](https://github.com/BigWigsMods/packager), [Forever-supporting packager releases](https://github.com/BigWigsMods/packager/releases), [CurseForge addon support](https://support.curseforge.com/support/solutions/articles/9000198422-addons-faq).
