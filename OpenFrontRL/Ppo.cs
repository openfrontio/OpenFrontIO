using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using TorchSharp;
using TorchSharp.Modules;
using static TorchSharp.torch;

namespace OpenFrontRL;

public sealed class PpoConfig
{
    public int RolloutSteps { get; set; } = 128;
    public long TotalSteps { get; set; } = 50_000_000;
    public int Epochs { get; set; } = 4;
    public int Minibatches { get; set; } = 8;
    public double Lr { get; set; } = 3e-4;
    public double Gamma { get; set; } = 0.995;
    public double Lambda { get; set; } = 0.95;
    public double ClipCoef { get; set; } = 0.2;
    public double EntCoef { get; set; } = 0.01;
    public double VfCoef { get; set; } = 0.5;
    public double MaxGradNorm { get; set; } = 0.5;
    public double TargetKl { get; set; } = 0.05;
    public int SaveEvery { get; set; } = 25;
    public string OutDir { get; set; } = "runs/default";
    public string? Resume { get; set; }
    public int Seed { get; set; } = 1;
}

/// <summary>Running mean/std (Welford, batched) for reward scaling.</summary>
public sealed class RunningStat
{
    public double Mean, Var = 1, Count = 1e-4;
    public void Update(ReadOnlySpan<double> x)
    {
        if (x.Length == 0) return;
        double bm = 0; foreach (var v in x) bm += v; bm /= x.Length;
        double bv = 0; foreach (var v in x) bv += (v - bm) * (v - bm); bv /= x.Length;
        double delta = bm - Mean, tot = Count + x.Length;
        Mean += delta * x.Length / tot;
        double m2 = Var * Count + bv * x.Length + delta * delta * Count * x.Length / tot;
        Var = m2 / tot;
        Count = tot;
    }
}

public sealed class PpoTrainer
{
    private readonly VecEnv _env;
    private readonly ActorCritic _net;
    private readonly Device _dev;
    private readonly PpoConfig _cfg;
    private readonly Dims _d;
    private readonly ActionTables _tables;
    private readonly optim.Optimizer _opt;
    private readonly RunningStat _retStat = new();
    private readonly double[] _discRet;

    public PpoTrainer(VecEnv env, ActorCritic net, Device dev, PpoConfig cfg)
    {
        _env = env; _net = net; _dev = dev; _cfg = cfg; _d = env.Dims;
        _tables = new ActionTables(dev);
        _opt = optim.Adam(net.parameters(), lr: cfg.Lr, eps: 1e-5);
        _discRet = new double[env.N];
    }

    private Tensor ToDevice(float[] a, params long[] shape) => tensor(a, shape, device: _dev);
    private Tensor ToDevice(byte[] a, params long[] shape) => tensor(a, shape, device: _dev);

