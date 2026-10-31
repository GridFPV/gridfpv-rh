# Stages

A stage is one RotorHazard class: a group of heats sharing a format, ranked together.
The day in order is a list of stages: practice, qualifying, brackets, Chase the Ace.

## Adding a stage

**Add stage** starts from a template (practice, qualifying, bracket, Chase the Ace, blank)
that sets the format, rounds, ranking and how many empty heats to make. Rounds are
either *races per heat* (every heat flies every round) or *grouped* (after a heat flies,
RotorHazard makes the next round's heat with a fresh lineup). **Ranked by** chooses the
class ranking; the default, "by the format's win condition", is what ranks a qualifying
stage by fastest consecutive laps.

## Folding a stage away

Each stage's heading folds it: click it to hide a finished stage and keep the day short.
**Stage settings** — format, rounds, ranking and what happens after a race — starts folded,
since it is set once when the stage is built; open it to change any of them. On a grouped or
bracket board each round folds on its own heading too.

## The board

Rows are heats, columns (or a strip) are rounds. A raced cell shows the winner; click it
for the result, to **run the heat again**, or to **delete the race** (a copy is kept, and
RotorHazard backs the database up first). **Restore** puts a deleted race back as long as
its heat still has the same stage and pilots. The next-round cell loads the heat on the
timer, and the loaded heat is marked **next**.

Click a heat to seat it. A seat holds a pilot, or seeds from another heat's result or the
class ranking; a stage with seeded seats is in **Plan** until **Seed now** fills them from
results. **Generate bracket…** builds a single-elimination bracket seeded from another
stage.

## Raced heats and stages

A raced heat's seats and a raced stage's format are locked, like on RotorHazard's own
page: **Unlock** warns that changing them changes saved results.

## Chase the Ace

One heat raced again and again until a pilot has won twice (or twice in a row, chosen when
adding the stage). The board tallies the wins and names the ace; a round nobody finishes
counts for no one. RotorHazard ranks the class by last heat position, so its Results page
agrees as long as the deciding race is the last one flown.
