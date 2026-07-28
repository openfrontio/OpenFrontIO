## v33 Release Notes

### Major Changes

- **Doomsday Clock** — A new battle-royale style zone gamemode. A shrinking doom zone drains troops (and warships) from doomed sides, with a 10-minute grace period and wave-based squeeze to break late-game stalemates. Now part of the public modifier rotation.
- **Ranked 2v2** — Ranked matchmaking now supports 2v2 alongside 1v1, with match cancellation for lobbies that don't fill or fully spawn.
- **Steam / desktop client** — Steam desktop authentication (SteamSDK), configurable WebSocket routing for the Electron shell, and an ad-free desktop experience.
- **Login with Google** — Sign in with a Google account and link it to an existing account.
- **Account usernames + verified badge** — Claim an account-level username (`base.suffix`, or a bare name for subscribers) and play under it with a verified badge next to your name.
- **Impassable terrain** — Mappers can now mark terrain as impassable, opening up a new class of map design. Several new maps already use it.
- **Warship veterancy** — Warships gain veterancy over their service life.
- **MIRVs are real nukes now** — MIRV warheads fly like standard nukes with per-type speeds and can be intercepted normally by SAMs. Launching a MIRV also puts the silo on cooldown.
- **Anonymous names** — A lobby setting that replaces player names with memorable, collision-proof animal names.
- **17 new maps** — including Sol, Russia, United States, Germany, China, Scandinavia and the first maps built around impassable terrain.

### ☢️ Gameplay & Balance

- Added the Doomsday Clock battle-royale zone gamemode — Zixer1
- Rebalanced the Doomsday Clock: 10-minute grace period, wave squeeze, slower troop drain, gentler-but-steeper warship attrition — Zixer1
- Doomsday Clock now decays warships alongside troops for doomed sides, and floors the drain at 5% of max instead of wiping to zero — Zixer1
- Doomsday Clock judges teams against the same bar as solo sides — Zixer1
- Doomed warships stay on patrol instead of idling at ports — Zixer1
- Added warship veterancy, with updated in-game instructions — bijx
- MIRV warheads are now standard nukes: real flight, normal SAM interception, per-type speeds — Evan
- Missile silos go on cooldown when launching a MIRV — Evan
- Added impassable terrain — FloPinguin
- Fixed minimap priority for impassable terrain pathfinding — FloPinguin
- Added a custom alliance duration lobby control — Zixer1
- Fixed pirating not being disabled when a warship's owner has no port in that body of water — TKTK123456
- Fixed transport ships targeting unreachable inland-lake shores — Navaneeth Prabha
- Fixed transport ship troop counts not updating when a hydrogen bomb hits the player — AmanorsElliot
- Fixed the rail network path length limit and re-added its tests — TKTK123456
- Fixed the factory ghost radius — TKTK123456
- Fixed non-structures being deletable — unne27
- Fixed the nuke preview showing teammate SAMs as threats — Evan
- Highlight the owner of hovered naval units — unne27
- Reduced compact map chance in 1v1 from 50% to 20% — FloPinguin
- Removed the ports-disabled modifier from public games — Evan

### 🏆 Ranked & Matchmaking

- Added 2v2 ranked matchmaking — Evan
- Cancel ranked matches that don't fill or fully spawn — Evan
- Handle matchmaking socket close codes per the API contract — Evan
- Handle ranked play limits in the client — Evan
- Keep matchmaking games out of lobby reports and salvage invalid entries — Evan
- Mint game ids on the server and randomly route create-game across workers — Evan

### 🗺️ Maps

#### New Maps

- **Sol** 🪐 — Massive map of the Solar System (by RickD004)
- **Russia** 🇷🇺 — Big-map treatment of Russia (by RickD004)
- **United States** 🇺🇸 — Built for the new impassable terrain feature (by RickD004)
- **Germany** 🇩🇪 — With state flags (by SpeakIsntThere)
- **China** 🇨🇳 (by crunchybbb)
- **Scandinavia** 🇸🇪 (by crunchybbb)
- **Baltics** (by RickD004)
- **Caspian Sea** — With team spawns (by crunchybbb)
- **Crimea** (by crunchybbb)
- **Finger Lakes** (by crunchybbb)
- **Gulf of Guinea** (by RickD004)
- **Hecate Strait** (by Liam Langford)
- **Irish Sea** (by RickD004)
- **Levant** (by RickD004)
- **Tierra del Fuego** — Featuring impassable terrain (by RickD004)
- **Branching Paths** (by NotRocketfish)
- **More than luck** (by Patrick Plays Badly)

#### Map Improvements & Fixes

