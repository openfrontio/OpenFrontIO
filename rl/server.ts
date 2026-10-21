/**
 * Headless OpenFront env server. Hosts N independent games in one Node process
 * and talks to the C# trainer over stdin/stdout with length-prefixed frames.
 *
 * Frame:   uint32 LE length | uint8 cmd | payload          (request)
 *          uint32 LE length | payload                      (response)
 *
 *  Init  payload = JSON {numEnvs, envOffset, options}   -> JSON {dims, msPerTick}
 *  Reset payload = int32 envIdx, int32 seed (-1 = auto) -> obs block
 *  Step  payload = numEnvs * (int32 type, slot, ratio, cell)
 *                                                       -> numEnvs * step block
 *  step block = obs block | f32 reward | u8 flags | f32[4] stats
 *     flags: bit0 done, bit1 won; bytes 5-6 = u16 ticks advanced   (on done the env is auto-reset and the
 *     obs is the first observation of the next episode)
 *     stats: tileFraction, rank, length, return   (valid when done)
 *  obs block  = f32[C*G*G] spatial | f32[S] scalars | u8[maskSize] masks
 *
 * stdout carries ONLY protocol bytes; all logging goes to stderr.
 */
import { Cmd } from "./protocol";
import { DEFAULT_ENV_OPTIONS, EnvOptions, OpenFrontEnv } from "./OpenFrontEnv";
import { startViewer } from "./viewer";

// Engine code logs with console.log/debug; keep stdout clean for the protocol.
console.log = (...a: unknown[]) => console.error(...a);
console.info = console.log;
console.debug = () => {};
console.warn = () => {};

let envs: OpenFrontEnv[] = [];
let spatialLen = 0;
let scalarLen = 0;
let maskLen = 0;
let obsBytes = 0;
let stepBytes = 0;

function writeFrame(payload: Buffer): Promise<void> {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return new Promise((resolve, reject) => {
    process.stdout.write(Buffer.concat([header, payload]), (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

function writeObs(env: OpenFrontEnv, buf: Buffer, off: number): void {
  const spatial = new Float32Array(buf.buffer, buf.byteOffset + off, spatialLen);
  const scalars = new Float32Array(buf.buffer, buf.byteOffset + off + spatialLen * 4, scalarLen);
  const masks = new Uint8Array(buf.buffer, buf.byteOffset + off + (spatialLen + scalarLen) * 4, maskLen);
  env.observe(spatial, scalars, masks);
}

async function handle(cmd: Cmd, payload: Buffer): Promise<void> {
  switch (cmd) {
    case Cmd.Init: {
      const cfg = JSON.parse(payload.toString("utf8")) as {
        numEnvs: number;
        envOffset: number;
        options: Partial<EnvOptions>;
        viewerPort?: number;
      };
      const options = { ...DEFAULT_ENV_OPTIONS, ...cfg.options };
      envs = [];
      for (let i = 0; i < cfg.numEnvs; i++) {
        envs.push(new OpenFrontEnv(options, cfg.envOffset + i));
      }
      if (cfg.viewerPort) startViewer(envs[0], cfg.viewerPort);
      const d = envs[0].dims;
      spatialLen = d.channels * d.grid * d.grid;
      scalarLen = d.scalars;
      maskLen = d.maskSize;
      // 4-byte align so Float32Array views are legal: pad obs to a multiple of 4.
      obsBytes = (spatialLen + scalarLen) * 4 + ((maskLen + 3) & ~3);
      stepBytes = obsBytes + 4 + 4 + 16;
      await writeFrame(
        Buffer.from(JSON.stringify({ dims: d, msPerTick: 100, obsBytes, stepBytes })),
      );
      return;
    }
    case Cmd.Reset: {
      const idx = payload.readInt32LE(0);
      const seed = payload.readInt32LE(4);
      const env = envs[idx];
      await env.reset(seed < 0 ? undefined : seed);
      const out = Buffer.alloc(obsBytes);
      writeObs(env, out, 0);
      await writeFrame(out);
      return;
    }
    case Cmd.Step: {
      const out = Buffer.alloc(stepBytes * envs.length);
      for (let i = 0; i < envs.length; i++) {
        const env = envs[i];
        const o = i * 16;
        const res = env.step(
          payload.readInt32LE(o),
          payload.readInt32LE(o + 4),
          payload.readInt32LE(o + 8),
          payload.readInt32LE(o + 12),
        );
        let done = res.done;
        let flagsExtra = 0;
        if (env.error()) {
          console.error(`[env ${env.envIndex}] fatal: ${env.error()}`);
          done = true;
        }
        const base = i * stepBytes;
        // Stats first (before auto-reset replaces the game).
        const tail = base + obsBytes;
        out.writeFloatLE(res.reward, tail);
        out.writeUInt8((done ? 1 : 0) | (res.won ? 2 : 0) | flagsExtra, tail + 4);
        out.writeUInt16LE(Math.min(65535, res.ticks), tail + 5);
        out.writeFloatLE(res.stats.tileFraction, tail + 8);
        out.writeFloatLE(res.stats.rank, tail + 12);
        out.writeFloatLE(res.stats.length, tail + 16);
        out.writeFloatLE(res.stats.ret, tail + 20);
        if (done) await env.reset();
        writeObs(env, out, base);
      }
      await writeFrame(out);
      return;
    }
    case Cmd.Info: {
      await writeFrame(Buffer.from(JSON.stringify(envs.map((e) => e.info()))));
      return;
    }
    case Cmd.Close:
      process.exit(0);
  }
}

// ── stdin framing ──
let pending = Buffer.alloc(0);
let chain: Promise<void> = Promise.resolve();
process.stdin.on("data", (chunk: Buffer) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const len = pending.readUInt32LE(0);
    if (pending.length < 4 + len) break;
    const cmd = pending.readUInt8(4) as Cmd;
    const payload = Buffer.from(pending.subarray(5, 4 + len));
    pending = pending.subarray(4 + len);
    chain = chain.then(() => handle(cmd, payload)).catch((e) => {
      console.error("server error:", e);
      process.exit(1);
    });
  }
});
process.stdin.on("end", () => process.exit(0));
