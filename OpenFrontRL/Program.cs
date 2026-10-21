using System.Diagnostics;
using System.Globalization;
using TorchSharp;
using static TorchSharp.torch;

namespace OpenFrontRL;

public static class Program
{
    private const string Usage = @"
OpenFrontRL - PPO (TorchSharp) trainer for OpenFront.io

  dotnet run -c Release -- train [options]   train a model (headless, as fast as the CPUs allow)
  dotnet run -c Release -- play  [options]   run a trained model; --speed 1 = normal game speed
  dotnet run -c Release -- bench [options]   measure raw simulator throughput (no neural net)
  dotnet run -c Release -- info              show the torch device that would be used

Common env options
  --repo <dir>          OpenFrontIO checkout (default: auto-detect)
  --map <name>          map key, e.g. world, europe, iceland          (default world)
  --full-map            use the full-size map instead of the 4x-downscaled 'compact' one
  --bots <n>            tribe bots                                    (default 50)
  --difficulty <d>      Easy|Medium|Hard|Impossible (nation AI)       (default Medium)
  --decision <ticks>    game ticks per agent decision                 (default 10 = 1s of game time)
  --max-decisions <n>   episode length limit                          (default 600 = 10 game-minutes)
  --device <d>          auto|cuda|cpu                                 (default auto)

train options
  --procs <n>           Node simulator processes (default: cores-1)   --envs-per-proc <n> (default 2)
  --rollout <n>         steps per env per update (default 128)        --total-steps <n>   (default 50,000,000)
  --lr <x> --gamma <x> --lambda <x> --ent <x> --epochs <n> --minibatches <n>
  --out <dir>           run directory (default runs/default)          --resume <file.pt>
  --save-every <n>      checkpoint interval in updates (default 25)   --seed <n>

play options
  --model <file.pt>     checkpoint (default runs/default/latest.pt)   --episodes <n> (default 1)
  --speed <x>           1 = real time (10 ticks/s), 4 = 4x, 0 = unlimited (default 1)
  --view <port>         serve a live map viewer at http://localhost:<port> (also works with train)
  --sample              sample from the policy instead of greedy      --envs <n> parallel games (default 1)
";

    public static int Main(string[] args)
    {
        if (args.Length == 0 || args[0] is "-h" or "--help" or "help")
        {
            Console.WriteLine(Usage);
            return 0;
        }
        var cmd = args[0];
        var o = Args.Parse(args.Skip(1).ToArray());
        try
        {
            return cmd switch
            {
                "train" => Train(o),
                "play" => Play(o),
                "bench" => Bench(o),
                "info" => Info(o),
                _ => Fail($"unknown command '{cmd}'"),
            };
        }
        catch (Exception e)
        {
            Console.Error.WriteLine(e);
            return 1;
        }
    }

    private static int Fail(string msg)
    {
        Console.Error.WriteLine(msg + "\n" + Usage);
        return 2;
    }

    // ───────────────────────── helpers ─────────────────────────

    public static Device PickDevice(Args a)
    {
        var want = a.Str("device", "auto");
        bool cuda = cuda_is_available();
        return want switch
        {
            "cpu" => CPU,
            "cuda" => cuda ? CUDA : throw new InvalidOperationException(
                "--device cuda requested but CUDA is not available (need an NVIDIA GPU + driver and a build with -p:TorchBackend=cuda)"),
            _ => cuda ? CUDA : CPU,
        };
    }

    private static void WarnIfCpu(Device dev)
    {
        if (dev.type == DeviceType.CPU)
            Console.WriteLine("WARNING: training on CPU. For the GPU: install an NVIDIA driver, build without -p:TorchBackend=cpu, " +
                              "and check `dotnet run -c Release -- info` reports CUDA available.");
    }

