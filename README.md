# Treenipaivakirja

Finnish, local-first resistance-training diary. Run `npm start` to serve the app.
Run `npm test` for pure logic and asset tests; `npm run test:progression` exercises
the progression UI in Chromium and WebKit. Browser tests use isolated storage.

## Workout progression

Each routine has an **off-by-default** automatic revision switch and a manual
"Tarkista seuraava treeni" button. Automatic revision runs in the same persisted
transaction as finishing a workout. A report explains every changed or retained
exercise. "Peru tarkistus" restores the previous prescription exactly, including
individual set targets. It survives reloads and backup/restore. Undo never removes
history or changes an active session. A session is consumed only once, even after
undo, so repeated clicks or another tab cannot compound the same recommendation.
Intervening exercise edits disable undo rather than overwriting those edits.

### Inputs and decision rules

- Use the **- / + buttons below each set** in training mode to adjust actual reps
  one at a time, before or after marking the set done. The first adjustment starts
  from that set's target (the upper end for a rep range). Further adjustments use
  the recorded actual count, bounded to 0-100. The set shows the actual count and
  its original target; adjustments never change the plan, mark the set done, or
  start a rest timer. Timed and nonnumeric targets have no rep-adjustment buttons.
- Mark sets done as before; expand the exercise's results panel to directly enter
  or clear actual reps and enter the hardest set's RIR (repetitions in reserve,
  0-5; 5 means at least 5). Quick adjustments and this panel use the same records.
  An empty actual weight means the planned weight was used. Empty reps or RIR mean
  unknown, not success. Detailed completed workouts are visible in history.
- There is **no universal 8-15 range**. For the combined mass/strength goal,
  absent saved limits, choose a pragmatic band from the existing prescription:
  3-6 for already low-rep strength work; 6-12 for moderate mixed work; 10-20
  for identifiable isolation movements or already longer sets; 15-30 for
  prescriptions already above 20. Include existing lower individual-set targets
  rather than discarding them. Unknown exercises are not assumed to be compound
  or isolation lifts. These bands are coaching choices, not proven optimal ranges.
- Freeze the chosen band on the first actual revision so adding reps cannot move
  its ceiling, and lowering reps with a load increase cannot switch to another band.
  Saved min/max limits remain authoritative, including older 8-15 settings:
  their origin cannot safely be inferred. The editor's "Laske kehitysalue uudelleen"
  explicitly opts a movement back into selection from its current prescription.
  Available weight steps and load semantics are retained. Manual limits support
  1-30; automatic selection does not prescribe near-maximal singles or doubles.
- With all prescribed sets completed at their targets and RIR >= 2, add at most
  one rep per set, without increasing load or set count.
- At the range ceiling, require two consecutive, comparable successful workouts
  with RIR >= 2 before adding one configured equipment step. The increase cannot
  exceed 10%. Reduce reps according to the size of that step instead of always
  dropping to the band's lower bound (for example, 15 at 100 kg becomes an initial
  target of 13 at 102.5 kg). The pacing rule subtracts
  `ceil((30 + reps) * step / newWeight)`, at least one rep. This is an explicitly
  approximate software heuristic, not a validated personal strength prediction.
  A step whose cautious target falls below the selected band is held for a smaller
  equipment step. Actual new-load reps/RIR determine subsequent decisions; never
  force predicted reps, and do not increase load and reps simultaneously.
- Each movement has its own equipment step (default 2.5 kg). Use the same load
  convention as the workout, e.g. one dumbbell's load rather than the pair's sum.
  Numeric kg loads are supported. Bodyweight, compound notation, other units,
  assisted/band movements, or disabled external-load progression never receive
  guessed load changes. Set the external-kg checkbox off for other load semantics.
- Incomplete work, missing logs, altered prescriptions or actual loads, and stale
  data do not justify increases. Comparisons require matching routine/exercise
  identities and prescriptions. The latest record must be <= 14 days old, and
  load confirmation requires consecutive non-overlapping sessions <= 21 days apart.
- Explicit poor recovery, or two comparable sessions achieving less than 90% of
  total target reps at RIR <= 1, can trigger a recovery prescription: approximately
  half the sets (rounded up), lower-bound reps, and around 10% less load when the
  available equipment permits a reduction of no more than 20%. Aim for RIR 3-4.
  This is a lighter **next session**, not an automatically scheduled calendar week.
  Continued fatigue holds that prescription; it does not keep halving volume.
  A successful, recovered session at RIR >= 2 restores the pre-deload prescription
  without additional progression. Manual prescription or progression-setting edits clear the recovery
  baseline so later revisions cannot undo the user's new plan.
