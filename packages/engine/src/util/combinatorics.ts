/**
 * Sequential generation of pairing candidates (C.04.3.D).
 *
 * Every player in a bracket carries a bracket sequence number (BSN) giving their
 * rank inside the bracket under C.04.3.A.2. The rules below are all expressed in
 * terms of BSNs, so these helpers work on arrays of indices and leave the caller
 * to map indices back to players.
 */

/**
 * D.1 — transpositions in S2.
 *
 * Yields every ordering of the first `n1` positions of `s2`, sorted by the
 * lexicographic value of those first `n1` BSNs. Trailing elements (which will
 * become the remainder, or downfloat) are emitted in ascending order and are
 * explicitly *not* part of the ordering key.
 *
 * For an 11-player homogeneous bracket (n1 = 5, s2 = 6..11) the sequence starts
 * 6-7-8-9-10, 6-7-8-9-11, 6-7-8-10-11, ... and ends 11-10-9-8-7 — 720 in all,
 * exactly as the rule's worked example states.
 */
export function* transpositions<T>(s2: readonly T[], n1: number): Generator<T[]> {
  const k = Math.min(n1, s2.length);
  const used = new Array<boolean>(s2.length).fill(false);
  const prefix: number[] = [];

  function* recurse(depth: number): Generator<T[]> {
    if (depth === k) {
      const rest: T[] = [];
      for (let i = 0; i < s2.length; i++) if (!used[i]) rest.push(s2[i]);
      yield [...prefix.map((i) => s2[i]), ...rest];
      return;
    }
    // Ascending index order == ascending BSN order == lexicographic order.
    for (let i = 0; i < s2.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      prefix.push(i);
      yield* recurse(depth + 1);
      prefix.pop();
      used[i] = false;
    }
  }

  yield* recurse(0);
}

/** How many transpositions `transpositions` would yield — used for budgeting. */
export function transpositionCount(s2Length: number, n1: number): number {
  const k = Math.min(n1, s2Length);
  let total = 1;
  for (let i = 0; i < k; i++) {
    total *= s2Length - i;
    if (!Number.isFinite(total) || total > 1e15) return Infinity;
  }
  return total;
}

/** All subsets of `arr` of exactly size `k`, as arrays of positions. */
function* combinations(n: number, k: number): Generator<number[]> {
  if (k > n) return;
  const idx: number[] = [];
  function* recurse(start: number): Generator<number[]> {
    if (idx.length === k) {
      yield [...idx];
      return;
    }
    for (let i = start; i < n; i++) {
      idx.push(i);
      yield* recurse(i + 1);
      idx.pop();
    }
  }
  yield* recurse(0);
}

export interface Exchange {
  /** Positions within S1 whose players move to S2. */
  fromS1: number[];
  /** Positions within S2 whose players move to S1. */
  fromS2: number[];
}

/**
 * D.2 — resident exchanges between the original S1 and S2.
 *
 * Ordered by, in turn:
 *   a) the smallest number of exchanged BSNs
 *   b) the smallest difference between the sum of BSNs moved S2→S1 and the sum
 *      moved S1→S2
 *   c) the highest differing BSN among those moved S1→S2
 *   d) the lowest differing BSN among those moved S2→S1
 *
 * The identity exchange (nothing swapped) is yielded first, so a caller can use
 * this as the single outer loop of B.6.
 *
 * `s1Bsn` / `s2Bsn` supply the BSN of each position, since the sort keys are
 * defined on BSNs rather than positions.
 */
export function* residentExchanges(
  s1Bsn: readonly number[],
  s2Bsn: readonly number[],
  maxSwapSize = Infinity,
  maxBatch = MAX_EXCHANGE_BATCH,
): Generator<Exchange> {
  yield { fromS1: [], fromS2: [] };

  const maxK = Math.min(s1Bsn.length, s2Bsn.length, maxSwapSize);
  for (let k = 1; k <= maxK; k++) {
    // A swap of k players out of each side has C(|S1|,k)·C(|S2|,k) forms, which
    // grows fast enough on a big bracket to exhaust memory if it is all
    // materialised for sorting. Sizes past that point are skipped; they are the
    // least preferred exchanges under D.2 anyway, so a bracket that needed one
    // would already be far outside anything a real tournament produces.
    const count = binomial(s1Bsn.length, k) * binomial(s2Bsn.length, k);
    if (count > maxBatch) return;

    const batch: Exchange[] = [];
    for (const a of combinations(s1Bsn.length, k)) {
      for (const b of combinations(s2Bsn.length, k)) {
        batch.push({ fromS1: a, fromS2: b });
      }
    }
    batch.sort((x, y) => compareExchanges(x, y, s1Bsn, s2Bsn));
    yield* batch;
  }
}

