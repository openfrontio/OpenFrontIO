# Current Tasks

## Game Presets Feature (Planned)

### Goal
Add quick-pick / settings templates to make it easier to start games with saved settings.

### Features
- Built-in presets (e.g., "Peaceful World" - 200 bots, World map, no nukes)
- Save current settings as custom preset
- Load preset to populate all settings
- Import/Export presets as JSON for backup and sharing

### Git Strategy
1. Create `feature/game-presets` from `main` (clean, PR-ready)
2. Implement presets feature there
3. Merge into `feature/local-dev-setup` to use locally
4. When ready for PR, `feature/game-presets` stays clean

### Blockers
- Need to verify `main` branch runs without our local-dev fixes
- Identify which fixes from `local-dev-setup` are bugs vs local-only needs

---

## Investigate Main Branch Issues

### Changes we made in local-dev-setup that might be bugs in main:
1. **PlayerInfoOverlay.ts** - Fixed lit import path (`lit-html/directives/ref.js` → `lit/directives/ref.js`)
   - This looks like a real bug that should be upstreamed

2. **tsconfig.json** - Added `skipLibCheck: true` and `types: ["jest"]`
   - May be needed for compilation

### Changes that are local-dev only:
1. **Config.ts** + feature flags - Disable analytics, cloudflare, ads, public lobbies
2. **index.html** - Commented out external scripts
3. **Main.ts** - Config loading, Turnstile skip when disabled
4. **PublicLobby.ts** - Feature flag check
5. **package.json** - npm → pnpm scripts
6. **.env** - ENABLE_PUBLIC_GAMES=false
7. **InputHandler.ts** - Shift+drag reserved, toggleView keybind change

### Next Steps
1. Switch to main branch
2. Try running `npm install && npm run dev`
3. Document what errors occur
4. Determine if PlayerInfoOverlay fix should be PR'd separately
