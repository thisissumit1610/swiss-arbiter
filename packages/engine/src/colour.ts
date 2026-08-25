/**
 * Colour allocation for a decided pair (C.04.3.E).
 *
 * Applied in descending priority:
 *   E.1  grant both colour preferences
 *   E.2  grant the stronger preference; if both are absolute, grant the wider
 *        colour difference
 *   E.3  alternate the colours from the most recent round in which one player
 *        had white and the other black  (played games only — C.04.2.D.5)
 *   E.4  grant the preference of the higher-ranked player
 *   E.5  if the higher-ranked player has an odd pairing number give them the
 *        initial-colour, otherwise the opposite colour
 */

import type { Colour } from './types.js';
import type { PlayerState, PreferenceStrength } from './state.js';
import { opposite } from './state.js';
import { comparePairingOrder } from './order.js';

/** Which E-rule decided a colour — recorded so the arbiter can explain a pairing. */
export type ColourRule = 'E.1' | 'E.2' | 'E.3' | 'E.4' | 'E.5';

export interface ColourAllocation {
  whiteId: string;
  blackId: string;
  rule: ColourRule;
}

const STRENGTH_RANK: Record<PreferenceStrength, number> = {
  absolute: 3,
  strong: 2,
  mild: 1,
  none: 0,
};

/**
 * Decide who plays white.
 *
 * `initialColour` is the colour drawn by lot before round 1 and is only reached
 * by E.5.
 */
export function allocateColours(
  a: PlayerState,
  b: PlayerState,
  initialColour: Colour,
): ColourAllocation {
  // Order the two so that `high` is the higher-ranked player (C.04.3.A.2).
  const [high, low] = comparePairingOrder(a, b) <= 0 ? [a, b] : [b, a];

  const ph = high.preference;
  const pl = low.preference;

  // E.1 — the preferences are compatible (including when one side has none).
  if (ph.colour && pl.colour && ph.colour !== pl.colour) {
    return withWhite(high, low, ph.colour, 'E.1');
  }
  if (ph.colour && !pl.colour) return withWhite(high, low, ph.colour, 'E.1');
  if (!ph.colour && pl.colour) return withWhite(high, low, opposite(pl.colour), 'E.1');

  // Neither has played: nothing to grant, fall through to E.5.
  if (!ph.colour && !pl.colour) {
    return byInitialColour(high, low, initialColour);
  }

  // Both want the same colour.
  const sh = STRENGTH_RANK[ph.strength];
  const sl = STRENGTH_RANK[pl.strength];

  // E.2 — grant the stronger preference.
  if (sh !== sl) {
    const winner = sh > sl ? high : low;
    const colour = sh > sl ? ph.colour! : pl.colour!;
    return winner === high
      ? withWhite(high, low, colour, 'E.2')
      : withWhite(high, low, opposite(colour), 'E.2');
  }

  // E.2 continued — both absolute: the wider colour difference wins.
  // C.3 forbids this for non-topscorers, so in practice it is reached only in a
  // final round involving topscorers.
  if (ph.strength === 'absolute') {
    const dh = Math.abs(high.colourDifference);
    const dl = Math.abs(low.colourDifference);
    if (dh !== dl) {
      return dh > dl
        ? withWhite(high, low, ph.colour!, 'E.2')
        : withWhite(high, low, opposite(pl.colour!), 'E.2');
    }
  }

  // E.3 — go back to the most recent round in which the two played different
  // colours, and swap them relative to that round.
  const e3 = alternateFromDivergence(high, low);
  if (e3) return withWhite(high, low, e3, 'E.3');

  // E.4 — the higher-ranked player gets their preference.
  if (ph.colour) return withWhite(high, low, ph.colour, 'E.4');

  // E.5 — fall back to the drawn initial colour.
  return byInitialColour(high, low, initialColour);
}

/**
 * E.3: walk both colour histories backwards in step and find the most recent
 * round in which one had white and the other black; the higher-ranked player
 * then takes the colour they did *not* have then.
 *
 * Only played games are in these histories (C.04.2.D.5), so index i is the i-th
 * game each player actually played, which is what "the most recent time" means
 * once unplayed rounds have been squeezed out.
 */
function alternateFromDivergence(
  high: PlayerState,
  low: PlayerState,
): Colour | null {
  const hh = high.colourHistory;
  const lh = low.colourHistory;
  const n = Math.min(hh.length, lh.length);
  for (let i = n - 1; i >= 0; i--) {
    if (hh[i] !== lh[i]) {
      return opposite(hh[i]);
    }
  }
  return null;
}

/** E.5 — odd pairing number gets the initial colour. */
function byInitialColour(
  high: PlayerState,
  low: PlayerState,
  initialColour: Colour,
): ColourAllocation {
  const colour =
    high.pairingNumber % 2 === 1 ? initialColour : opposite(initialColour);
  return withWhite(high, low, colour, 'E.5');
}

function withWhite(
  high: PlayerState,
  low: PlayerState,
  highColour: Colour,
  rule: ColourRule,
): ColourAllocation {
  return highColour === 'white'
    ? { whiteId: high.id, blackId: low.id, rule }
    : { whiteId: low.id, blackId: high.id, rule };
}
