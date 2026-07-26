/**
 * Pod-location whitelist check: which of a character's pods (clones carrying
 * at least one implant) sit outside a group's allowed solar systems.
 * Dependency-free so unit tests need no Electron or DB.
 */

/** One character's pods, as far as the check is concerned. */
export interface PodCheckInput {
  /** Implants in the currently-active clone. */
  activeImplantCount: number;
  /** Current solar system; null when location hasn't synced. */
  activeSystemId: number | null;
  clones: Array<{
    jumpCloneId: number;
    name: string | null;
    locationId: number | null;
    locationType: string | null;
    implantCount: number;
  }>;
}

/** A pod that is outside the whitelist (or, for jump clones, unverifiable). */
export interface PodFlag {
  kind: 'active' | 'jump-clone';
  jumpCloneId: number | null;
  cloneName: string | null;
  implantCount: number;
  locationId: number | null;
  locationType: string | null;
  /** Resolved solar system; null = unverifiable (e.g. unresolved structure). */
  systemId: number | null;
}

/**
 * Pods carrying implants that are verifiably outside the whitelisted systems —
 * plus, for jump clones only, pods whose system cannot be resolved (an
 * unresolved structure could be anywhere). The active body is flagged only
 * when its system is known: an unsynced location is missing data, not an
 * alarm. An empty whitelist disables the check entirely.
 */
export function flagPodsOutsideWhitelist(
  input: PodCheckInput,
  allowedSystemIds: ReadonlySet<number>,
  systemOfLocation: (locationType: string | null, locationId: number | null) => number | null,
): PodFlag[] {
  if (allowedSystemIds.size === 0) return [];

  const flags: PodFlag[] = [];
  if (
    input.activeImplantCount > 0 &&
    input.activeSystemId !== null &&
    !allowedSystemIds.has(input.activeSystemId)
  ) {
    flags.push({
      kind: 'active',
      jumpCloneId: null,
      cloneName: null,
      implantCount: input.activeImplantCount,
      locationId: null,
      locationType: null,
      systemId: input.activeSystemId,
    });
  }

  for (const clone of input.clones) {
    if (clone.implantCount === 0) continue;
    const systemId = systemOfLocation(clone.locationType, clone.locationId);
    if (systemId !== null && allowedSystemIds.has(systemId)) continue;
    flags.push({
      kind: 'jump-clone',
      jumpCloneId: clone.jumpCloneId,
      cloneName: clone.name,
      implantCount: clone.implantCount,
      locationId: clone.locationId,
      locationType: clone.locationType,
      systemId,
    });
  }
  return flags;
}
