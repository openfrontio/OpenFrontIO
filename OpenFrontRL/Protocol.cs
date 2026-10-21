namespace OpenFrontRL;

/// <summary>Mirrors rl/protocol.ts. Keep both in sync.</summary>
public static class Proto
{
    public const int TypeCount = 14;
    public const int NumSlots = 8;
    public const int NumRatios = 5;
    public const int CellKinds = 5;

    public const byte CmdInit = 0, CmdReset = 1, CmdStep = 2, CmdInfo = 3, CmdClose = 4;

    // Action types
    public const int Noop = 0, Attack = 1, Boat = 2, City = 3, Port = 4, DefensePost = 5, Factory = 6,
        Silo = 7, Sam = 8, Warship = 9, AtomBomb = 10, AllyRequest = 11, AcceptAlliance = 12, Spawn = 13;

    public static readonly string[] TypeNames =
    {
        "noop", "attack", "boat", "city", "port", "defpost", "factory", "silo", "sam", "warship",
        "atom", "ally", "accept", "spawn",
    };

    // Per action type: which heads are used (1 = used).
    public static readonly float[] UsesAttackSlot = Mk(Attack);
    public static readonly float[] UsesAllySlot = Mk(AllyRequest);
    public static readonly float[] UsesRatio = Mk(Attack, Boat);
    public static readonly float[] UsesCell = Mk(Boat, City, Port, DefensePost, Factory, Silo, Sam, Warship, AtomBomb, Spawn);

    // Per action type: which cell-mask kind applies (see OpenFrontEnv.ts CELL_*).
    public static readonly long[] CellKindOfType =
    {
        0, 0, 3, 0, 1, 0, 0, 0, 0, 1, 4, 0, 0, 2,
    };

    private static float[] Mk(params int[] on)
    {
        var a = new float[TypeCount];
        foreach (var i in on) a[i] = 1f;
        return a;
    }
}

public sealed record Dims(int channels, int grid, int scalars, int maskSize, int numTypes, int numSlots, int numRatios, int cellKinds)
{
    public int SpatialLen => channels * grid * grid;
    public int Cells => grid * grid;
    public int MaskCellOffset => numTypes + numSlots * 2;
}

public sealed class EnvOptions
{
    public string Map { get; set; } = "world";
    public bool Compact { get; set; } = true;
    public int Bots { get; set; } = 50;
    public string Difficulty { get; set; } = "Medium";
    public int Grid { get; set; } = 32;
    public int DecisionInterval { get; set; } = 10;
    public int MaxDecisions { get; set; } = 600;
    public int Seed { get; set; } = 0;
    public bool InstantBuild { get; set; } = false;
    public int Nations { get; set; } = -1; // -1 = default

    public object ToJson() => new Dictionary<string, object>
    {
        ["map"] = Map,
        ["compact"] = Compact,
        ["bots"] = Bots,
        ["difficulty"] = Difficulty,
        ["grid"] = Grid,
        ["decisionInterval"] = DecisionInterval,
        ["maxDecisions"] = MaxDecisions,
        ["seed"] = Seed,
        ["instantBuild"] = InstantBuild,
        ["nations"] = Nations < 0 ? "default" : Nations,
    };
}
