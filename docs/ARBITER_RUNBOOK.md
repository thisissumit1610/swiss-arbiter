# Arbiter's runbook

What to do, in order, to run an event on this. Written to be followed by someone
who has not read the code.

## Before the day

1. Open the app and **install it**. In Chrome or Edge that is the install icon in
   the address bar; on iOS it is Share → Add to Home Screen. Installing is what
   guarantees the app is on the device rather than fetched when you open it, so
   it will start in a hall with no signal.
2. Open it once **with the network off** to confirm it starts. If it does not,
   the service worker did not install — reload once while online and try again.
3. Decide and write down, before anyone plays:
   - **the number of rounds** (C.04.1.a requires it to be declared in advance)
   - **the tie-break order** (Standings → Tie-breaks). The default is Buchholz
     Cut-1, Buchholz, Sonneborn-Berger, direct encounter, wins.
   - **who gets white on board 1 in round 1** — drawn by lot (C.04.3.E).

   Announce all three. Changing a tie-break after results exist changes who won.

## Entering the field

Players → **Paste a list** takes one player per line. Fields can be separated by
commas or tabs and given in any order:

```
Ananya Sharma, 1842, IND
FM Kabir Rao, 2105, IND
Rohit Verma, 1655
Meera Nair
```

A three or four digit number is read as a rating, three capitals as a federation,
a known abbreviation as a title, and the rest as the name. Unrated players are
fine — leave the number out and they seed last.

Check the starting list before round 1. Ratings drive the seeding, and seeding
drives every pairing after it. **Pairing numbers can be corrected up to round
four and are fixed after that** (C.04.2.B.3), so the app stops offering to
re-seed from round four onwards.

## Each round

1. **Rounds → Pair round N.**
2. Read the banner if there is one:
   - *Pairing found, but not proved optimal* — the pairing is legal and fine to
     publish. One bracket was too big to search exhaustively, so a marginally
     better arrangement of colours or floats might exist.
   - *This round could not be completed* — there is genuinely no legal pairing.
     See "When a round cannot be paired" below.
3. **Print.** The print layout drops the navigation and prints the board list
   with a blank result column, which is what goes on the wall and what you write
   on.
4. Enter results as they come in: `1–0`, `½–½`, `0–1`, or `ff` for a player who
   did not appear (press it twice to switch which side forfeited).
5. **Save round.** Boards left blank stay unplayed and can be filled in later —
   the round can be saved with games still running and the missing results added
   before the next pairing.
6. **Export → Full backup (JSON).** Every round. This takes five seconds and is
   the only thing standing between you and re-entering the tournament by hand.

Nothing is committed to the standings until you press Save, so a half-entered
round never affects a pairing.

## Things that come up

**Someone wants a round off.** Players → `½ bye` on their row, before pairing
that round. They are not paired and take half a point. Press it again to cancel.
A bye requested for the last round, or followed only by more absences, counts as
a draw in other players' Buchholz (C.07 art. 16.2.5) — the app handles that.

**Someone withdraws.** Players → Withdraw. They are not paired again, and their
existing results stay in everyone else's tie-breaks, which is correct. Reinstate
puts them back.

**Someone arrives late.** Add them; they are paired from the next round you pair.
If the field was even and is now odd, somebody starts getting a bye.

**A result was written down wrong.** Go back to that round with ‹ Previous — you
will see the pairings and results as played. To change one, re-pair is *not* what
you want: edit the round by re-entering it, or fix the exported JSON. Correcting
before the next pairing is published is what C.04.2.D.8 expects.

**Two players are given the same colour they had twice already.** This is only
legal in the last round, and only when the pairing involves a player above 50%
(C.04.1.f/g's last-round exception, narrowed by C.04.3.C.3). The engine will not
do it anywhere else.

**A player has already had a bye and the field is still odd.** The bye moves to
someone else — C.04.1.d forbids a second one. If every remaining player has had a
bye the round cannot be completed; see below.

## When a round cannot be paired

A small field over many rounds really can run out of legal pairings: with eight
players in round seven, the people who have not yet met may be exactly the ones
the scores keep apart. C.04.3.A.9 says this is the arbiter's decision, not the
software's, and the app will tell you rather than inventing something.

The usual remedies, in the order most arbiters try them:

1. Allow one repeat pairing, chosen as low down the standings as possible.
2. Give someone a second bye.
3. If a colour rule is the only obstacle and it is the last round, apply the
   last-round exception by hand.

Whichever you choose, announce it. Then record it by entering the round's results
as if the pairing had come from the app — the standings and tie-breaks will be
correct.

## Ending the tournament

1. Save the last round.
2. **Standings → Print.** Check the tie-break columns read the way you announced.
3. **Export → Standings (CSV)** for the notice board and the report.
4. **Export → FIDE tournament report (TRF)** if the event is being rated. Fill in
   the city, federation and chief arbiter fields first — rating submissions
   expect them.
5. **Export → Full backup (JSON)** and keep it somewhere other than the device.

## If the device dies

The tournament is in that browser's storage and nowhere else. With a backup:
import the JSON on any other device and carry on from the last round you
exported. Without one, the tournament is gone.

This is the trade for having no server and no account, and it is why the backup
step is in the per-round checklist rather than at the end.
