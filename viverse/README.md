# VIVERSE wrapper

The page OpenFront uploads to [VIVERSE](https://www.viverse.com) (HTC's web game portal), App ID `ceen82ugqx`.

VIVERSE serves the uploaded zip from `https://ceen82ugqx.world.viverse.app/` (preview: `https://ceen82ugqx-preview.world.viverse.app/`) inside an iframe on `https://www.viverse.com`. `index.html` is a full-viewport page that frames the real game (`GAME_ORIGIN`) and bridges VIVERSE login to it. The VIVERSE login SDK only works in the frame VIVERSE embeds directly (it postMessages `window.parent`), so the SDK runs here, not in the game.

```
www.viverse.com -> ceen82ugqx.world.viverse.app (this wrapper, SDK) -> openfront.io (game)
```

## Protocol (game <-> wrapper, `postMessage`)

| Direction      | Message                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------- |
| game → wrapper | `{ type: "openfront:viverse:get-token", id: string }`                                          |
| wrapper → game | `{ type: "openfront:viverse:token", id, token: string \| null, accountId: string \| null }`    |
| game → wrapper | `{ type: "openfront:viverse:login" }` (no reply; VIVERSE runs login, then reloads the wrapper) |

- Every `get-token` gets exactly one reply. The wrapper calls `checkAuth()` per request (the SDK caches and refreshes the token). Not signed in, an SDK error or timeout, or an SDK that failed to load all give `token: null, accountId: null`.
- The wrapper only handles messages whose `event.source` is the game iframe and whose `event.origin` is `GAME_ORIGIN`. It replies with `postMessage(msg, GAME_ORIGIN)`, never `"*"`, because the token is a credential. Unknown types are ignored.

## Build

```bash
viverse/build.sh
```

This writes two zips, each with `index.html` at the root:

- `viverse/dist/openfront-viverse-prod.zip` frames `https://openfront.io` (the `GAME_ORIGIN` in `index.html`)
- `viverse/dist/openfront-viverse-test.zip` frames `https://viverse.openfront.dev`

## Upload

Upload a zip in VIVERSE Studio at https://studio.viverse.com/upload, for App ID `ceen82ugqx`.

## Test loop

1. Deploy a game branch to `viverse.openfront.dev`:
   ```bash
   gh workflow run deploy.yml --ref <branch> -f target_domain=openfront.dev -f target_host=staging -f target_subdomain=viverse
   ```
2. Upload `openfront-viverse-test.zip` to VIVERSE once.
3. After that, only redeploy the branch. The wrapper doesn't change, so it doesn't need re-uploading.

## Requirements outside this directory

- **Cloudflare `frame-ancestors`.** openfront.io and openfront.dev (including subdomains) send a Cloudflare-set `Content-Security-Policy: frame-ancestors …`. It must include `https://*.world.viverse.app https://www.viverse.com`. `frame-ancestors` checks every ancestor in the chain (www.viverse.com → wrapper → game), so both entries are needed.
- **Open item:** VIVERSE must approve external connections to our domains (openfront.io, openfront.dev) before the framed game can load on the published app.
