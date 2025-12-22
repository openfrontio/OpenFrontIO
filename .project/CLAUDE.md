# Project Configuration

## Ports
Check `.project/ports.json` when adding features that require ports. Update both the JSON and `dev:stop` script in package.json.

Current ports (configured via OPENFRONT_CLIENT_PORT and OPENFRONT_SERVER_PORT env vars):
- **client**: 3090 (webpack dev server)
- **server**: 4090 (master), 4091-4093 (workers)

## Dev Commands
- `pnpm start:dev` - Start client and server
- `pnpm stop:dev` - Kill processes on dev ports

## Feature Flags
- Client: `config.json` (see `config.example.json`)
- Server: `.env` with `ENABLE_PUBLIC_GAMES=false`