- Allow mappers to specify custom tribe spawn coordinates in `info.json` — FloPinguin
- Added a tribe name themes system with custom tribes support — FloPinguin
- Multiple terrain changes and fixes across maps, plus further map changes for v33 — RickD004
- Updated map outlines (no resizing, except Oceania) and updated the Dyslexdria map — Patrick Plays Badly
- Standardized the SVGs of flags in the flags folder, plus other flag fixes — RickD004
- Added impassable terrain to the Korea map — crunchybbb
- Took v32 maps out of the "New" category to make room for v33 maps; tagged Branching Paths as new — RickD004, NotRocketfish
- Fixed a crash on the Indian Subcontinent map — blon
- Filled a landlocked lake on the NW island of Four Islands to fix port placement — blon
- Prevented AI from placing ports on small lakes — FloPinguin
- Added an Expand Maps button — bijx
- Trimmed archived map names — Ryan
- Updated the color mapping location in the map generator README — Aaron Tidwell

### 🎨 Cosmetics & Store

- Added a warship cosmetic effect (gradient/transition recolor) — Evan
- Added nuke-trail cosmetic effects with a tabbed effects picker, plus a spiral nuke trail — Evan
- Added nuke-explosion cosmetic effects with per-bomb-type shockwave customization, plus a sparkles explosion type — Evan
- Added a structures cosmetic effect (hover-shown gradient/transition recolor) — Evan
- Added the effects cosmetic category with a transport-ship trail, rendered as a gradient with an animated store swatch — Evan
- Added a search bar to the effects picker modal — Evan
- Added a crown cosmetic type, rendered above player names — Evan
- Merged the skin and effects pickers into a single lobby Cosmetics modal, and collapsed skins under one banner — Evan, Ryan
- Show plutonium and caps balances in the store header — Evan
- Added custom plutonium amount purchases with a cleaner amount UI — Evan, Ryan
- Confirm plutonium and caps purchases before charging — Evan
- Show USD-equivalent value in the cosmetic info tooltip — Evan
- Added claimable subscription rewards UI — Evan
- Restored subscriptions in the store and account modal, and added a checkmarked perk list on subscription tiles — Evan
- Specific rate-limit message on tier change, using shared dialogs for subscription flows — Evan
- Reworked the store into a popup and removed the "subscribe" / "purchase" text — Ryan
- Grouped owned cosmetic variants for performance — Josh Harris
- Fixed cosmetics blocking buttons on mobile — Luke-Dawes

### 👤 Accounts, Profiles & Stats

- Added account-level custom usernames (`base.suffix` plus premium bare names) — Evan
- Show account usernames and a verified badge on player-facing lists — Evan
- Added a verified-name toggle so you can play under your account name — Evan
- Login with Google — client UI — Josh Harris
- Show "Linked to Google" once a Google account is linked — Josh Harris
- Added a shareable player profile modal (`#modal=profile&publicID=x`), profile links and game history on profiles — Ryan
- Added a Games tab to the account modal — Ryan
- Reworked stats into a dedicated embedded stats modal, with a stats button on clan game history and backward compatibility for older games — Ryan
- Renamed "ranking" to "stats" — Ryan
- Let admins see clan tags in FFA — Ryan
- Fixed a bug when not being in a clan on mobile — Ryan
- Discord integration — Ryan
- Added marketing email consent UI (post-login prompt + account settings) — iamlewis
- Added CSV separation between names — Ryan

### 🖥️ Desktop & Steam

- Steam desktop authentication: SteamSDK, auth branch, audience config, username seeding — Josh Harris
- Exempt Steam-authenticated clients from the Turnstile siteverify — Josh Harris
- Route game WebSockets via a configurable server host for the Electron desktop client — Josh Harris
- Exempt the Electron desktop shell from loading Admiral ads — Josh Harris
- Fixed `getApiBase()` returning `https://undefined` when `API_DOMAIN` was unset — Josh Harris

### 🕵️ Anonymous Names

- Added the anonymize-names feature — Zixer1
- Memorable, collision-proof animal anonymous names — Zixer1
- Surfaced anonymous names as a lobby setting — Zixer1
- Name reveal now works by publicID during game config — Zixer1
- Fixed an anonymize-names desync by seeding the cluster-recalc offset from `id()` instead of `name()` — Evan
- Fixed the anonymous-names setting not hiding names on the map — Evan

### 📺 Featured Stream

- Added the featured stream feature — Zixer1
- Off-web exclusion, ad-free close, and keeping the stream through the lobby wait — Zixer1
- Mobile flick-to-dismiss — Zixer1
- Keep the Twitch embed at its 400x300 minimum — Zixer1

### 🧑‍🤝‍🧑 Lobby & Social

- Subscriber-hosted public lobby listing, gated on the `canCreatePublicLobbies` entitlement — Evan
- Auto-start listed lobbies after 5 minutes, surviving host modal close during auto-start — Evan
- Reuse private lobbies — MushroomLamp
- Added an allowlist for private lobbies (OFM) — Zixer1
- Replaced the leave-lobby popup with a custom popup — Ryan
- Allow mobile players to take part in the aftergame — FloPinguin
- Fixed the lobby status bar scrolling out of view when many players join — FloPinguin
- Configurable leaderboard and team stats columns — Ryan

