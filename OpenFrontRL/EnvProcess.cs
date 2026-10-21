using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace OpenFrontRL;

/// <summary>One Node child process hosting several OpenFront games (see rl/server.ts).</summary>
public sealed class EnvProcess : IDisposable
{
    private readonly Process _proc;
    private readonly Stream _in;
    private readonly Stream _out;
    private readonly Queue<string> _stderrTail = new();
    private byte[] _stepBuf = Array.Empty<byte>();

    public int NumEnvs { get; }
    public Dims Dims { get; private set; } = null!;
    public int ObsBytes { get; private set; }
    public int StepBytes { get; private set; }

    public EnvProcess(string repoRoot, int numEnvs, int envOffset, EnvOptions options, bool verbose, int viewerPort = 0)
    {
        NumEnvs = numEnvs;
        var psi = new ProcessStartInfo("node")
        {
            WorkingDirectory = repoRoot,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        psi.ArgumentList.Add("--max-old-space-size=3072");
        psi.ArgumentList.Add("--import");
        psi.ArgumentList.Add("tsx");
        psi.ArgumentList.Add("rl/server.ts");
        _proc = Process.Start(psi) ?? throw new InvalidOperationException("could not start node (is Node.js on PATH?)");
        _proc.ErrorDataReceived += (_, e) =>
        {
            if (e.Data == null) return;
            lock (_stderrTail)
            {
                _stderrTail.Enqueue(e.Data);
                while (_stderrTail.Count > 30) _stderrTail.Dequeue();
            }
            if (verbose) Console.Error.WriteLine("[env] " + e.Data);
        };
        _proc.BeginErrorReadLine();
        _in = _proc.StandardInput.BaseStream;
        _out = _proc.StandardOutput.BaseStream;

        var cfg = JsonSerializer.Serialize(new { numEnvs, envOffset, options = options.ToJson(), viewerPort });
        SendFrame(Proto.CmdInit, Encoding.UTF8.GetBytes(cfg));
        var resp = ReadFrame();
        using var doc = JsonDocument.Parse(resp);
        var d = doc.RootElement.GetProperty("dims");
        Dims = new Dims(
            d.GetProperty("channels").GetInt32(), d.GetProperty("grid").GetInt32(), d.GetProperty("scalars").GetInt32(),
            d.GetProperty("maskSize").GetInt32(), d.GetProperty("numTypes").GetInt32(), d.GetProperty("numSlots").GetInt32(),
            d.GetProperty("numRatios").GetInt32(), d.GetProperty("cellKinds").GetInt32());
        ObsBytes = doc.RootElement.GetProperty("obsBytes").GetInt32();
        StepBytes = doc.RootElement.GetProperty("stepBytes").GetInt32();
        _stepBuf = new byte[StepBytes * numEnvs];
    }

    public string StderrTail()
    {
        lock (_stderrTail) return string.Join("\n", _stderrTail);
    }

    private void SendFrame(byte cmd, byte[] payload)
    {
        var header = new byte[5];
        BitConverter.TryWriteBytes(header.AsSpan(0, 4), (uint)(payload.Length + 1));
        header[4] = cmd;
        _in.Write(header, 0, 5);
        if (payload.Length > 0) _in.Write(payload, 0, payload.Length);
        _in.Flush();
    }

    private byte[] ReadFrame()
    {
        var h = new byte[4];
        ReadExactly(h, 4);
        int len = (int)BitConverter.ToUInt32(h, 0);
        var buf = new byte[len];
        ReadExactly(buf, len);
        return buf;
    }

    private void ReadExactly(byte[] buf, int count)
    {
        int got = 0;
        while (got < count)
        {
            int n = _out.Read(buf, got, count - got);
            if (n <= 0)
                throw new IOException("env process closed its output. Last stderr:\n" + StderrTail());
            got += n;
        }
    }

    /// <summary>Resets env <paramref name="idx"/>; returns a byte[] holding one observation block.</summary>
    public byte[] Reset(int idx, int seed = -1)
    {
        var p = new byte[8];
        BitConverter.TryWriteBytes(p.AsSpan(0, 4), idx);
        BitConverter.TryWriteBytes(p.AsSpan(4, 4), seed);
        SendFrame(Proto.CmdReset, p);
        return ReadFrame();
    }

    /// <summary>Sends the step request without waiting for the response.</summary>
    public void StepSend(ReadOnlySpan<int> actions) // NumEnvs * 4 ints
    {
        var payload = new byte[actions.Length * 4];
        System.Buffer.BlockCopy(actions.ToArray(), 0, payload, 0, payload.Length);
        SendFrame(Proto.CmdStep, payload);
    }

    /// <summary>Waits for the step response. Returns the raw buffer (NumEnvs * StepBytes).</summary>
    public byte[] StepReceive()
    {
        int len = StepBytes * NumEnvs;
        var h = new byte[4];
        ReadExactly(h, 4);
        int got = (int)BitConverter.ToUInt32(h, 0);
        if (got != len) throw new IOException($"unexpected step frame size {got}, expected {len}");
        ReadExactly(_stepBuf, len);
        return _stepBuf;
    }

    public void Dispose()
    {
        try
        {
            if (!_proc.HasExited)
            {
                SendFrame(Proto.CmdClose, Array.Empty<byte>());
                if (!_proc.WaitForExit(1500)) _proc.Kill(true);
            }
        }
        catch { /* shutting down */ }
        _proc.Dispose();
    }
}
