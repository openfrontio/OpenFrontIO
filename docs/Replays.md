# Replays

The replay viewer plays a finished game with the game's own renderer and
HUD, and can seek anywhere in it. The replay is made in the viewer's
browser from the game's archived record. Nothing runs on the server.

## How a replay is made

1. **Open.** Watching a finished game (from the lobby modal, or
   `#replay-viewer=<gameID>`) opens the viewer, which fetches the game's
   record from the API.
2. **Check the build.** The core is only deterministic within one build,
   so a record only replays on the build that played it. A record from
   another build is sent to that build's versioned shell,
   `replay.<domain>/<gameID>` (#4934).
3. **Process.** A worker re-runs the record with the core and encodes
   every tick. It checks every hash the live clients agreed on and stops
   at the first mismatch.
4. **Play while processing.** The worker sends the fixed header fields
   first, then new frames every few seconds (the first batch after about
   a second). Frames are only sent once a later hash has matched, so if a
   mismatch turns up partway, what the viewer already has is still the
   real game. The timeline spans the whole game from the start; the part
   not processed yet is grey, and seeking into it snaps back.
5. **Store.** Once processing finishes, the replay is kept in IndexedDB,
   so watching it again opens instantly (see [Storage](#storage)).

A 26 minute, 25 player game takes about 80 s to process in a dev build
and is stored in about 24 MB.

## Storage

| What              | How                                                 |
| ----------------- | --------------------------------------------------- |
| Where             | IndexedDB, database `openfront-replays`             |
| Key               | Game ID + build + `REPLAY_VERSION`                  |
| Size cap          | 256 MB; the least recently watched go first         |
| Chunks            | Kept as they are (already gzipped)                  |
| Nukes, dead units | Packed to binary and gzipped (`PackedEvents.ts`)    |
| Damaged copy      | Removed, and the game is processed again            |
| Other builds      | Removed on the main site, kept on `replay.<domain>` |
| No storage at all | Fine: the game is just processed every time         |

Other builds' replays are removed on the main site because their games
are watched on the versioned shells. The shells all share
`replay.<domain>`, so there they stay until the size cap needs the room.

## Code

Everything is in `src/client/replay/`.

| Folder       | What's in it                                           |
| ------------ | ------------------------------------------------------ |
| `codec/`     | The replay format: encoder, reader, field tables       |
| `processor/` | Turns a game record into a replay, checking hashes     |
| (top level)  | The viewer, playback, the renderer and HUD glue, cache |

The files to start from:

| File                            | Role                                           |
| ------------------------------- | ---------------------------------------------- |
| `codec/encode/StreamingEncoder` | Encodes one tick at a time into gzipped chunks |
| `codec/decode/ReplayReader`     | Rebuilds the game state at any frame           |
| `codec/EntitySchema`            | Player and unit fields, shared by both sides   |
| `processor/ReplayProcessor`     | Re-runs a record, checks hashes, feeds encoder |
| `LocalProcessing`               | Runs the processor in a worker                 |
| `ReplayPlayback`                | Play, pause, speed and seek                    |
| `ReplayFrameBuilder`            | Decoded frames to the renderer's `FrameData`   |
| `ReplayGameAdapter`             | Makes a frame look like `GameView` for the HUD |
| `ReplayStore`                   | The IndexedDB cache                            |
| `ReplayViewer`                  | The `<replay-viewer>` page                     |

### Changing the format

A replay never leaves the browser that made it, so there's no file
layout, only the frame encoding inside each chunk. If you change it, bump
`REPLAY_VERSION` in `codec/ReplayTypes.ts`. It's part of the store key,
and every dev build shares the build name `DEV`, so without the bump a
dev build would read replays stored in the old encoding.

The reader decodes synchronously. In the browser, where gunzip is async,
`ReplayPlayback` loads a frame's chunk (`ReplayReader.load`) before
reading it, and inflates the next chunk ahead of time.

## Trying it locally

You need a game record. Either:

- make one with `scripts/replay/record-demo.mts`, which always replays on
  your checkout, or
- save one from a real game: open `https://api.openfront.io/game/<id>` in
  a browser and save the response (Cloudflare blocks scripts). A dev
  client tries any record, but one from an older build stops at the first
  hash mismatch if the core has changed since.

```bash
GAME=dqKzit4cWu # the game's ID
mkdir -p /tmp/records && cp "$GAME.json" /tmp/records/
# The dev client expects its API on 8787. Other API calls will 404.
npx tsx scripts/replay/stub-game-api.mts /tmp/records 8787
npm run dev
```

Then open `http://localhost:9000/#replay-viewer=<gameID>`.
