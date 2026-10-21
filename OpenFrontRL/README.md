# OpenFrontRL — PPO trainer for OpenFront.io (C# + TorchSharp)

Trains a neural-network player for OpenFront.io against the game's built-in nations and bots.

```
 C# (TorchSharp, GPU)                      Node (rl/server.ts, CPU, N processes)
 ┌──────────────────────────┐  stdin/out   ┌───────────────────────────────────┐
 │ PPO + actor-critic model │ ───────────▶ │ real OpenFront engine, headless   │
 │ runs on CUDA             │ ◀─────────── │ (GameRunner + Executor), K games  │
 └──────────────────────────┘ obs/reward   └───────────────────────────────────┘
```

The game engine is TypeScript, so it runs unmodified in Node worker processes (nothing in `packages/` was changed).
The C# side batches observations from all games, runs the policy on the GPU, and sends actions back.

## Setup

1. Node.js (the repo asks for 24.x) and `npm ci --ignore-scripts` in the repo root (`npm run inst`).
2. .NET 8 SDK.
3. NVIDIA GPU with a recent driver (libtorch 2.7.1 / CUDA 12.8 is bundled via NuGet, no CUDA toolkit install needed).

```bash
cd OpenFrontRL
dotnet run -c Release -- info        # should say "CUDA available: True"
```

`dotnet run` restores `TorchSharp-cuda-windows` / `TorchSharp-cuda-linux` automatically (a large, one-time download).
No GPU? Use `-p:TorchBackend=cpu` on every `dotnet` command.

## Train (headless, as fast as possible)

```bash
dotnet run -c Release -- train --out runs/v1
# or tune it
dotnet run -c Release -- train --procs 12 --envs-per-proc 2 --map world --bots 50 --difficulty Medium --out runs/v1
```

* Simulation speed is unlimited: games advance as fast as the CPUs allow. `--procs` = Node processes (one core each);
  default is cores-1. Check the CPU ceiling first with `dotnet run -c Release -- bench`.
* Progress is printed per update, and logged to `runs/v1/log.csv` (return, win rate, land share, rank, losses, KL…).
  Checkpoints: `runs/v1/latest.pt` (every `--save-every` updates) plus periodic `ckpt_<n>.pt`.
* Resume with `--resume runs/v1/latest.pt`.
* Watch a training game live with `--view 8080` → http://localhost:8080.

## Play at normal (or any) speed

```bash
dotnet run -c Release -- play --model runs/v1/latest.pt --speed 1 --view 8080
```

`--speed 1` = real time (10 ticks/s, the game's native pace); `--speed 4` = 4× faster; `--speed 0` = unlimited.
The agent decides every `--decision` ticks (default 10) in *game time*, so results are identical at every speed —
speed only changes how long the wall clock waits between decisions.

## What the agent sees / does

* **Observation**: 8-channel 32×32 density grid of the map (land, mine, free, hostile, friendly, hostile strength, my structures,
  my shoreline) + 24 scalars (troops, gold, land share, rank, attacks, unit counts, allies…) + 8 neighbour slots.
* **Actions** (factored + masked, illegal moves are never sampled): `type` ∈ {noop, attack, boat, city, port, defense post, factory,
  missile silo, SAM, warship, atom bomb, ally request, accept alliance, spawn}; `slot` (which neighbour, 0 = unclaimed land);
  `ratio` ∈ {10,25,50,75,100}% of troops; `cell` on the 32×32 grid for where to build / land / bomb / spawn.
* **Reward**: land-share gain, small bonuses for new cities/ports, +10 for winning, −2 for being eliminated, and a
  rank/land bonus if the time limit is reached. Reward is normalised by a running return std.

## Files

| Path | What |
| --- | --- |
| `rl/OpenFrontEnv.ts` | Gym-style env on top of the real engine (obs, masks, actions, reward) |
| `rl/server.ts` | Binary stdin/stdout server hosting several envs per Node process |
| `rl/viewer.ts` | Optional live map viewer |
| `OpenFrontRL/Model.cs` | Conv + MLP actor-critic, masked factored distributions |
| `OpenFrontRL/Ppo.cs` | PPO (GAE, clipping, KL early stop, LR anneal, reward scaling, checkpoints) |
| `OpenFrontRL/VecEnv.cs`, `EnvProcess.cs` | Process pool + wire protocol |
| `tests/RlEnv.test.ts` | Env tests (`npx vitest tests/RlEnv.test.ts --run`) |

## Notes

* Opponents are the built-in AI nations/bots (no self-play yet). Raise `--difficulty` as the agent improves.
* The compact (4×-downscaled) map is the default for speed; `--full-map` uses the full-size one (much slower).
* If you change action/observation layout, update `rl/protocol.ts` and `OpenFrontRL/Protocol.cs` together.
