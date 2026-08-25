# Tie-breaks

Implementing FIDE C.07 — the Play-Off and Tie-Break Regulations in force from
1 March 2026.

The sums themselves are trivial. What is not trivial, and what most
implementations get wrong, is article 16: what a round nobody played is worth.

## Two different adjustments

An unplayed round is counted **twice**, in two different ways, and confusing them
is the classic bug.

### Article 16.3 — the player as somebody else's opponent

When a player appears in an opponent's Buchholz, the score they contribute is
*adjusted*. Rounds they did not play count as the result matching the points they
were awarded — with one exception:

> **16.2.5** — a requested bye followed only by further voluntary unplayed
> rounds, or falling in the final round, counts as a draw.

So a player who takes a zero-point bye in the last round contributes 0.5 for that
round to everyone else's Buchholz, even though they scored nothing. Without this
rule, taking a bye late would quietly damage the tie-breaks of everyone who had
played you.

A *voluntary* unplayed round (VUR) means a requested bye or a forfeit loss — a
round the player was not available for. A pairing-allocated bye is not voluntary.

`adjustedScore()` in `tiebreaks.ts` implements this. It is the only place a score
differs from the plain sum of points.

### Article 16.4 — the player's own tie-break

For the player's *own* Buchholz or Sonneborn-Berger, a round they did not play is
treated as a game against a dummy, and what matters is what score that dummy is
credited with. It is capped:

- **16.4.1**, after a forfeit — by the scheduled opponent's adjusted score.
- **16.4.2**, otherwise — by draw-points × number of rounds.

The engine credits the dummy with the points the player was awarded for that
round, subject to the cap. So in a nine-round event a pairing-allocated bye
contributes `min(1, 0.5 × 9) = 1`, a half-point bye contributes 0.5, and a
zero-point bye contributes 0.

This reading is stated plainly because the regulation leaves room for others: the
cap is unambiguous, the base value less so. Every case is covered by a test in
`test/tiebreaks.test.ts`, so anyone who wants a different reading can see exactly
what changing it would affect.

## The cut rules and article 16.5

Cut-1 normally drops the lowest opponent score. Where a player has voluntary
unplayed rounds, 16.5.1 changes which value goes: the lowest contribution coming
from a VUR is cut instead, as long as it is not lower than the least significant
value. This stops a player from benefiting twice from a bye — once by not having
to play, and again by having the bye's low contribution be the one the cut
removes anyway.

`cutLowest()` implements this. It is applied to Buchholz Cut-1 and Cut-2, Median
Buchholz, and Sonneborn-Berger Cut-1.

## What is implemented

| Tie-break | Article | Notes |
| --- | --- | --- |
| Buchholz | 8.1 | Sum of opponents' adjusted scores |
| Buchholz Cut-1, Cut-2 | 14.1.1 | With the 16.5 VUR rule |
| Median Buchholz-1 | 14.3 | Cuts the least, then the most significant |
| Sonneborn-Berger | 9.1 | Opponent's score × points scored against them |
| Sonneborn-Berger Cut-1 | 14.1.1.d | With the 16.5 VUR rule |
| Direct encounter | 6 | Only when every tied player has met every other |
| Number of wins | 7.1 | Counts rounds worth a win, played or not |
| Wins with black | 7.4 | Over the board only |
| Games with black | 7.3 | Over the board only |
| Average rating of opponents | 10.1 | Played games only; .5 rounds up |
| Cumulative (progressive) | — | Widely used, not a FIDE type letter |

## Direct encounter

Article 6 only applies when all the tied players have met each other. When they
have not, the tie-break does not apply, and `directEncounter()` returns `null` so
the caller falls through to the next tie-break rather than treating a missing
game as a zero. In the standings table this shows as `–`.

Article 6.1.2: where two tied players met more than once, their *average* score
across those games is used, not the sum.

## How the list is applied

Article 4.2 is specific: a tie-break is applied only to the players still tied
after the previous one. So the groups get narrower as the list is worked through,
rather than every tie-break being computed against the whole field. That is why
`computeStandings` refines recursively — and why direct encounter can give
different answers depending on which tie-breaks precede it, since the set of
"tied players" it looks at is whatever is still tied at that point.

A tie that survives the whole list is marked shared (`1=`) rather than broken
arbitrarily. Article 4.2 leaves such ties to be resolved by drawing lots, which
is the arbiter's job and not the software's.

## Choosing a list

Set it in Standings → Tie-breaks, and **announce it before the tournament
starts**. Changing the order after results exist changes who won. The default is
Buchholz Cut-1, Buchholz, Sonneborn-Berger, direct encounter, wins — a common
choice for Swiss opens, and the one most players will expect.
