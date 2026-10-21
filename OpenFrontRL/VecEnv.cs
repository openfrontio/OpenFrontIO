namespace OpenFrontRL;

/// <summary>
/// Many OpenFront games across several Node processes. Processes run in parallel;
/// <see cref="StepSend"/> / <see cref="StepReceive"/> are split so callers can overlap work.
/// Games auto-reset when an episode ends (the returned obs is the next episode's first obs).
/// </summary>
public sealed class VecEnv : IDisposable
{
    private readonly List<EnvProcess> _procs = new();
    public int N { get; }
    public Dims Dims { get; }

    // Latest observation, flattened per env.
    public readonly float[] Spatial;
    public readonly float[] Scalars;
    public readonly byte[] Masks;

    // Latest step results.
    public readonly float[] Reward;
    public readonly bool[] Done;
    public readonly bool[] Won;
    /// <summary>Simulation ticks advanced by the last step, per env.</summary>
    public readonly int[] Ticks;
    public readonly float[] StatTileFrac, StatRank, StatLength, StatReturn;

    public VecEnv(string repoRoot, EnvOptions options, int numProcs, int envsPerProc, bool verbose = false, int viewerPort = 0)
    {
        N = numProcs * envsPerProc;
        // Start all processes in parallel (tsx cold start is the slow part).
        var tasks = Enumerable.Range(0, numProcs)
            .Select(i => Task.Run(() => new EnvProcess(repoRoot, envsPerProc, i * envsPerProc, options, verbose, i == 0 ? viewerPort : 0)))
            .ToArray();
        Task.WaitAll(tasks);
        foreach (var t in tasks) _procs.Add(t.Result);
        Dims = _procs[0].Dims;
        Spatial = new float[N * Dims.SpatialLen];
        Scalars = new float[N * Dims.scalars];
        Masks = new byte[N * Dims.maskSize];
        Reward = new float[N];
        Done = new bool[N];
        Won = new bool[N];
        Ticks = new int[N];
        StatTileFrac = new float[N]; StatRank = new float[N]; StatLength = new float[N]; StatReturn = new float[N];
    }

    private void CopyObs(byte[] buf, int offset, int env)
    {
        int sb = Dims.SpatialLen * 4, cb = Dims.scalars * 4;
        System.Buffer.BlockCopy(buf, offset, Spatial, env * Dims.SpatialLen * 4, sb);
        System.Buffer.BlockCopy(buf, offset + sb, Scalars, env * Dims.scalars * 4, cb);
        System.Buffer.BlockCopy(buf, offset + sb + cb, Masks, env * Dims.maskSize, Dims.maskSize);
    }

    public void ResetAll(int baseSeed = -1)
    {
        var tasks = new List<Task>();
        int env = 0;
        foreach (var p in _procs)
        {
            int start = env;
            var proc = p;
            tasks.Add(Task.Run(() =>
            {
                for (int i = 0; i < proc.NumEnvs; i++)
                {
                    var buf = proc.Reset(i, baseSeed < 0 ? -1 : baseSeed + start + i);
                    lock (this) CopyObs(buf, 0, start + i);
                }
            }));
            env += p.NumEnvs;
        }
        Task.WaitAll(tasks.ToArray());
        Array.Clear(Reward); Array.Clear(Done); Array.Clear(Won);
    }

    /// <summary>actions: N * 4 ints (type, slot, ratio, cell).</summary>
    public void StepSend(int[] actions)
    {
        int env = 0;
        foreach (var p in _procs)
        {
            p.StepSend(actions.AsSpan(env * 4, p.NumEnvs * 4));
            env += p.NumEnvs;
        }
    }

    public void StepReceive()
    {
        int env = 0;
        foreach (var p in _procs)
        {
            var buf = p.StepReceive();
            for (int i = 0; i < p.NumEnvs; i++, env++)
            {
                int o = i * p.StepBytes;
                CopyObs(buf, o, env);
                int t = o + p.ObsBytes;
                Reward[env] = BitConverter.ToSingle(buf, t);
                byte flags = buf[t + 4];
                Done[env] = (flags & 1) != 0;
                Won[env] = (flags & 2) != 0;
                Ticks[env] = BitConverter.ToUInt16(buf, t + 5);
                StatTileFrac[env] = BitConverter.ToSingle(buf, t + 8);
                StatRank[env] = BitConverter.ToSingle(buf, t + 12);
                StatLength[env] = BitConverter.ToSingle(buf, t + 16);
                StatReturn[env] = BitConverter.ToSingle(buf, t + 20);
            }
        }
    }

    public void Step(int[] actions)
    {
        StepSend(actions);
        StepReceive();
    }

    public void Dispose()
    {
        foreach (var p in _procs) p.Dispose();
    }
}