### 🎛️ Graphics, UI & Quality of Life

- Added graphics presets, simplifying the settings behind an Advanced section — Evan
- Added terrain color settings, with live preview, and restored the default terrain colors — Vivacious Box, Evan
- Added a nuke fallout color graphics option and a structure dots toggle — Evan
- Set the structure border to territory color for the local player — Vivacious Box
- Added a black outline to the alliance icon for terrain contrast — Evan
- Update the coastline color dynamically when the ocean color changes — Berk
- Fixed the ocean color change reverting nuke-created water to land — Evan
- Replaced the small-player highlight toggle with a strength slider, moved into graphics overrides, and raised the default to 35% — Zixer1, Evan
- Standardized gradient `colorSize` to game tiles — Evan
- Fall back to a full border recompute on massive tile changes — blon
- Render the spawn overlay with instancing to support large lobbies — Evan
- Gate users without GPU-accelerated WebGL2 instead of running at ~1fps — Evan
- Capped the renderer device-pixel-ratio at 2 — Evan
- Improved spawn phase progress bar visibility and sped up the spawn-phase ring pulse — ItsTimeTooSleep, Evan
- Made train tracks visible from farther out — Evan
- Made the important events panel scrollable — Evan
- Surfaced alliance renewal and rejection events in the important-events panel — Evan
- Added a trade ship captured event with a toggle setting — Evan
- Donation received events are now blue instead of green — Evan
- Host lobby start button turns yellow during countdown — Evan
- Changed factory icons from circles to hexagons — Antonio Lentini
- Reworked `InputHandler.ts` — TKTK123456
- Added billions to the money utils — bijx
- Added an achievement medal overview — bijx
- Fixed classes for the control panel unit display and the control panel / player info gold display — JB940
- Removed the background wrap-around seam on the home page when nav is hidden — Evan
- Show a loading spinner on the account button until auth resolves — Evan
- Prevented the Google CCPA button from shifting layout — blon
- Translation updates (mls v5.8) and removed the Discord URL placeholder from translations — Aotumuri

### 📣 Ads & CrazyGames

- Gate in-game ads by adblock detection with Admiral recovery — Evan
- Removed the in-game CrazyGames banner ad — Evan
- Destroy the corner video ad when the game starts — Evan
- Keep the Playwire bottom rail below the in-game HUD so it can't cover the control panel — Evan
- CrazyGames backend login, surfacing the signed-in user — Evan
- CrazyGames fixes: guest username on logout, hidden fullscreen, in-game pop-ups, hidden clan tag input — Evan

### ⚡ Performance

- Reduced core live-memory footprint by 45% on large maps — Evan
- Cut core-sim GC churn by 75% cumulative across three passes, and added GC-churn profiling to the perf harness — Evan
- Main-thread memory harness: dropped three map-sized render buffers (−23%) — Evan
- Tick-dispatch timing harness and main-thread tick optimizations (late-game p95 −65%) — Evan
- Return the live `TileSet` from `Player.tiles()` instead of cloning — Evan
- Reuse cached TradeShip paths for motion plans — Raka Hourianto
- Cache `maxTroops` during the leaderboard update — Demonessica
- Standardized cardinal-neighbor iteration on `neighbors()` N,S,W,E order — Evan

### 🤖 Nations & Bots

- Fixed nations always attacking nuked territory instead of waiting for the correct strategy — FloPinguin
- Prevented AI from placing ports on small lakes — FloPinguin
- Added the tribe name themes system with custom tribes support — FloPinguin

### 🛠️ Server, Admin & Tooling

- Added an admin bot HTTP API for managing private games — Evan
- Added a live game stats endpoint to the admin bot API — Evan
- `kick_player` can target a publicId, including disconnected accounts — Zixer1
- Include publicID in admin-bot live stats players — Zixer1
- Per-player `killedBy`, `deathPosition` and `winner` for live standings — Zixer1
- OFM tournament: log final standings and per-kill eliminations — Zixer1
- Integrated batch `username_check` moderation into game servers — Evan
- Added an "assign to me" checkbox to issue templates — Evan
- Exempted Dependabot PRs from the PR gate, fixed the stale bot re-commenting on case-mismatched labels, and removed the PR description validation check — Evan
- Removed the Wicked Sick service-provider paragraph from the privacy policy — iamlewis

### 🔒 Security & Anti-Cheat

- Reject spawn intents after the spawn phase (anti-teleport) — iamlewis
- Prevent the client from bypassing random spawn selection — FloPinguin
- Require a strict majority in 1v1 winner-vote consensus — Josh Harris
- Don't re-challenge Turnstile on lobby reconnect — Evan
- Removed FFA collusion warnings on replay and ranked — Antonio Lentini
- Dependency security bumps — dependabot

### 🌐 Translators

_(To be filled in from Crowdin before publishing.)_

### 🍋 Misc

- Added a lemon drizzle cake recipe — Josh Harris
