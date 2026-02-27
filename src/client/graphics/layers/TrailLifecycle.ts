export function pruneInactiveTrails<TNuke, TTransport>(
  nukeTrails: Map<number, TNuke>,
  transportTrails: Map<number, TTransport>,
  isActive: (unitId: number) => boolean,
): { removedNukes: number; removedTransport: number } {
  let removedNukes = 0;
  let removedTransport = 0;

  for (const unitId of nukeTrails.keys()) {
    if (isActive(unitId)) {
      continue;
    }
    nukeTrails.delete(unitId);
    removedNukes++;
  }

  for (const unitId of transportTrails.keys()) {
    if (isActive(unitId)) {
      continue;
    }
    transportTrails.delete(unitId);
    removedTransport++;
  }

  return { removedNukes, removedTransport };
}