    private static string FindRepo(Args a)
    {
        var given = a.Str("repo", "");
        if (given != "") return Path.GetFullPath(given);
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var d = dir; d != null; d = d.Parent)
            if (File.Exists(Path.Combine(d.FullName, "rl", "server.ts"))) return d.FullName;
        dir = new DirectoryInfo(Directory.GetCurrentDirectory());
        for (var d = dir; d != null; d = d.Parent)
            if (File.Exists(Path.Combine(d.FullName, "rl", "server.ts"))) return d.FullName;
        throw new DirectoryNotFoundException("could not find the OpenFrontIO repo (rl/server.ts); pass --repo <dir>");
    }

    private static EnvOptions EnvOpts(Args a) => new()
    {
        Map = a.Str("map", "world"),
        Compact = !a.Flag("full-map"),
        Bots = a.Int("bots", 50),
        Difficulty = a.Str("difficulty", "Medium"),
        Grid = a.Int("grid", 32),
        DecisionInterval = a.Int("decision", 10),
        MaxDecisions = a.Int("max-decisions", 600),
        Seed = a.Int("seed", 1),
        InstantBuild = a.Flag("instant-build"),
        Nations = a.Int("nations", -1),
    };

    private static int Info(Args a)
    {
        Console.WriteLine($"CUDA available: {cuda_is_available()}");
        if (cuda_is_available())
            Console.WriteLine($"CUDA devices: {cuda.device_count()}");
        Console.WriteLine($"Selected device: {PickDevice(a)}");
        return 0;
    }

    // ───────────────────────── commands ─────────────────────────

    private static int Train(Args a)
    {
        var dev = PickDevice(a);
        var repo = FindRepo(a);
        int cores = Environment.ProcessorCount;
        int procs = a.Int("procs", Math.Clamp(cores - 1, 1, 32));
        int per = a.Int("envs-per-proc", 2);
        Console.WriteLine($"Device: {dev} | repo: {repo}");
        WarnIfCpu(dev);
        Console.WriteLine($"Starting {procs} simulator processes x {per} games = {procs * per} parallel games...");
        using var env = new VecEnv(repo, EnvOpts(a), procs, per, a.Flag("verbose-env"), a.Int("view", 0));
        var net = new ActorCritic(env.Dims).to(dev);
        long pc = net.parameters().Sum(p => p.numel());
        Console.WriteLine($"Model parameters: {pc:N0}");
        var cfg = new PpoConfig
        {
            RolloutSteps = a.Int("rollout", 128),
            TotalSteps = a.Long("total-steps", 50_000_000),
            Epochs = a.Int("epochs", 4),
            Minibatches = a.Int("minibatches", 8),
            Lr = a.Dbl("lr", 3e-4),
            Gamma = a.Dbl("gamma", 0.995),
            Lambda = a.Dbl("lambda", 0.95),
            EntCoef = a.Dbl("ent", 0.01),
            TargetKl = a.Dbl("target-kl", 0.05),
            SaveEvery = a.Int("save-every", 25),
            OutDir = a.Str("out", "runs/default"),
            Resume = a.Str("resume", "") is { Length: > 0 } r ? r : null,
            Seed = a.Int("seed", 1),
        };
        new PpoTrainer(env, net, dev, cfg).Train();
        return 0;
    }

    private static int Play(Args a)
    {
        var dev = PickDevice(a);
        var repo = FindRepo(a);
        var opts = EnvOpts(a);
        int n = a.Int("envs", 1);
        double speed = a.Dbl("speed", 1.0);
        int episodes = a.Int("episodes", 1);
        bool greedy = !a.Flag("sample");
        var modelPath = a.Str("model", "runs/default/latest.pt");
        double msPerTick = a.Dbl("ms-per-tick", 100);

        using var env = new VecEnv(repo, opts, n, 1, a.Flag("verbose-env"), a.Int("view", 0));
        var net = new ActorCritic(env.Dims).to(dev);
        if (File.Exists(modelPath)) { net.load(modelPath); Console.WriteLine($"Loaded {modelPath}"); }
        else Console.WriteLine($"WARNING: {modelPath} not found - playing with an untrained (random) policy");
        net.eval();
        var tables = new ActionTables(dev);
        var d = env.Dims;

        env.ResetAll(opts.Seed);
        Console.WriteLine(speed > 0
            ? $"Playing at {speed}x speed: {opts.DecisionInterval * msPerTick / speed:F0} ms of wall time per decision ({opts.DecisionInterval} ticks of {msPerTick} ms)."
            : "Playing unlimited speed.");
        int done = 0; double sumFrac = 0, sumRank = 0; int wins = 0;
        int step = 0, late = 0;
        var clock = Stopwatch.StartNew();
        double nextDeadline = 0;
        var types = new long[Proto.TypeCount];
        while (done < episodes)
        {
            int[] act;
            using (var scope = NewDisposeScope())
            using (no_grad())
            {
                var sp = tensor(env.Spatial, new long[] { env.N, d.SpatialLen }, device: dev);
                var sc = tensor(env.Scalars, new long[] { env.N, d.scalars }, device: dev);
                var mk = tensor(env.Masks, new long[] { env.N, d.maskSize }, device: dev);
                var (acts, _, _) = Policy.Act(net, sp, sc, mk, d, tables, greedy);
                var flat = stack(new[] { acts.Type, acts.Slot, acts.Ratio, acts.Cell }, 1).cpu().data<long>().ToArray();
                act = flat.Select(x => (int)x).ToArray();
            }
            for (int i = 0; i < env.N; i++) types[act[i * 4]]++;
            env.Step(act);
            step++;

            if (speed > 0)
            {
                // Pace by the game time that actually elapsed (the spawn phase is many ticks in one step).
                double budgetMs = env.Ticks.Max() * msPerTick / speed;
                nextDeadline += budgetMs;
                double wait = nextDeadline - clock.Elapsed.TotalMilliseconds;
                if (wait > 1) Thread.Sleep((int)wait);
                else if (wait < -budgetMs * 2) { late++; nextDeadline = clock.Elapsed.TotalMilliseconds; }
            }

            if (step % Math.Max(1, (int)(10 / Math.Max(0.01, opts.DecisionInterval / 10.0))) == 0)
                Console.WriteLine(string.Create(CultureInfo.InvariantCulture,
                    $"[t={step * opts.DecisionInterval / 10.0,6:F0}s game] reward {env.Reward[0],7:F3}  land {env.StatTileFrac[0]:P1}"));
            for (int i = 0; i < env.N; i++)
            {
                if (!env.Done[i]) continue;
                done++; sumFrac += env.StatTileFrac[i]; sumRank += env.StatRank[i]; if (env.Won[i]) wins++;
                Console.WriteLine(string.Create(CultureInfo.InvariantCulture,
                    $"== episode {done}: {(env.Won[i] ? "WON" : "ended")} | land {env.StatTileFrac[i]:P1} | rank {env.StatRank[i]:F0} | " +
                    $"{env.StatLength[i]:F0} decisions | return {env.StatReturn[i]:F2}"));
                if (done >= episodes) break;
            }
        }
        Console.WriteLine(string.Create(CultureInfo.InvariantCulture,
            $"Summary over {done} episodes: wins {wins}, mean land {sumFrac / done:P1}, mean rank {sumRank / done:F1}"));
        if (late > 0) Console.WriteLine($"(fell behind real time {late}x - the machine could not keep up with --speed {speed})");
        var tot = types.Sum();
        Console.WriteLine("action mix: " + string.Join(" ", Enumerable.Range(0, Proto.TypeCount).Where(i => types[i] > 0)
            .Select(i => $"{Proto.TypeNames[i]}:{100.0 * types[i] / tot:F0}%")));
        return 0;
    }

    private static int Bench(Args a)
    {
        var repo = FindRepo(a);
        int procs = a.Int("procs", Math.Clamp(Environment.ProcessorCount - 1, 1, 32));
        int per = a.Int("envs-per-proc", 2);
        int steps = a.Int("steps", 100);
        using var env = new VecEnv(repo, EnvOpts(a), procs, per, a.Flag("verbose-env"));
        env.ResetAll(1);
        var d = env.Dims;
        var rng = new Random(1);
        var act = new int[env.N * 4];
        var sw = Stopwatch.StartNew();
        for (int s = 0; s < steps; s++)
        {
            for (int i = 0; i < env.N; i++)
            {
                // pick random legal actions straight from the masks
                int mo = i * d.maskSize;
                int type = PickMasked(env.Masks, mo, d.numTypes, rng);
                int slot = PickMasked(env.Masks, mo + d.numTypes + (type == Proto.AllyRequest ? d.numSlots : 0), d.numSlots, rng);
                int kind = (int)Proto.CellKindOfType[type];
                int cell = PickMasked(env.Masks, mo + d.MaskCellOffset + kind * d.Cells, d.Cells, rng);
                act[i * 4] = type; act[i * 4 + 1] = slot; act[i * 4 + 2] = rng.Next(d.numRatios); act[i * 4 + 3] = cell;
            }
            env.Step(act);
        }
        double secs = sw.Elapsed.TotalSeconds;
        Console.WriteLine(string.Create(CultureInfo.InvariantCulture,
            $"{env.N} games on {procs} processes: {steps * env.N / secs:F0} decisions/s = {steps * env.N * EnvOpts(a).DecisionInterval / secs:F0} game ticks/s " +
            $"({steps * env.N * EnvOpts(a).DecisionInterval / secs / 10:F0}x real time)"));
        return 0;
    }

    private static int PickMasked(byte[] m, int off, int n, Random rng)
    {
        int cnt = 0;
        for (int i = 0; i < n; i++) if (m[off + i] != 0) cnt++;
        if (cnt == 0) return 0;
        int k = rng.Next(cnt);
        for (int i = 0; i < n; i++) if (m[off + i] != 0 && k-- == 0) return i;
        return 0;
    }
}

public sealed class Args
{
    private readonly Dictionary<string, string> _kv = new();
    public static Args Parse(string[] argv)
    {
        var a = new Args();
        for (int i = 0; i < argv.Length; i++)
        {
            if (!argv[i].StartsWith("--")) throw new ArgumentException($"unexpected argument '{argv[i]}'");
            var key = argv[i][2..];
            if (i + 1 < argv.Length && !argv[i + 1].StartsWith("--")) a._kv[key] = argv[++i];
            else a._kv[key] = "true";
        }
        return a;
    }
    public string Str(string k, string def) => _kv.TryGetValue(k, out var v) ? v : def;
    public int Int(string k, int def) => _kv.TryGetValue(k, out var v) ? int.Parse(v, CultureInfo.InvariantCulture) : def;
    public long Long(string k, long def) => _kv.TryGetValue(k, out var v) ? long.Parse(v.Replace(",", "").Replace("_", ""), CultureInfo.InvariantCulture) : def;
    public double Dbl(string k, double def) => _kv.TryGetValue(k, out var v) ? double.Parse(v, CultureInfo.InvariantCulture) : def;
    public bool Flag(string k) => _kv.TryGetValue(k, out var v) && v != "false";
}