/** Ceiling on how many exchanges of one size will be sorted at once. */
export const MAX_EXCHANGE_BATCH = 60_000;

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
    if (result > Number.MAX_SAFE_INTEGER) return Infinity;
  }
  return Math.round(result);
}

function compareExchanges(
  x: Exchange,
  y: Exchange,
  s1Bsn: readonly number[],
  s2Bsn: readonly number[],
): number {
  // (a) is guaranteed by generating size-k batches in order.

  // (b) smallest |sum(S2→S1) − sum(S1→S2)|.
  const diff = (e: Exchange) =>
    Math.abs(
      e.fromS2.reduce((s, i) => s + s2Bsn[i], 0) -
        e.fromS1.reduce((s, i) => s + s1Bsn[i], 0),
    );
  const dx = diff(x);
  const dy = diff(y);
  if (dx !== dy) return dx - dy;

  // (c) highest differing BSN among those moved out of S1 wins.
  const outX = x.fromS1.map((i) => s1Bsn[i]).sort((p, q) => q - p);
  const outY = y.fromS1.map((i) => s1Bsn[i]).sort((p, q) => q - p);
  for (let i = 0; i < outX.length; i++) {
    if (outX[i] !== outY[i]) return outY[i] - outX[i];
  }

  // (d) lowest differing BSN among those moved into S1 wins.
  const inX = x.fromS2.map((i) => s2Bsn[i]).sort((p, q) => p - q);
  const inY = y.fromS2.map((i) => s2Bsn[i]).sort((p, q) => p - q);
  for (let i = 0; i < inX.length; i++) {
    if (inX[i] !== inY[i]) return inX[i] - inY[i];
  }
  return 0;
}

/**
 * D.3 — MDP exchanges between the original S1 and the Limbo.
 *
 * Ordered by the S1 that results from the exchange, preferring:
 *   a) the highest differing score among its players
 *   b) the lowest lexicographic value of its BSNs, ascending
 *
 * `score` maps a BSN to that player's score.
 */
export function* mdpExchanges(
  s1Bsn: readonly number[],
  limboBsn: readonly number[],
  score: (bsn: number) => number,
  maxSwapSize = Infinity,
  maxBatch = MAX_EXCHANGE_BATCH,
): Generator<Exchange> {
  yield { fromS1: [], fromS2: [] };

  const maxK = Math.min(s1Bsn.length, limboBsn.length, maxSwapSize);
  const all: Exchange[] = [];
  for (let k = 1; k <= maxK; k++) {
    if (binomial(s1Bsn.length, k) * binomial(limboBsn.length, k) > maxBatch) break;
    for (const a of combinations(s1Bsn.length, k)) {
      for (const b of combinations(limboBsn.length, k)) {
        all.push({ fromS1: a, fromS2: b });
      }
    }
    if (all.length > maxBatch) break;
  }

  const resultingS1 = (e: Exchange): number[] => {
    const removed = new Set(e.fromS1);
    const kept = s1Bsn.filter((_, i) => !removed.has(i));
    const added = e.fromS2.map((i) => limboBsn[i]);
    return [...kept, ...added].sort((p, q) => p - q);
  };

  all.sort((x, y) => {
    const sx = resultingS1(x);
    const sy = resultingS1(y);

    // (a) highest differing score, comparing the score multisets descending.
    const scoresX = sx.map(score).sort((p, q) => q - p);
    const scoresY = sy.map(score).sort((p, q) => q - p);
    for (let i = 0; i < Math.min(scoresX.length, scoresY.length); i++) {
      if (scoresX[i] !== scoresY[i]) return scoresY[i] - scoresX[i];
    }

    // (b) lowest lexicographic BSN value.
    for (let i = 0; i < Math.min(sx.length, sy.length); i++) {
      if (sx[i] !== sy[i]) return sx[i] - sy[i];
    }
    return 0;
  });

  yield* all;
}

/** Cost standing in for "this pair is not allowed", large but still finite. */
export const FORBIDDEN = 1e6;

/**
 * Minimum-cost assignment of `n` rows to `m` columns, m ≥ n — the Hungarian
 * algorithm with potentials, O(n²m).
 *
 * The bracket search uses it to find out, before it starts walking candidates,
 * how few colour preferences a bracket can possibly refuse. Knowing that number
 * turns "search until the budget runs out proving this cannot be improved" into
 * "search until a candidate hits the known optimum", which is the difference
 * between seconds and milliseconds on a big bracket.
 *
 * Returns a total of at least FORBIDDEN when no legal assignment exists.
 */
