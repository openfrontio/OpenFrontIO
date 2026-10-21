using TorchSharp;
using TorchSharp.Modules;
using static TorchSharp.torch;
using static TorchSharp.torch.nn;
using F = TorchSharp.torch.nn.functional;

namespace OpenFrontRL;

public readonly record struct PolicyOut(Tensor Type, Tensor SlotAttack, Tensor SlotAlly, Tensor Ratio, Tensor Cell, Tensor Value);

/// <summary>
/// Conv encoder over the G x G map grid + MLP over scalars -> shared trunk ->
/// factored action heads (type / slot / ratio / cell) and a value head.
/// The cell head is convolutional (a per-cell logit conditioned on global context),
/// so "where" decisions stay spatially aligned with the map.
/// </summary>
public sealed class ActorCritic : Module<Tensor, Tensor, PolicyOut>
{
    private readonly int _g;
    private readonly Conv2d conv1, conv2, conv3, conv4;
    private readonly Linear scalarFc, trunk1, trunk2, headType, headSlotA, headSlotB, headRatio, headValue, ctxToMap;
    private readonly Conv2d cellConv, cellOut;

    public ActorCritic(Dims d, int hidden = 512) : base("ActorCritic")
    {
        _g = d.grid;
        if (_g % 8 != 0) throw new ArgumentException("grid must be a multiple of 8");
        conv1 = Conv2d(d.channels, 32, 3, padding: 1);
        conv2 = Conv2d(32, 64, 3, stride: 2, padding: 1);
        conv3 = Conv2d(64, 64, 3, stride: 2, padding: 1);
        conv4 = Conv2d(64, 64, 3, stride: 2, padding: 1);
        int flat = 64 * (_g / 8) * (_g / 8);
        scalarFc = Linear(d.scalars, 128);
        trunk1 = Linear(flat + 128, hidden);
        trunk2 = Linear(hidden, hidden);
        headType = Linear(hidden, d.numTypes);
        headSlotA = Linear(hidden, d.numSlots);
        headSlotB = Linear(hidden, d.numSlots);
        headRatio = Linear(hidden, d.numRatios);
        headValue = Linear(hidden, 1);
        ctxToMap = Linear(hidden, 32);
        cellConv = Conv2d(32, 32, 3, padding: 1);
        cellOut = Conv2d(32, 1, 1);
        RegisterComponents();
        Init();
    }

    private void Init()
    {
        foreach (var (_, m) in named_modules())
        {
            if (m is Conv2d c) { init.orthogonal_(c.weight, Math.Sqrt(2)); init.zeros_(c.bias!); }
            else if (m is Linear l) { init.orthogonal_(l.weight, Math.Sqrt(2)); init.zeros_(l.bias!); }
        }
        init.orthogonal_(headType.weight, 0.01);
        init.orthogonal_(headSlotA.weight, 0.01);
        init.orthogonal_(headSlotB.weight, 0.01);
        init.orthogonal_(headRatio.weight, 0.01);
        init.orthogonal_(cellOut.weight, 0.01);
        init.orthogonal_(headValue.weight, 1.0);
    }

    public override PolicyOut forward(Tensor spatial, Tensor scalars)
    {
        long b = spatial.shape[0];
        var x1 = F.relu(conv1.forward(spatial.view(b, -1, _g, _g)));
        var x = F.relu(conv2.forward(x1));
        x = F.relu(conv3.forward(x));
        x = F.relu(conv4.forward(x));
        var s = F.relu(scalarFc.forward(scalars));
        var h = F.relu(trunk1.forward(cat(new[] { x.flatten(1), s }, 1)));
        h = F.relu(trunk2.forward(h));

        var ctx = ctxToMap.forward(h).view(b, 32, 1, 1);
        var m = F.relu(cellConv.forward(F.relu(x1 + ctx)));
        var cell = cellOut.forward(m).view(b, -1);

        return new PolicyOut(
            headType.forward(h), headSlotA.forward(h), headSlotB.forward(h),
            headRatio.forward(h), cell, headValue.forward(h).squeeze(-1));
    }
}

/// <summary>Constant lookup tables kept on the compute device.</summary>
public sealed class ActionTables
{
    public readonly Tensor UsesAttackSlot, UsesAllySlot, UsesRatio, UsesCell, CellKind;
    public ActionTables(Device dev)
    {
        UsesAttackSlot = tensor(Proto.UsesAttackSlot).to(dev);
        UsesAllySlot = tensor(Proto.UsesAllySlot).to(dev);
        UsesRatio = tensor(Proto.UsesRatio).to(dev);
        UsesCell = tensor(Proto.UsesCell).to(dev);
        CellKind = tensor(Proto.CellKindOfType).to(dev);
    }
}

public readonly record struct Actions(Tensor Type, Tensor Slot, Tensor Ratio, Tensor Cell);

/// <summary>Masked, factored categorical policy: sampling, log-probs and entropy.</summary>
public static class Policy
{
    private const float NegInf = -1e9f;

    private static Tensor Masked(Tensor logits, Tensor allowed) =>
        logits.masked_fill(allowed.logical_not(), NegInf);

