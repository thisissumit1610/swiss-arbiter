/**
 * Candidate generation order (C.04.3.D) and the graph algorithms behind it.
 */

import { describe, expect, it } from 'vitest';
import {
  maximumMatching,
  minCostAssignment,
  residentExchanges,
  transpositionCount,
  transpositions,
} from '../src/util/combinatorics.js';

describe('D.1 transpositions', () => {
  it('matches the heterogeneous example in the rules', () => {
    // "if the bracket is heterogeneous with two MDPs, it is:
    //  3-4, 3-5, 3-6, ..., 3-11, 4-3, 4-5, ..., 11-10 (72 transpositions)"
    const s2 = [3, 4, 5, 6, 7, 8, 9, 10, 11];
    const all = [...transpositions(s2, 2)].map((t) => t.slice(0, 2).join('-'));

    expect(all).toHaveLength(72);
    expect(all.slice(0, 3)).toEqual(['3-4', '3-5', '3-6']);
    expect(all[8]).toBe('4-3');
    expect(all[all.length - 1]).toBe('11-10');
  });

  it('produces 720 orderings for the 11-player homogeneous example', () => {
    // "e.g. in a 11-player homogeneous bracket, it is 6-7-8-9-10, 6-7-8-9-11,
    //  ..., 11-10-9-8-7 (720 transpositions)"
    const s2 = [6, 7, 8, 9, 10, 11];
    const all = [...transpositions(s2, 5)].map((t) => t.slice(0, 5).join('-'));

    expect(all).toHaveLength(720);
    expect(transpositionCount(6, 5)).toBe(720);
    expect(all[0]).toBe('6-7-8-9-10');
    expect(all[1]).toBe('6-7-8-9-11');
    expect(all[all.length - 1]).toBe('11-10-9-8-7');

    // The last ordering that still begins with 6, as the rule's example says.
    const startingWithSix = all.filter((t) => t.startsWith('6-'));
    expect(startingWithSix[startingWithSix.length - 1]).toBe('6-11-10-9-8');
    expect(all[startingWithSix.length]).toBe('7-6-8-9-10');
  });

  it('is in ascending lexicographic order throughout', () => {
    const all = [...transpositions([1, 2, 3, 4, 5], 3)].map((t) => t.slice(0, 3));
    for (let i = 1; i < all.length; i++) {
      const previous = all[i - 1];
      const current = all[i];
      const firstDifference = previous.findIndex((v, k) => v !== current[k]);
      expect(firstDifference).toBeGreaterThanOrEqual(0);
      expect(current[firstDifference]).toBeGreaterThan(previous[firstDifference]);
    }
  });

  it('leaves the players beyond the first N1 in ascending order', () => {
    for (const t of transpositions([1, 2, 3, 4, 5], 2)) {
      const tail = t.slice(2);
      expect([...tail].sort((a, b) => a - b)).toEqual(tail);
    }
  });
});

describe('D.2 resident exchanges', () => {
  it('starts with the identity, then single swaps', () => {
    const list = [...residentExchanges([1, 2, 3], [4, 5, 6])];
    expect(list[0]).toEqual({ fromS1: [], fromS2: [] });
    expect(list[1].fromS1).toHaveLength(1);
    expect(list.slice(1, 10).every((e) => e.fromS1.length === 1)).toBe(true);
  });

  it('prefers the smallest gap between what leaves S1 and what enters it', () => {
    // In an 11-player bracket, "exchanging 6 with 4 is better than 8 with 5".
    const s1 = [1, 2, 3, 4, 5];
    const s2 = [6, 7, 8, 9, 10, 11];
    const singles = [...residentExchanges(s1, s2, 1)].slice(1);
    const label = (e: { fromS1: number[]; fromS2: number[] }) =>
      `${s1[e.fromS1[0]]}<->${s2[e.fromS2[0]]}`;
    const order = singles.map(label);

    expect(order.indexOf('5<->6')).toBeLessThan(order.indexOf('4<->6'));
    expect(order.indexOf('4<->6')).toBeLessThan(order.indexOf('5<->8'));
  });

  it('enumerates every swap of each size exactly once', () => {
    const list = [...residentExchanges([1, 2, 3], [4, 5, 6])];
    // 1 identity + 9 single + 9 double + 1 triple
    expect(list).toHaveLength(1 + 9 + 9 + 1);
    const keys = list.map((e) => `${e.fromS1.join(',')}|${e.fromS2.join(',')}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('maximum matching', () => {
  it('pairs everyone in a complete graph', () => {
    expect(maximumMatching(10, () => true)).toBe(5);
    expect(maximumMatching(11, () => true)).toBe(5);
  });

  it('handles an odd cycle, which is what blossoms are for', () => {
    // A 5-cycle: 0-1-2-3-4-0. Maximum matching is 2.
    const edges = new Set(['0-1', '1-2', '2-3', '3-4', '0-4']);
    const compatible = (a: number, b: number) =>
      edges.has(`${Math.min(a, b)}-${Math.max(a, b)}`);
    expect(maximumMatching(5, compatible)).toBe(2);
  });

  it('finds the perfect matching when only one exists', () => {
    // 0-1 and 2-3 are the only edges.
    const edges = new Set(['0-1', '2-3']);
    const compatible = (a: number, b: number) =>
      edges.has(`${Math.min(a, b)}-${Math.max(a, b)}`);
    expect(maximumMatching(4, compatible)).toBe(2);
  });

  it('reports no pairs when the graph is empty', () => {
    expect(maximumMatching(6, () => false)).toBe(0);
  });
});

describe('minimum cost assignment', () => {
  it('finds the cheapest assignment', () => {
    // Rows want the diagonal, which costs nothing.
    const cost = (i: number, j: number) => (i === j ? 0 : 5);
    const { total, assignment } = minCostAssignment(3, 3, cost);
    expect(total).toBe(0);
    expect(assignment).toEqual([0, 1, 2]);
  });

  it('avoids the cheap first choice when it makes the rest expensive', () => {
    // Taking the cheapest cell for row 0 (column 0, cost 1) strands row 1 with
    // a cost of 10. Giving row 0 the slightly worse column 1 costs 3 in total.
    const table = [
      [1, 2],
      [1, 10],
    ];
    const { total, assignment } = minCostAssignment(2, 2, (i, j) => table[i][j]);
    expect(total).toBe(3);
    expect(assignment).toEqual([1, 0]);
  });

  it('handles more columns than rows', () => {
    const table = [
      [9, 1, 9],
      [9, 9, 2],
    ];
    const { total } = minCostAssignment(2, 3, (i, j) => table[i][j]);
    expect(total).toBe(3);
  });
});