    public void Train()
    {
        Directory.CreateDirectory(_cfg.OutDir);
        manual_seed(_cfg.Seed);
        int T = _cfg.RolloutSteps, N = _env.N;
        long SL = _d.SpatialLen, S = _d.scalars, M = _d.maskSize;
        int batch = T * N;
        long startUpdate = 0, globalStep = 0;

        if (_cfg.Resume != null && File.Exists(_cfg.Resume))
        {
            _net.load(_cfg.Resume);
            var metaPath = Path.ChangeExtension(_cfg.Resume, ".json");
            if (File.Exists(metaPath))
            {
                var meta = JsonSerializer.Deserialize<Dictionary<string, double>>(File.ReadAllText(metaPath))!;
                startUpdate = (long)meta.GetValueOrDefault("update");
                globalStep = (long)meta.GetValueOrDefault("steps");
                _retStat.Mean = meta.GetValueOrDefault("retMean"); _retStat.Var = meta.GetValueOrDefault("retVar", 1);
                _retStat.Count = meta.GetValueOrDefault("retCount", 1e4);
            }
            Console.WriteLine($"Resumed from {_cfg.Resume} (update {startUpdate}, {globalStep:N0} steps)");
        }

        // Rollout storage lives on the compute device.
        using var bufSpatial = zeros(new long[] { T, N, SL }, device: _dev);
        using var bufScalars = zeros(new long[] { T, N, S }, device: _dev);
        using var bufMasks = zeros(new long[] { T, N, M }, ScalarType.Byte, _dev);
        using var bufAct = zeros(new long[] { T, N, 4 }, ScalarType.Int64, _dev);
        using var bufLogp = zeros(new long[] { T, N }, device: _dev);
        using var bufVal = zeros(new long[] { T, N }, device: _dev);
        var rewards = new float[T * N];
        var dones = new float[T * N];
        var types = new long[Proto.TypeCount];

        _env.ResetAll(_cfg.Seed * 1000);
        long totalUpdates = Math.Max(1, _cfg.TotalSteps / batch);
        var logPath = Path.Combine(_cfg.OutDir, "log.csv");
        if (!File.Exists(logPath))
            File.WriteAllText(logPath, "update,steps,sps,ep_return,win_rate,tile_frac,rank,ep_len,pg_loss,v_loss,entropy,kl,clipfrac,lr\n");

        // Episode statistics since the last log line.
        var epRet = new List<double>(); var epWin = new List<double>(); var epFrac = new List<double>();
        var epRank = new List<double>(); var epLen = new List<double>();
        var sw = Stopwatch.StartNew();
        double envSec = 0, nnSec = 0;

        for (long update = startUpdate + 1; update <= totalUpdates; update++)
        {
            double lr = _cfg.Lr * (1.0 - (double)(update - 1) / totalUpdates);
            foreach (var g in _opt.ParamGroups) g.LearningRate = lr;
            Array.Clear(types);
            var rolloutSw = Stopwatch.StartNew();

            for (int t = 0; t < T; t++)
            {
                var nn = Stopwatch.StartNew();
                int[] act;
                using (var scope = NewDisposeScope())
                using (no_grad())
                {
                    var sp = ToDevice(_env.Spatial, N, SL);
                    var sc = ToDevice(_env.Scalars, N, S);
                    var mk = ToDevice(_env.Masks, N, M);
                    var (a, logp, value) = Policy.Act(_net, sp, sc, mk, _d, _tables, greedy: false);
                    bufSpatial.select(0, t).copy_(sp);
                    bufScalars.select(0, t).copy_(sc);
                    bufMasks.select(0, t).copy_(mk);
                    bufLogp.select(0, t).copy_(logp);
                    bufVal.select(0, t).copy_(value);
                    var packed = stack(new[] { a.Type, a.Slot, a.Ratio, a.Cell }, 1);
                    bufAct.select(0, t).copy_(packed);
                    var flat = packed.cpu().data<long>().ToArray();
                    act = new int[N * 4];
                    for (int i = 0; i < act.Length; i++) act[i] = (int)flat[i];
                    for (int i = 0; i < N; i++) types[act[i * 4]]++;
                }
                nnSec += nn.Elapsed.TotalSeconds;

                var es = Stopwatch.StartNew();
                _env.Step(act);
                envSec += es.Elapsed.TotalSeconds;

                for (int i = 0; i < N; i++)
                {
                    // reward scaling by running std of the discounted return
                    _discRet[i] = _discRet[i] * _cfg.Gamma + _env.Reward[i];
                    rewards[t * N + i] = _env.Reward[i];
                    dones[t * N + i] = _env.Done[i] ? 1f : 0f;
                    if (_env.Done[i])
                    {
                        _discRet[i] = 0;
                        epRet.Add(_env.StatReturn[i]); epWin.Add(_env.Won[i] ? 1 : 0);
                        epFrac.Add(_env.StatTileFrac[i]); epRank.Add(_env.StatRank[i]); epLen.Add(_env.StatLength[i]);
                    }
                }
                _retStat.Update(_discRet);
            }
            globalStep += batch;

            // ── advantages (GAE) ──
            double std = Math.Sqrt(_retStat.Var + 1e-8);
            for (int i = 0; i < rewards.Length; i++) rewards[i] = (float)Math.Clamp(rewards[i] / std, -10, 10);
            double pgSum = 0, vlSum = 0, entSum = 0, klSum = 0, clipSum = 0; int nMb = 0;

            using (var scope = NewDisposeScope())
            {
                Tensor lastValue;
                using (no_grad())
                    lastValue = Policy.Act(_net, ToDevice(_env.Spatial, N, SL), ToDevice(_env.Scalars, N, S),
                        ToDevice(_env.Masks, N, M), _d, _tables, true).value;
                var rew = ToDevice(rewards, T, N);
                var don = ToDevice(dones, T, N);
                var adv = zeros(new long[] { T, N }, device: _dev);
                var lastGae = zeros(new long[] { N }, device: _dev);
                for (int t = T - 1; t >= 0; t--)
                {
                    var nextNonTerm = 1f - don.select(0, t);
                    var nextV = t == T - 1 ? lastValue : bufVal.select(0, t + 1);
                    var delta = rew.select(0, t) + (float)_cfg.Gamma * nextV * nextNonTerm - bufVal.select(0, t);
                    lastGae = delta + (float)(_cfg.Gamma * _cfg.Lambda) * nextNonTerm * lastGae;
                    adv.select(0, t).copy_(lastGae);
                }
                var ret = adv + bufVal;

                var fSpatial = bufSpatial.view(batch, SL);
                var fScalars = bufScalars.view(batch, S);
                var fMasks = bufMasks.view(batch, M);
                var fAct = bufAct.view(batch, 4);
                var fLogp = bufLogp.view(batch);
                var fAdv = adv.view(batch);
                var fRet = ret.view(batch);

                int mbSize = batch / _cfg.Minibatches;
                bool stop = false;
                for (int epoch = 0; epoch < _cfg.Epochs && !stop; epoch++)
                {
                    using var perm = randperm(batch, device: _dev);
                    for (int s = 0; s + mbSize <= batch; s += mbSize)
                    {
                        using var mbScope = NewDisposeScope();
                        var idx = perm.narrow(0, s, mbSize);
                        var mbAct = fAct.index_select(0, idx);
                        var a = new Actions(mbAct.select(1, 0), mbAct.select(1, 1), mbAct.select(1, 2), mbAct.select(1, 3));
                        var (newLogp, ent, newVal) = Policy.Evaluate(
                            _net, fSpatial.index_select(0, idx), fScalars.index_select(0, idx),
                            fMasks.index_select(0, idx), a, _d, _tables);
                        var logRatio = newLogp - fLogp.index_select(0, idx);
                        var ratio = logRatio.exp();
                        var mbAdv = fAdv.index_select(0, idx);
                        mbAdv = (mbAdv - mbAdv.mean()) / (mbAdv.std() + 1e-8f);
                        var pg1 = -mbAdv * ratio;
                        var pg2 = -mbAdv * ratio.clamp(1 - (float)_cfg.ClipCoef, 1 + (float)_cfg.ClipCoef);
                        var pgLoss = maximum(pg1, pg2).mean();

                        var mbRet = fRet.index_select(0, idx);
                        var vLoss = 0.5f * (newVal - mbRet).pow(2).mean();
                        var entLoss = ent.mean();
                        var loss = pgLoss - (float)_cfg.EntCoef * entLoss + (float)_cfg.VfCoef * vLoss;

                        _opt.zero_grad();
                        loss.backward();
                        nn.utils.clip_grad_norm_(_net.parameters(), _cfg.MaxGradNorm);
                        _opt.step();

                        using (no_grad())
                        {
                            var approxKl = ((ratio - 1) - logRatio).mean().item<float>();
                            klSum += approxKl;
                            clipSum += ((ratio - 1).abs() > (float)_cfg.ClipCoef).to(ScalarType.Float32).mean().item<float>();
                        }
                        pgSum += pgLoss.item<float>(); vlSum += vLoss.item<float>(); entSum += entLoss.item<float>();
                        nMb++;
                    }
                    if (_cfg.TargetKl > 0 && klSum / Math.Max(1, nMb) > _cfg.TargetKl) stop = true;
                }
            }

            // ── logging ──
            double dt = sw.Elapsed.TotalSeconds;
            double sps = batch / Math.Max(1e-6, rolloutSw.Elapsed.TotalSeconds);
            if (update % 1 == 0)
            {
                double Avg(List<double> l) => l.Count == 0 ? double.NaN : l.Average();
                var line = string.Create(CultureInfo.InvariantCulture,
                    $"{update},{globalStep},{sps:F0},{Avg(epRet):F3},{Avg(epWin):F3},{Avg(epFrac):F4},{Avg(epRank):F1},{Avg(epLen):F0}," +
                    $"{pgSum / Math.Max(1, nMb):F4},{vlSum / Math.Max(1, nMb):F4},{entSum / Math.Max(1, nMb):F3},{klSum / Math.Max(1, nMb):F4},{clipSum / Math.Max(1, nMb):F3},{lr:E2}");
                File.AppendAllText(logPath, line + "\n");
                var typeTot = types.Sum();
                var mix = string.Join(" ", Enumerable.Range(0, Proto.TypeCount)
                    .Where(i => types[i] > 0).Select(i => $"{Proto.TypeNames[i]}:{100.0 * types[i] / typeTot:F0}%"));
                Console.WriteLine(string.Create(CultureInfo.InvariantCulture,
                    $"upd {update}/{totalUpdates} steps {globalStep:N0} | {sps:F0} sps (env {envSec / Math.Max(1e-9, envSec + nnSec) * 100:F0}%) | " +
                    $"eps {epRet.Count} ret {Avg(epRet):F2} win {Avg(epWin):P0} land {Avg(epFrac):P1} rank {Avg(epRank):F1} len {Avg(epLen):F0} | " +
                    $"ent {entSum / Math.Max(1, nMb):F2} kl {klSum / Math.Max(1, nMb):F3} clip {clipSum / Math.Max(1, nMb):F2}"));
                Console.WriteLine("   actions: " + mix);
                epRet.Clear(); epWin.Clear(); epFrac.Clear(); epRank.Clear(); epLen.Clear();
                envSec = nnSec = 0;
            }
            if (update % _cfg.SaveEvery == 0 || update == totalUpdates) Save(update, globalStep);
        }
    }

    public void Save(long update, long steps)
    {
        var path = Path.Combine(_cfg.OutDir, "latest.pt");
        _net.save(path);
        var meta = new Dictionary<string, double>
        {
            ["update"] = update, ["steps"] = steps, ["retMean"] = _retStat.Mean, ["retVar"] = _retStat.Var, ["retCount"] = _retStat.Count,
        };
        File.WriteAllText(Path.ChangeExtension(path, ".json"), JsonSerializer.Serialize(meta));
        if (update % (_cfg.SaveEvery * 4) == 0) File.Copy(path, Path.Combine(_cfg.OutDir, $"ckpt_{update}.pt"), true);
        Console.WriteLine($"   saved {path}");
    }
}