    /// <summary>Splits the raw uint8 mask block into (type, slotAttack, slotAlly, cells[B,K,GG]) bool views.</summary>
    public static (Tensor type, Tensor slotA, Tensor slotB, Tensor cells) SplitMasks(Tensor masks, Dims d)
    {
        var m = masks.to(ScalarType.Bool);
        long b = m.shape[0];
        var type = m.narrow(1, 0, d.numTypes);
        var slotA = m.narrow(1, d.numTypes, d.numSlots);
        var slotB = m.narrow(1, d.numTypes + d.numSlots, d.numSlots);
        var cells = m.narrow(1, d.MaskCellOffset, d.cellKinds * d.Cells).view(b, d.cellKinds, d.Cells);
        return (type, slotA, slotB, cells);
    }

    private static Tensor CellMaskFor(Tensor cells, Tensor typeIdx, ActionTables t, Dims d)
    {
        long b = typeIdx.shape[0];
        var kind = t.CellKind.index_select(0, typeIdx).to(ScalarType.Int64).view(b, 1, 1).expand(b, 1, d.Cells);
        return cells.gather(1, kind).squeeze(1);
    }

    private static Tensor LogProbOf(Tensor maskedLogits, Tensor action) =>
        F.log_softmax(maskedLogits, -1).gather(-1, action.unsqueeze(-1)).squeeze(-1);

    private static Tensor Entropy(Tensor maskedLogits)
    {
        var lp = F.log_softmax(maskedLogits, -1);
        var p = lp.exp();
        return -(p * lp).masked_fill(p == 0, 0f).sum(-1);
    }

    private static Tensor Sample(Tensor maskedLogits, bool greedy) =>
        greedy ? maskedLogits.argmax(-1) : multinomial(F.softmax(maskedLogits, -1), 1).squeeze(-1);

    /// <summary>Sample actions. Returns actions, joint log-prob, value.</summary>
    public static (Actions a, Tensor logp, Tensor value) Act(
        ActorCritic net, Tensor spatial, Tensor scalars, Tensor masks, Dims d, ActionTables t, bool greedy)
    {
        var o = net.call(spatial, scalars);
        var (mType, mSlotA, mSlotB, mCells) = SplitMasks(masks, d);

        var lt = Masked(o.Type, mType);
        var type = Sample(lt, greedy);
        var cellMask = CellMaskFor(mCells, type, t, d);
        var ls = Masked(o.SlotAttack, mSlotA);
        var lb = Masked(o.SlotAlly, mSlotB);
        var lr = o.Ratio;
        var lc = Masked(o.Cell, cellMask);

        var slotA = Sample(ls, greedy);
        var slotB = Sample(lb, greedy);
        var ratio = Sample(lr, greedy);
        var cell = Sample(lc, greedy);

        var logp = LogProbOf(lt, type)
            + t.UsesAttackSlot.index_select(0, type) * LogProbOf(ls, slotA)
            + t.UsesAllySlot.index_select(0, type) * LogProbOf(lb, slotB)
            + t.UsesRatio.index_select(0, type) * LogProbOf(lr, ratio)
            + t.UsesCell.index_select(0, type) * LogProbOf(lc, cell);

        var isAlly = t.UsesAllySlot.index_select(0, type) > 0.5f;
        var slot = where(isAlly, slotB, slotA);
        return (new Actions(type, slot, ratio, cell), logp, o.Value);
    }

    /// <summary>Re-evaluates stored actions: log-prob, entropy, value.</summary>
    public static (Tensor logp, Tensor entropy, Tensor value) Evaluate(
        ActorCritic net, Tensor spatial, Tensor scalars, Tensor masks, Actions a, Dims d, ActionTables t)
    {
        var o = net.call(spatial, scalars);
        var (mType, mSlotA, mSlotB, mCells) = SplitMasks(masks, d);
        var cellMask = CellMaskFor(mCells, a.Type, t, d);

        var lt = Masked(o.Type, mType);
        var ls = Masked(o.SlotAttack, mSlotA);
        var lb = Masked(o.SlotAlly, mSlotB);
        var lr = o.Ratio;
        var lc = Masked(o.Cell, cellMask);

        var uA = t.UsesAttackSlot.index_select(0, a.Type);
        var uB = t.UsesAllySlot.index_select(0, a.Type);
        var uR = t.UsesRatio.index_select(0, a.Type);
        var uC = t.UsesCell.index_select(0, a.Type);
        var isAlly = uB > 0.5f;
        // The stored slot is whichever slot head the type used; route it back.
        var slotA = where(isAlly, zeros_like(a.Slot), a.Slot);
        var slotB = where(isAlly, a.Slot, zeros_like(a.Slot));

        var logp = LogProbOf(lt, a.Type)
            + uA * LogProbOf(ls, slotA)
            + uB * LogProbOf(lb, slotB)
            + uR * LogProbOf(lr, a.Ratio)
            + uC * LogProbOf(lc, a.Cell);
        var ent = Entropy(lt) + uA * Entropy(ls) + uB * Entropy(lb) + uR * Entropy(lr) + uC * Entropy(lc);
        return (logp, ent, o.Value);
    }
}
