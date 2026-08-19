/**
 * Map math over the SDE's stargate graph and system coordinates.
 *
 * Dependency-free on purpose: no DB, no ESI, no Electron. Everything the
 * "which of my characters is nearest to this system" answer needs once the
 * rows have been read, so it unit-tests as plain data in / plain data out.
 */

export interface SystemJump {
  fromSystemId: number;
  toSystemId: number;
}

/** A solar system's position in the New Eden map, in metres. */
export interface SystemPosition {
  x: number;
  y: number;
  z: number;
}

/** Neighbour lists keyed by solar system id — the gate graph, ready for BFS. */
export type Adjacency = Map<number, number[]>;

/**
 * Stargate rows as an undirected neighbour map.
 *
 * The SDE stores one row per gate and every gate in New Eden has a counterpart
 * on the far side, so both directions are usually present already; the reverse
 * edge is added anyway because a single one-sided row would otherwise make a
 * system reachable in one direction only and quietly lengthen every route
 * through it.
 */
export function buildAdjacency(jumps: readonly SystemJump[]): Adjacency {
  const adjacency: Adjacency = new Map();
  const link = (from: number, to: number): void => {
    const neighbours = adjacency.get(from);
    if (neighbours === undefined) adjacency.set(from, [to]);
    else if (!neighbours.includes(to)) neighbours.push(to);
  };
  for (const jump of jumps) {
    if (jump.fromSystemId === jump.toSystemId) continue;
    link(jump.fromSystemId, jump.toSystemId);
    link(jump.toSystemId, jump.fromSystemId);
  }
  return adjacency;
}

/**
 * Gate jumps from `originSystemId` to every system it can reach, breadth-first.
 * Every gate costs one jump, so the first time the search reaches a system it
 * has reached it by a shortest route.
 *
 * The origin maps to 0. Systems with **no** gate route are absent from the map
 * rather than holding some large number: wormhole space has no stargates at
 * all, and "you cannot get there by gates" is a different answer from "it is
 * far away".
 */
export function jumpsFrom(adjacency: Adjacency, originSystemId: number): Map<number, number> {
  const distance = new Map<number, number>([[originSystemId, 0]]);
  let frontier = [originSystemId];
  let jumps = 0;

  while (frontier.length > 0) {
    jumps += 1;
    const next: number[] = [];
    for (const systemId of frontier) {
      for (const neighbour of adjacency.get(systemId) ?? []) {
        if (distance.has(neighbour)) continue;
        distance.set(neighbour, jumps);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return distance;
}

/** Metres in one light year — the unit EVE quotes every jump range in. */
export const METRES_PER_LIGHT_YEAR = 9_460_730_472_580_800;

/**
 * Straight-line distance between two systems in light years — the measure a
 * capital's jump range is expressed in, and the one gate jumps cannot answer:
 * two systems a light year apart can be forty gates apart.
 */
export function lightYearsBetween(a: SystemPosition, b: SystemPosition): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / METRES_PER_LIGHT_YEAR;
}
