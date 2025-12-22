# PR Documentation

## Branch 1: feature/dev-feature-flags-clean

**Base branch:** main

### PR Title

Add dev feature flags for local development

### PR Description

```markdown
## Summary

Adds a config-based feature flag system to disable external services (analytics, Cloudflare/Turnstile, ads, public lobbies) for local development without modifying code.

This allows developers to run the game locally without:

- Cloudflare Turnstile verification errors
- Public lobby polling noise
- Analytics/ad script dependencies

Also includes configurable dev server ports via environment variables.

## Changes

### Client-side

- **DevConfig.ts** (new): Feature flag system that loads from `config.json`
- **index.html**: Synchronously loads config.json and conditionally blocks external scripts (Turnstile, ads, analytics)
- **Main.ts**: Loads dev config on init, skips Turnstile when cloudflare feature disabled
- **PublicLobby.ts**: Waits for config load, skips lobby fetching/rendering when publicLobbies feature disabled
- **config.example.json** (new): Template for local config
- **.gitignore**: Excludes `config.json` (user's local config)

### Server-side

- **Config.ts**: Added `enablePublicGames()` to ServerConfig interface
- **DefaultConfig.ts**: Implementation reads `ENABLE_PUBLIC_GAMES` env var (defaults to true)
- **Master.ts**: Skips public game scheduling when disabled, reads `OPENFRONT_SERVER_PORT` env var
- **webpack.config.js**: Reads port env vars via dotenv, updates dev server port and proxy targets
- **TestServerConfig.ts**: Added stub method

### Dev convenience

- **scripts/dev-stop.js** (new): Script to stop dev servers
- **package.json**: Updated with dev scripts

## Usage

### Client features (config.json)

Copy `config.example.json` to `config.json` and set features to `false`:

    {
      "features": {
        "analytics": false,
        "publicLobbies": false,
        "cloudflare": false,
        "ads": false
      }
    }

### Server features (.env)

    ENABLE_PUBLIC_GAMES=false
    OPENFRONT_CLIENT_PORT=8080
    OPENFRONT_SERVER_PORT=4000

## Test plan

- [ ] Without config.json - all features enabled (default behavior unchanged)
- [ ] With config.json setting `cloudflare: false` - Turnstile skipped, no verification errors
- [ ] With config.json setting `publicLobbies: false` - no lobby polling in console
- [ ] With `ENABLE_PUBLIC_GAMES=false` in .env - server logs "Public games disabled"
- [ ] Custom ports work when env vars are set
- [ ] Verify production behavior unchanged when no config.json present

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

### Files Changed

- `src/client/DevConfig.ts` (new)
- `src/client/index.html`
- `src/client/Main.ts`
- `src/client/PublicLobby.ts`
- `src/core/configuration/Config.ts`
- `src/core/configuration/DefaultConfig.ts`
- `src/server/Master.ts`
- `webpack.config.js`
- `tests/util/TestServerConfig.ts`
- `config.example.json` (new)
- `scripts/dev-stop.js` (new)
- `package.json`
- `.gitignore`

---

## Branch 2: feature/theme-settings-ui

**Base branch:** main

### PR Title

Add settings UI improvements with light theme support

### PR Description

```markdown
## Summary

Comprehensive overhaul of the settings modal UI with:

- New Display tab with theme mode selector (Light/Dark/System)
- Collapsible setting groups with persistent state
- Light theme support with proper CSS variables
- Territory skins selector (placeholder for premium feature)
- Color palette editor (placeholder for premium feature)
- Improved layout with sticky tabs
- Dark mode button sync with settings modal

## Changes

### New Components

- **SettingGroup.ts**: Collapsible groups with localStorage persistence
- **SettingThemeMode.ts**: Light/Dark/System theme selector
- **SettingTerritorySkins.ts**: Territory skin preview and selection
- **SettingColorPalette.ts**: Color customization with presets

### Theme Support

- **Modal.ts**: Added light theme CSS variables, MutationObserver for theme detection
- **DarkModeButton.ts**: Updated to use `isDarkModeActive()` and sync via events
- **UserSettings.ts**: Added `themeMode()`, `setThemeMode()`, `isDarkModeActive()`, updated `toggleDarkMode()`

### UI Improvements

- **UserSettingModal.ts**: Reorganized with Display tab, sticky tabs, grouped settings
- **setting.css**: Tab styling with dividers, theme-aware colors
- **modal.css**: Minor fixes

### Language Files

- Removed emoji icons from setting labels (all 30+ language files)
- Added new translation keys for theme/display settings

## Test plan

- [ ] Theme persists across page refreshes
- [ ] Dark mode button on homescreen syncs with settings modal
- [ ] Light theme applies correct colors to all components
- [ ] System theme follows OS preference
- [ ] Setting groups collapse/expand and remember state
- [ ] Tabs are sticky when scrolling

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

### Files Changed

- `src/client/components/baseComponents/setting/SettingGroup.ts` (new)
- `src/client/components/baseComponents/setting/SettingThemeMode.ts` (new)
- `src/client/components/baseComponents/setting/SettingTerritorySkins.ts` (new)
- `src/client/components/baseComponents/setting/SettingColorPalette.ts` (new)
- `src/client/components/baseComponents/Modal.ts`
- `src/client/DarkModeButton.ts`
- `src/client/UserSettingModal.ts`
- `src/client/Main.ts`
- `src/core/game/UserSettings.ts`
- `src/client/styles/components/setting.css`
- `src/client/styles/components/modal.css`
- `resources/lang/*.json` (all language files - emoji removal)

---

## PR Order Recommendation

Both PRs are **independent** and can be merged in any order.

1. **`feature/dev-feature-flags-clean`** - Developer tooling, no user-facing changes
2. **`feature/theme-settings-ui`** - User-facing UI improvements

## Branch Summary

| Branch                            | Purpose                        | Status             |
| --------------------------------- | ------------------------------ | ------------------ |
| `feature/dev-feature-flags`       | Combined dev branch (all work) | Active development |
| `feature/dev-feature-flags-clean` | Clean PR for feature flags     | Ready for PR       |
| `feature/theme-settings-ui`       | Clean PR for theme/settings UI | Ready for PR       |
