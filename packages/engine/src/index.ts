/**
 * @swiss-arbiter/engine
 *
 * A FIDE Dutch (C.04.3) Swiss pairing engine with tie-breaks and TRF(x) I/O.
 * No runtime dependencies and no I/O of its own — everything here is a pure
 * function over plain data, so it runs identically in a browser, in Node, and
 * in a test.
 */

export * from './types.js';
export * from './state.js';
export * from './order.js';
export * from './colour.js';
export * from './criteria.js';
export * from './bracket.js';
export * from './round.js';
export * from './tiebreaks.js';
export * from './standings.js';
export * from './trf.js';
export * from './tournament.js';
export { maximumMatching } from './util/combinatorics.js';
