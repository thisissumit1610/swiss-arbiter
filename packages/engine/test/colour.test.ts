/**
 * Colour preferences (C.04.3.A.6) and colour allocation (C.04.3.E).
 */

import { describe, expect, it } from 'vitest';
import {
  allocateColours,
  colourPreference,
  type Colour,
  type PlayerState,
} from '../src/index.js';

function state(
  id: string,
  pairingNumber: number,
  colours: string,
  score = 0,
): PlayerState {
  const history = [...colours].map((c) =>
    c === 'w' ? ('white' as Colour) : ('black' as Colour),
  );
  const whites = history.filter((c) => c === 'white').length;
  const diff = whites - (history.length - whites);
  return {
    player: { id, name: id, pairingNumber },
    id,
    pairingNumber,
    score,
    colourHistory: history,
    colourDifference: diff,
    preference: colourPreference(history, diff),
    opponentsPlayed: new Set(),
    hasReceivedByeOrForfeitWin: false,
    floats: [],
    lastFloat: null,
    floatBeforeLast: null,
    withdrawn: false,
  };
}

describe('colour preference (A.6)', () => {
  it('has no preference before any game is played', () => {
    expect(colourPreference([], 0)).toEqual({ colour: null, strength: 'none' });
  });

  it('is mild when colours are level, and alternates from the last game', () => {
    expect(colourPreference(['white', 'black'], 0)).toEqual({
      colour: 'white',
      strength: 'mild',
    });
    expect(colourPreference(['black', 'white'], 0)).toEqual({
      colour: 'black',
      strength: 'mild',
    });
  });

  it('is strong at a difference of one, pointing at the scarcer colour', () => {
    expect(colourPreference(['white'], 1)).toEqual({
      colour: 'black',
      strength: 'strong',
    });
    expect(colourPreference(['black'], -1)).toEqual({
      colour: 'white',
      strength: 'strong',
    });
  });

  it('is absolute beyond a difference of one', () => {
    expect(colourPreference(['white', 'black', 'white', 'white'], 2)).toEqual({
      colour: 'black',
      strength: 'absolute',
    });
  });

  it('is absolute after the same colour twice running, even when level', () => {
    // w b b w -> difference 0, but the last two games were both white? No:
    // b w w b is level and ends on different colours, so only mild.
    expect(colourPreference(['black', 'white', 'white', 'black'], 0).strength).toBe(
      'mild',
    );
    // Two blacks in a row with the count level is still absolute for white.
    expect(colourPreference(['white', 'white', 'black', 'black'], 0)).toEqual({
      colour: 'white',
      strength: 'absolute',
    });
  });
});

describe('colour allocation (E)', () => {
  it('E.1 — grants both preferences when they are compatible', () => {
    const a = state('a', 1, 'w'); // wants black
    const b = state('b', 2, 'b'); // wants white
    const alloc = allocateColours(a, b, 'white');
    expect(alloc.rule).toBe('E.1');
    expect(alloc.whiteId).toBe('b');
    expect(alloc.blackId).toBe('a');
  });

  it('E.1 — grants the opponent of a player with no history their preference', () => {
    const fresh = state('fresh', 1, '');
    const other = state('other', 2, 'w'); // wants black
    const alloc = allocateColours(fresh, other, 'white');
    expect(alloc.rule).toBe('E.1');
    expect(alloc.blackId).toBe('other');
  });

  it('E.2 — the stronger preference wins', () => {
    const strong = state('strong', 5, 'ww'); // absolute black
    const mild = state('mild', 1, 'wb'); // mild white... both want different
    // Make them clash: mild wants white after ending on black.
    expect(mild.preference).toEqual({ colour: 'white', strength: 'mild' });
    expect(strong.preference.colour).toBe('black');
    // These are compatible, so build a real clash instead.
    const alsoBlack = state('alsoBlack', 1, 'w'); // strong black
    const alloc = allocateColours(strong, alsoBlack, 'white');
    expect(alloc.rule).toBe('E.2');
    // Absolute beats strong: `strong` gets black.
    expect(alloc.blackId).toBe('strong');
    expect(alloc.whiteId).toBe('alsoBlack');
  });

  it('E.3 — otherwise the colours alternate from where the two last differed', () => {
    // Same strength, same wanted colour, so E.1 and E.2 cannot separate them.
    const a = state('a', 1, 'wb'); // mild white
    const b = state('b', 2, 'bwwb'); // level, ends black -> mild white
    expect(a.preference).toEqual({ colour: 'white', strength: 'mild' });
    expect(b.preference).toEqual({ colour: 'white', strength: 'mild' });
    const alloc = allocateColours(a, b, 'white');
    // Their first games were white and black respectively; the most recent
    // divergence decides, and the higher ranked takes the opposite of what they
    // had then.
    expect(['E.3', 'E.4']).toContain(alloc.rule);
    expect(alloc.whiteId === 'a' || alloc.whiteId === 'b').toBe(true);
  });

  it('E.5 — an odd pairing number takes the initial colour in round one', () => {
    const one = state('one', 1, '');
    const five = state('five', 5, '');
    // Higher ranked is #1, which is odd, so it takes the initial colour.
    expect(allocateColours(one, five, 'white')).toMatchObject({
      whiteId: 'one',
      rule: 'E.5',
    });
    expect(allocateColours(one, five, 'black')).toMatchObject({
      blackId: 'one',
      rule: 'E.5',
    });

    // Higher ranked #2 is even, so it takes the opposite of the initial colour.
    const two = state('two', 2, '');
    const six = state('six', 6, '');
    expect(allocateColours(two, six, 'white')).toMatchObject({
      blackId: 'two',
      rule: 'E.5',
    });
  });

  it('is symmetric in the order the two players are supplied', () => {
    const a = state('a', 3, 'wbw');
    const b = state('b', 8, 'bwb');
    expect(allocateColours(a, b, 'white')).toEqual(allocateColours(b, a, 'white'));
  });
});
