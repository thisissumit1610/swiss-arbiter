# Contributing

## Getting set up

```bash
npm install
npm run dev          # the app, with the engine loaded from source
npm test             # 81 tests; takes about three minutes
npm run typecheck
npm run build
```

The engine is consumed from source by the dev server and the build, so there is
no build-order dependency between the two packages.

## Where things go

`packages/engine` has **no runtime dependencies and no DOM access**, and should
stay that way. It is a set of pure functions over plain data. If something needs
a browser API, it belongs in the app.

`packages/app` holds no pairing logic. If a screen needs to know something about
the rules, the answer comes from the engine.

## Changing the pairing engine

Two things make this code reviewable, and both are worth keeping:

**Cite the rule.** Every decision point names the article it implements —
`C.04.3.E.3`, `A.8`, `C.12`. A reader with the handbook open should be able to
check any line against it. If you cannot name the rule a piece of code is
implementing, that is worth resolving before writing it.

**Say why, not what.** The mechanics are usually clear from the code; what is not
clear is why a bound is admissible, or why ties are pruned, or why an unplayed
round is counted one way here and another way there. Those are the comments that
earn their place.

## Testing

The engine's tests are mostly properties rather than fixed expectations, because
a Swiss pairing has no single right answer that can be written down for every
input — but it has a great many things that must never be true. `test/helpers.ts`
holds the checks; `findViolations` is the important one.

If you touch the search, run the full sweep. It plays hundreds of tournaments
across field sizes from 6 to 100 and will find an absolute-rule violation that a
handful of examples would not.

Two rules of thumb learned from bugs already fixed:

- **A failing test is not necessarily an engine bug.** Twice during development
  the test was wrong: once about C.04.1.d (a second *forfeit win* is legal; only
  a second *allocated bye* is not) and once about the last-round exception to the
  colour rules. Check the rule text before changing the engine.
- **An incomplete round is not necessarily a failure either.** A small field over
  many rounds can genuinely run out of legal pairings, and C.04.3.A.9 hands that
  case to the arbiter. `roundWasPossible()` is the independent oracle that tells
  the two apart — use it rather than asserting every round completes.

## Performance

Pairing has to finish while an arbiter is standing over the laptop. The current
budget is 120,000 search nodes per pair-count per bracket; a 100-player round
takes a couple of seconds and a 400-player round under ten.

If you make the search slower, say so and explain what it buys. If you make it
faster by weakening a bound, check the bound is still admissible — the tests will
not necessarily catch a pruning bug, because a slightly worse legal pairing still
passes every invariant.

## Style

TypeScript, strict mode, no `any`. Prettier defaults with single quotes. Match
the surrounding code.
