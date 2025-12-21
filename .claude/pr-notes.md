# PR Documentation

## Branch 1: feature/configurable-ports

**Base branch:** main

### PR Title
Add configurable dev server ports via environment variables

### PR Description
```markdown
## Summary
- Adds `OPENFRONT_CLIENT_PORT` and `OPENFRONT_SERVER_PORT` environment variables to allow customizing ports for local development
- Defaults remain unchanged (client: 9000, server: 3000)
- Useful for developers running multiple services that may conflict with default ports

## Changes
- **Master.ts**: Reads `OPENFRONT_SERVER_PORT` env var for server port
- **webpack.config.js**: Reads both env vars via dotenv, updates dev server port and all proxy targets dynamically

## Test plan
- [ ] Run `npm run dev` without env vars - should use default ports (9000, 3000)
- [ ] Set `OPENFRONT_CLIENT_PORT=8080` and `OPENFRONT_SERVER_PORT=4000` in `.env`, run `npm run dev` - should use custom ports
- [ ] Verify WebSocket proxies connect correctly to custom server port

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

### Files Changed
- `src/server/Master.ts`
- `webpack.config.js`

---

## Branch 2: feature/dev-feature-flags-pr

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

## Changes

### Client-side
- **DevConfig.ts** (new): Feature flag system that loads from `config.json`
- **Main.ts**: Loads dev config on init, skips Turnstile when cloudflare feature disabled
- **PublicLobby.ts**: Skips lobby fetching/rendering when publicLobbies feature disabled
- **config.example.json** (new): Template for local config
- **.gitignore**: Excludes `config.json` (user's local config)

### Server-side
- **Config.ts**: Added `enablePublicGames()` to ServerConfig interface
- **DefaultConfig.ts**: Implementation reads `ENABLE_PUBLIC_GAMES` env var (defaults to true)
- **Master.ts**: Skips public game scheduling when disabled
- **TestServerConfig.ts**: Added stub method

## Usage

### Client features (config.json)
Copy `config.example.json` to `config.json` and set features to `false`:
```json
{
  "features": {
    "analytics": false,
    "publicLobbies": false,
    "cloudflare": false,
    "ads": false
  }
}
```

### Server features (.env)
```bash
ENABLE_PUBLIC_GAMES=false
```

## Test plan
- [ ] Without config.json - all features enabled (default behavior unchanged)
- [ ] With config.json setting `cloudflare: false` - Turnstile skipped, no verification errors
- [ ] With config.json setting `publicLobbies: false` - no lobby polling in console
- [ ] With `ENABLE_PUBLIC_GAMES=false` in .env - server logs "Public games disabled"
- [ ] Verify production behavior unchanged when no config.json present

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

### Files Changed
- `src/client/DevConfig.ts` (new)
- `src/client/Main.ts`
- `src/client/PublicLobby.ts`
- `src/core/configuration/Config.ts`
- `src/core/configuration/DefaultConfig.ts`
- `src/server/Master.ts`
- `tests/util/TestServerConfig.ts`
- `config.example.json` (new)
- `.gitignore`

---

## PR Order Recommendation

1. **Submit `feature/configurable-ports` first** - smaller, independent change
2. **Submit `feature/dev-feature-flags-pr` second** - can be independent or build on top of ports

Both PRs are independent and can be merged in any order.