export function minCostAssignment(
  n: number,
  m: number,
  cost: (row: number, col: number) => number,
): { total: number; assignment: number[] } {
  if (n === 0) return { total: 0, assignment: [] };

  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const assignment = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] > 0) assignment[p[j] - 1] = j - 1;
  }
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += assignment[i] === -1 ? FORBIDDEN : cost(i, assignment[i]);
  }
  return { total, assignment };
}

/**
 * Maximum cardinality matching in a general graph — Edmonds' blossom algorithm.
 *
 * Two places need to know how many pairs a set of players could possibly form:
 * the C.7 lookahead, and the check that a round can still be completed before
 * committing to a bracket (A.9). Both ask the question about the whole
 * remaining field, so this has to stay polynomial; it runs in O(V³).
 *
 * "Blossom" refers to the odd cycle that makes general-graph matching harder
 * than the bipartite case: augmenting paths can enter such a cycle and leave by
 * a different vertex, so the cycle is contracted to a single node and the search
 * continues on the smaller graph.
 */
export function maximumMatching(
  n: number,
  compatible: (a: number, b: number) => boolean,
): number {
  return maximumMatchingPairs(n, compatible).length;
}

/** As `maximumMatching`, but returns the pairs themselves. */
export function maximumMatchingPairs(
  n: number,
  compatible: (a: number, b: number) => boolean,
): Array<[number, number]> {
  if (n < 2) return [];

  // Materialise the graph once; `compatible` is not free to call.
  const adjacency: boolean[][] = Array.from({ length: n }, () =>
    new Array<boolean>(n).fill(false),
  );
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ok = compatible(i, j);
      adjacency[i][j] = ok;
      adjacency[j][i] = ok;
    }
  }

  const match = new Array<number>(n).fill(-1);
  const parent = new Array<number>(n).fill(-1);
  const base = new Array<number>(n).fill(0);
  const inQueue = new Array<boolean>(n).fill(false);
  const inBlossom = new Array<boolean>(n).fill(false);

  /** Lowest common ancestor of a and b in the alternating tree. */
  const lca = (a: number, b: number): number => {
    const seen = new Array<boolean>(n).fill(false);
    let x = a;
    for (;;) {
      x = base[x];
      seen[x] = true;
      if (match[x] === -1) break;
      x = parent[match[x]];
    }
    let y = b;
    for (;;) {
      y = base[y];
      if (seen[y]) return y;
      y = parent[match[y]];
    }
  };

  /** Walk from v up to the blossom's base, flagging everything on the way. */
  const markPath = (v: number, b: number, child: number): void => {
    let current = v;
    let previous = child;
    while (base[current] !== b) {
      inBlossom[base[current]] = true;
      inBlossom[base[match[current]]] = true;
      parent[current] = previous;
      previous = match[current];
      current = parent[match[current]];
    }
  };

  /** Grow an alternating tree from `root`, augmenting if a path is found. */
  const findAugmentingPath = (root: number): boolean => {
    inQueue.fill(false);
    parent.fill(-1);
    for (let i = 0; i < n; i++) base[i] = i;

    inQueue[root] = true;
    const queue = [root];

    for (let head = 0; head < queue.length; head++) {
      const v = queue[head];
      for (let to = 0; to < n; to++) {
        if (!adjacency[v][to]) continue;
        if (base[v] === base[to] || match[v] === to) continue;

        if (to === root || (match[to] !== -1 && parent[match[to]] !== -1)) {
          // An odd cycle: contract it and carry on.
          const curbase = lca(v, to);
          inBlossom.fill(false);
          markPath(v, curbase, to);
          markPath(to, curbase, v);
          for (let i = 0; i < n; i++) {
            if (!inBlossom[base[i]]) continue;
            base[i] = curbase;
            if (!inQueue[i]) {
              inQueue[i] = true;
              queue.push(i);
            }
          }
        } else if (parent[to] === -1) {
          parent[to] = v;
          if (match[to] === -1) {
            // Free vertex reached: flip the path and gain one pair.
            let u = to;
            while (u !== -1) {
              const pv = parent[u];
              const next = match[pv];
              match[u] = pv;
              match[pv] = u;
              u = next;
            }
            return true;
          }
          inQueue[match[to]] = true;
          queue.push(match[to]);
        }
      }
    }
    return false;
  };

  for (let v = 0; v < n; v++) {
    if (match[v] === -1) findAugmentingPath(v);
  }

  const pairs: Array<[number, number]> = [];
  for (let v = 0; v < n; v++) {
    if (match[v] > v) pairs.push([v, match[v]]);
  }
  return pairs;
}