- Pain blocks revision for the affected movement, including automatic deloads.
  The UI advises stopping painful exercise and seeking assessment when needed.
  Recovery, nutrition, sleep, technique and appropriate rests remain essential.

The exact RIR, confirmation, fatigue and recency thresholds above are transparent,
conservative software heuristics, **not a clinically validated coaching model** or
a guarantee of hypertrophy. The app does not measure muscle growth, infer maximum
strength from completed-set counts, diagnose overtraining, or insist on failure.

### Evidence

- [ACSM 2026 Position Stand](https://doi.org/10.1249/MSS.0000000000003897)
  and its [official summary](https://acsm.org/resistance-training-guidelines-update-2026/):
  137 systematic reviews, over 30,000 participants. Heavier loads (at least
  80% 1RM) enhanced maximal strength, and higher weekly volume enhanced hypertrophy.
  Training major muscle groups regularly, generally at least twice weekly, matters
  more than choosing a supposedly perfect rep count. Around 10 sets per muscle
  per week is a planning reference, not a universal minimum or license to add
  volume without considering recovery. This app has no validated 1RM, technique
  assessment or complete weekly muscle-workload model and does not invent them.
- [Currier et al., 2023 network meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC10579494/):
  higher-load prescriptions ranked well for strength and multiple-set prescriptions
  for hypertrophy. Several prescriptions were effective; uncertain comparisons do
  not establish a unique optimum, individual equivalence, or exact per-lift bands.
- [ACSM position stand: Progression Models in Resistance Training for Healthy
  Adults (2009)](https://doi.org/10.1249/MSS.0b013e3181915670):
  progressive overload, goal-specific rep ranges, and 2-10% load increases when
  the current workload is exceeded. The app's repeated-success and RIR requirements
  are conservative implementation choices, not a verbatim ACSM algorithm.
- [IUSCA position stand (2021)](https://doi.org/10.47206/ijsc.v1i1.81):
  resistance-training recommendations for hypertrophy; multiple loading ranges
  can build muscle. Neither 8-15 nor the software's alternative bands are uniquely
  optimal. Effort, recoverable volume, adherence, nutrition and sleep matter.
- [Resistance training to failure and non-failure in trained individuals
  (2020)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7725035/):
  one controlled study found similar adaptations without requiring failure;
  it does not establish a universal optimal RIR threshold.
- [Deloading expert Delphi consensus (2023)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/):
  reducing training stress, especially volume, may support fatigue management.
  Empirical evidence is limited; there is no universally validated deload schedule.

## Data compatibility and recovery

This is an additive schema-1 update. The existing `gym-tracker-v1` storage key,
user identity, origin and backup envelope are unchanged. Older routines acquire
`autoProgress: false`; missing repetition limits are selected from the exercise
and its existing prescription, while explicit saved limits remain untouched.
Changing only the equipment step does not silently create fixed repetition limits.
Existing targets, per-set targets, custom exercises, summary-only history, active
sessions, checked sets and rest timers remain accessible. Legacy summary-only
history is kept verbatim and never manufactured into performance observations.

New optional fields are actual reps/loads and effort/pain on session exercises,
fatigue on sessions, routine IDs and exercise snapshots on newly completed history
records, and progression configuration/revision/recovery metadata on routines.
Snapshots are independent: revising a plan cannot rewrite completed training.
The existing 100-workout history retention policy is unchanged.
Quick rep adjustments reuse the existing optional `actualReps` field. They survive
reload, workout completion, and backup/restore without any additional migration.
Untouched sets still have unknown actual reps; planned targets are never silently
copied into performance history merely by marking a set done.

Normalization happens in memory, without replacing saved browser bytes on load.
It is deterministic for valid saved records and safe to retry. Successful writes
and imports use the existing origin-wide write lock and latest-state/conflict
checks. Revision, undo, opt-in, and finish are critical writes: a quota or storage
failure cannot partially commit the history, delete an active session, or replace
the routine with an unpersisted revision. The app shows a storage warning and
provides retry/export recovery using the retained data; no prior backup is needed.
Merge/replace imports include all new metadata. The service worker caches the
new module with the app version and waits for existing tabs to close before
activating, preserving the running-workout update policy. When merge creates a
separate copy of a conflicting routine, its incoming history and active session
are linked to that copy; repeating that import reuses the same copy.
