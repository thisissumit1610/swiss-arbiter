# Swiss Arbiter

[![CI](https://github.com/thisissumit1610/swiss-arbiter/actions/workflows/ci.yml/badge.svg)](https://github.com/thisissumit1610/swiss-arbiter/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

An offline-first tournament manager for Swiss-system chess, with a from-scratch
implementation of the FIDE Dutch pairing system and the current tie-break
regulations.

**→ [Open the app](https://thisissumit1610.github.io/swiss-arbiter/)** — install
it from the browser and it works with the network switched off.

Pairing a Swiss round is a constraint-satisfaction problem, not a sort. Two
players must never meet twice, nobody may have the same colour three rounds
running or drift more than two games away from an even split, and the odd player
out may not take a second bye — and every one of those has to hold while the
pairing still matches players on equal scores as closely as possible, across a
list of nineteen ranked quality criteria. The engine here implements that
literally, from the rule text, and is checked against it.

---

## What it does

- **FIDE Dutch pairings** (Handbook C.04.3) — score brackets, moved-down players,
  the S1/S2 split, transpositions and exchanges in the order the rules specify,
  the penultimate-pairing-bracket collapse, and colour allocation E.1–E.5.
- **Tie-breaks** under C.07 (the revision in force from 1 March 2026) — Buchholz
  and its cut and median variants, Sonneborn-Berger, direct encounter, wins,
  games with black, average rating of opponents, cumulative. Article 16's
  handling of unplayed rounds is implemented in full, including the distinction
  between a player's own tie-break and their contribution to an opponent's.
- **Works with no network at all.** The app is a PWA that precaches itself and
  keeps every tournament in IndexedDB on the device. There is no server, no
  account, and no request to anywhere.
- **TRF(x) import and export** — the fixed-column FIDE interchange format, so a
  tournament can be moved to or from Swiss-Manager, Vega, JaVaFo or bbpPairings,
  or submitted for rating.
- **Built for the hall** — printable pairing sheets and standings, bulk player
  entry that accepts a pasted list in whatever shape it arrives, half-point byes,
  withdrawals, late entrants, forfeits, and undo.

## Try it

```bash
git clone https://github.com/thisissumit1610/swiss-arbiter.git
cd swiss-arbiter
npm install
npm run dev
```

Then open the printed URL. To build for deployment:

```bash
npm run build
```

The result in `packages/app/dist` is a static site; it needs no backend.

## Layout

```
packages/
  engine/   the pairing engine, tie-breaks and TRF I/O — no dependencies, no DOM
  app/      the PWA that arbiters actually touch
docs/       how the code maps onto the rules, and how to run an event on it
```

The engine is deliberately separate and dependency-free. It is a set of pure
functions over plain data, so it runs the same in a browser, in Node and in a
test, and could be lifted into any other program unchanged.

```ts
import { createTournament, pairRound, computeStandings } from '@swiss-arbiter/engine';

const tournament = createTournament({
  name: 'Campus Open',
  totalRounds: 5,
  players: [
    { id: 'a', name: 'Ananya Sharma', rating: 1842 },
    { id: 'b', name: 'Rohit Verma', rating: 1655 },
    // …
  ],
});

const round1 = pairRound(tournament, 1);
console.log(round1.pairs);         // board, whiteId, blackId
console.log(round1.complete);      // false means no legal pairing exists
console.log(round1.exhaustive);    // false means legal, but not provably optimal
```

## How the pairing is actually found

The rules describe a strictly ordered sequence of candidate pairings and say:
take the first perfect one; failing that, take the best, ties going to whichever
was generated first. Taken literally that is hopeless — a twenty-player bracket
has 10! orderings of S2 alone, and a bracket twice that size is beyond counting.

The engine walks that same sequence but prunes it, in three layers:

1. **Absolute criteria prune subtrees.** A rematch or a forbidden colour clash
   kills every candidate below the node where it first appears, rather than being
   rediscovered once per completed permutation.
2. **A branch-and-bound on the quality criteria.** Criteria C.5 to C.19 are all
   counts that can only grow as more pairs are added, so a partial pairing whose
   totals already lose to the best candidate found so far cannot be rescued. The
   bound is admissible — it credits every score difference not yet decided to the
   best bucket it could land in — so pruning never discards a winner.
3. **The colour criterion is solved, not searched.** Which players are refused
   their colour preference is a bipartite assignment problem, so the Hungarian
   algorithm answers it exactly before the walk starts. That number becomes a
   hard target, which collapses the search: the adversarial twenty-four-player
   bracket in the test suite goes from exhausting a 120,000-node budget at a
   sub-optimal answer to finding the optimum in fourteen candidates.

Two graph algorithms sit underneath: **Edmonds' blossom algorithm** for maximum
matching, which decides whether a round can still be completed at all and drives
the C.7 lookahead, and the **Hungarian algorithm** above. Both are implemented
from scratch in `packages/engine/src/util/combinatorics.ts`.

When a bracket is too large to search to the end, the assignment solution is used
as the pairing and `exhaustive` on the result goes false — the pairing is legal
and good, but not proved to be the one the rules' own ordering would pick. The
app says so rather than quietly presenting it as gospel.

`docs/PAIRING_ALGORITHM.md` walks through the rule-by-rule mapping.

## Correctness

`npm test` runs 81 tests. The interesting ones are not fixed expectations but
properties, checked over hundreds of randomly played tournaments spanning field
sizes from 6 to 100, five to nine rounds, and forfeit rates up to 12%:

- no two players ever meet twice
- no colour difference outside ±2, and never the same colour three rounds running
- the last-round exception to those two rules is only ever spent on a pairing
  involving a topscorer, which is the only case C.04.3 permits it
- nobody receives a second pairing-allocated bye
- every player is accounted for in every round, and colours are symmetric
- **the engine never gives up on a round that was pairable** — checked against an
  independent maximum-matching oracle, so a genuinely impossible round (which a
  small field over many rounds really can produce, and which C.04.3.A.9 hands to
  the arbiter) is distinguished from an engine failure

Round one is verified against the classical construction by hand: top half against
bottom half in order, colours alternating down the top half by the drawn initial
colour. Transposition and exchange ordering is checked against the worked
examples in the rule text, including the 72-transposition heterogeneous case.

### A note on one rule

C.04.3.D.1's worked example for an eleven-player bracket lists its third ordering
as `6-7-8-10-11`. In strict lexicographic order the third is `6-7-8-10-9`, and
the example's own totals — 720 orderings, first `6-7-8-9-10`, last `11-10-9-8-7`,
last-beginning-with-6 `6-11-10-9-8` — are all consistent with plain lexicographic
order, as is the unambiguous 72-transposition heterogeneous example given
immediately after. The engine implements plain lexicographic order and the tests
pin it to the parts of the example that agree.

## Running a real tournament on it

`docs/ARBITER_RUNBOOK.md` is the checklist: what to do before the first round,
what to do between rounds, what to do when somebody turns up late or leaves, and
what to do if a laptop dies mid-event. The short version is: install it to the
home screen, enter the players, and export a backup at the end of every round.

## Standards implemented

| Document | What it covers |
| --- | --- |
| FIDE Handbook C.04.1 | Basic rules for Swiss systems |
| FIDE Handbook C.04.2 | General handling — initial order, late entries, colour history, publishing order |
| FIDE Handbook C.04.3 | The Dutch system itself (the version approved in Baku, 2016) |
| FIDE Handbook C.07 | Play-off and tie-break regulations (effective 1 March 2026) |
| TRF(x) | Tournament report format, fixed-column `001` records |

C.04.3 was revised with effect from 1 February 2026; the revision renumbers the
criteria and restructures the articles without changing the bracket mechanics.
This implementation follows the 2016 text, which is the version the published
reference implementations and test material are written against, and names the
rule it is applying at every decision point so a move to the new numbering is a
mechanical exercise.

## Licence

MIT — see [LICENSE](LICENSE).
