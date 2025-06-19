# OpenFrontIO

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="resources/images/OpenFrontLogoDark.svg">
    <source media="(prefers-color-scheme: light)" srcset="resources/images/OpenFrontLogo.svg">
    <img src="resources/images/OpenFrontLogo.svg" alt="OpenFrontIO Logo" width="300">
  </picture>
</p>

![Prettier Check](https://github.com/openfrontio/OpenFrontIO/actions/workflows/prettier.yml/badge.svg)
[![Crowdin](https://badges.crowdin.net/openfront-mls/localized.svg)](https://crowdin.com/project/openfront-mls)

OpenFront is an online real-time strategy game focused on territorial control and alliance building. Players compete to expand their territory, build structures, and form strategic alliances in various maps based on real-world geography.

This is a fork/rewrite of WarFront.io. Credit to https://github.com/WarFrontIO.

---

## ⚠️ Fork Notice

This repository is a fork of OpenFrontIO (**version 23.12**) and serves as the foundation for a larger MMO strategy game project called **Clash of Regions**.  
The fork retains open source licensing and integrates new long-term gameplay mechanics like persistent worlds, politics, economies, and warfare.

---

# 🌍 Clash of Regions

**Clash of Regions** is an open source MMO strategy game inspired by **Rival Regions**, **Call of War 3**, and **OpenFront.io** — forked and expanded upon from the [OpenFront.io project](https://github.com/openfrontio/OpenFrontIO).

This project transforms OpenFront's match-based world into a **persistent, long-term, political-economy driven simulation** with player-run countries, economies, and wars.

## 🎯 Project Vision

Unlike OpenFront.io which resets each match, **Clash of Regions** introduces:
- A **persistent world** with thousands of territories
- **Economy**: resource generation, trading, taxes
- **Politics**: player-governed countries, elections, and decisions
- **Military**: armies, wars, defense systems
- **Backend in Go**, client remains open-source under GPLv3 (browser-based)

---

## 📦 Backlog (Grouped by Category)

### 🧱 Core Infrastructure
- [ ] Persistent DB to store player/world state
- [ ] Remove match-based resets
- [ ] Rework WebSocket to handle long sessions
- [ ] World ticks (real-time updates)
- [ ] Player login / reconnect handling

### 🌍 World Map
- [ ] Admin1-based or custom regional map
- [ ] Ownership-based coloring
- [ ] Region hover/click events
- [ ] Map panning/zooming

### 💰 Economy
- [ ] Basic resources: gold, food, oil, population
- [ ] Production by territory
- [ ] Warehouses and buildings
- [ ] Resource transfers and trading
- [ ] Tax system

### ⚔️ Military
- [ ] Recruit troops (resource-based)
- [ ] Move armies between regions
- [ ] Battle logic (basic)
- [ ] Change ownership on conquest
- [ ] Fortifications/defense

### 🏛️ Politics
- [ ] Government types (President / Parliament)
- [ ] Voting system
- [ ] Player-created parties / alliances
- [ ] Scheduled elections
- [ ] National decisions

### 🖥️ UI / UX
- [ ] HUD with player status, resources, region info
- [ ] Building, recruiting, trading panels
- [ ] Event log (actions, attacks, decisions)
- [ ] Notification system

### 🔄 Player Interaction
- [ ] Persistent player progress
- [ ] Rejoin/resume support
- [ ] Join/create countries
- [ ] Trigger world events (e.g. disasters)

### 🎯 Optional / Post-MVP
- [ ] AI for empty regions
- [ ] Mobile support
- [ ] Localization
- [ ] Replay / event log system

---

## 🚀 Development Roadmap

### ✅ Phase 1: Persistent World Setup (2 weeks)
- Replace match system with continuous DB
- Create basic world tick loop
- Store/load player and region state
- Enable reconnecting to same session

### 🌍 Phase 2: Interactive Map (1.5 weeks)
- Render map from admin1/custom
- Connect regions with IDs
- Highlight ownership visually
- Enable zoom, pan, click, hover

### 💰 Phase 3: Economy System (2 weeks)
- Define resources
- Production logic per tick
- Manual and automatic building system
- Resource transfer mechanics

### ⚔️ Phase 4: Combat and Military (2 weeks)
- Troop recruitment UI
- Army movement logic
- Region battle system (simple first)
- Region conquest and ownership changes

### 🏛️ Phase 5: Politics and Governance (2.5 weeks)
- Electable governments
- Voting system with UI
- Country creation and party system
- Government power effects

### 🖥️ Phase 6: UI Polish (1.5 weeks)
- Player HUD with live info
- Panels for construction, army, diplomacy
- Simple notification and event log
- Interactive buttons and shortcuts

### 🌐 Phase 7: Public Playtest (1 week)
- Launch test server
- Invite testers
- Log feedback and bugs
- Balance economy and pacing

---

## 📝 License

This project uses a dual-licensing approach:

- Code in the `server/` and `core/` directory is licensed under MIT
- Client code (in the `client/` directory) is licensed under GPL v3

See [LICENSE](LICENSE) for full details.

---

## 🔒 Development Team

This project is maintained privately by a small team. External contributions are currently not accepted.

**Development Team:**
- Lead Developer
- Co-Developer / Systems Architect

Feature requests, ideas, or bug reports are welcome through issues only.

---

## 🌐 Translation

Translators are welcome! Help translate the game on [Crowdin](https://crowdin.com/project/openfront-mls).

---

## 🙏 Thanks

This project would not be possible without the efforts of the original OpenFrontIO and WarFrontIO teams. Special thanks to all contributors and community supporters.
