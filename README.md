# Treenipaivakirja

Finnish, local-first resistance-training diary. Run `npm start` to serve the app.
Run `npm test` for pure logic and asset tests; `npm run test:progression` exercises
the progression UI in Chromium and WebKit. Browser tests use isolated storage.

The home screen prioritizes starting or resuming a workout. Backup reminders and
the coaching guide appear below the workout list; backup reminders and export
remain available with the same weekly schedule.

## Training statistics

Open **Tilastot** from home. All calculations and charts run locally,
including offline; no account, analytics service, CDN or external chart library
is needed. Statistics are derived from saved history, not separately accumulated
counters. A running or discarded workout is not counted.

The dashboard includes 4-week, 12-week, year, all-time and custom-date ranges,
routine/exercise filters, equivalent previous-period comparisons, completed and
working sets, actual reps, external-load volume, recorded session time, actual
timed work, an activity calendar, weekly charts/tables, exercise records and
session drill-down, primary exercise-category sets, per-set RIR distributions,
and recorded pain/fatigue flags. Charts have captions and accessible data tables.
The calendar shows at most the last 84 selected days; weekly charts/tables show
at most the last 104 selected weeks. Period totals still cover the entire range.
Exercise-session charts/tables use matching 50-session pages, with older and
newer navigation so long histories remain available without unbounded chart DOM.
Dates use the device's local calendar, Monday-start weeks and workout end dates.
Comparisons end at the equivalent local time, avoiding a full previous day being
compared with only part of today; custom past ranges include their whole last day.

### Recording and interpreting measurements

- Library selection now saves canonical identity, category, equipment and load
  convention. **Tilastojen liiketiedot** in the routine editor also lets you set
  the load convention and an equipment/technique identifier. Each routine's
  exercise identities remain separate, even for the same library exercise.
  Changing the exercise name, load convention or equipment identifier starts a
  separate performance series. Historical snapshots are never rewritten.
- Numeric loads are not sufficient to infer their meaning. Unknown, assisted,
  bodyweight and other-unit loads never become kg volume or estimated strength.
  Dumbbell loads stay per dumbbell, without silently doubling them. External
  volume is recorded kg times actual reps, including warm-ups; its cross-exercise
  total depends on exercise selection and is not muscle growth or mechanical work.
- Turn on **Kuormittavuuden kirjaus** in the settings (off by default; saved data
  is never hidden or removed by turning it off) to show **Kuormittavuus
  (valinnainen)** during training and enter actual reps (or
  seconds for a timed target), optional per-set RIR and working/warm-up type.
  Repetition/weight quick adjustments still work as before. New sessions with
  tracking metadata default to working sets; older unclassified records remain
  unclassified. The exercise-level hardest-set RIR is never assigned to all sets.
- Checked sets with no actual reps remain unknown. A blank actual load retains
  the existing "planned load used" convention. Zero recorded reps/load/time is
  distinct from missing data. Summary-only legacy history contributes only
  workout/set/time counts; detailed measurements are not reconstructed.
- Session time includes rests and time left open. Muscle-category counts show
  classified working sets in the library's primary category, not full direct and
  indirect muscle workload. Pain/fatigue are counts of explicit flags, not
  diagnoses or proof that unflagged sessions were pain-free or well recovered.
  Coverage and exclusions are visible alongside totals; recording more complete
  data can itself change comparisons.

### Combined progress: Kehitysindeksi

Choose 2-6 representative benchmark exercises in statistics. Each requires three
completed sessions with eligible working sets at the same per-set RIR (0-3),
with the latest within 28 local calendar days. Eligible sets have actual 1-10
reps and a known positive external kg load. Warm-ups, unknown set types,
pain-flagged exercises, fatigue-flagged sessions and snapshotted automatic deload
exercises cannot establish performance observations. This does not ask users to
test a true maximum or train to failure.

For each exercise and exact RIR, take the best eligible set estimate per session.
The estimate uses Epley's `load * (1 + reps / 30)`; a single rep uses its load
directly. No RIR is added to the rep count. Baseline and current performance are
the medians of the three most recent comparable sessions. Baselines, exact RIR
and the benchmark basket are frozen on explicit setup:

`index = 100 * exp(mean(log(current / baseline)))`

Each benchmark has equal weight. An index of 110 means the geometric aggregate
of these exercise-performance ratios is 10% above the saved baseline, **not**
10% more muscle, health or total-body strength. Adding sets/exercises does not
increase a benchmark's weight. A missing benchmark or one whose latest comparable
observation is older than 28 days suppresses the whole index; remaining weights
are never redistributed. Excluded deload/fatigue sessions neither create fake
losses nor keep old estimates fresh. Filter changes do not change the index.
Starting a new comparison explicitly replaces the old baseline/basket, not
workout history. Index configuration is backed up; merge preserves a locally
configured index, otherwise adopts and remaps the imported configuration.
Replacing with an older backup without an index clears the old configuration.

This index is an explainable **product heuristic**, not a scientifically
validated composite physiological measure. Three samples, exact-RIR matching,
equal weights and 28-day freshness are conservative design choices, not clinical
thresholds. Rep/load estimates vary by exercise, technique and person; subjective
RIR and changes in exercise execution remain sources of error.

Evidence informing the separation of performance, consistency and workload:
[ACSM 2026](https://acsm.org/resistance-training-guidelines-update-2026/),
[Currier et al. 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10579494/),
[Nuzzo et al. 2024, rep/1RM variability](https://pmc.ncbi.nlm.nih.gov/articles/PMC10933212/),
and [RIR measurement limitations](https://pmc.ncbi.nlm.nih.gov/articles/PMC4961270/).
Chart alternatives follow [W3C complex-image guidance](https://www.w3.org/WAI/tutorials/images/complex/).
These sources do not validate the composite index itself.

All metadata and index settings are additive schema-1 fields. Existing storage
keys, backup envelopes and old records remain compatible. Run `npm test` for
logic/compatibility tests and `npm run test:statistics` for mobile Chromium and
WebKit, accessibility, storage-failure, logging and offline coverage.

## Home-screen launch

Launching the installed app from its home-screen icon requests full-screen mode,
without browser controls, on devices that support the manifest's `fullscreen`
display mode. Unsupported platforms fall back to standalone mode. On iPhone and
iPad, install using Safari's Share > Add to Home Screen; iOS controls the status
bar and may keep system indicators visible even when browser controls are hidden.
Opening a normal bookmark or browser tab does not request full-screen mode.

For an existing installation, open the app online to receive the update, then
close all app windows and browser tabs for it and reopen using the installed
icon. Installed display settings may take additional time to update, depending
on the browser. Do not uninstall the app or clear site data to force an update:
training records are stored on the device. This change keeps the same start URL,
scope, storage keys and user data; no data migration or reset is required.

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
- A second **- / + stepper** on each set adjusts the weight by the exercise's weight
  step: the step saved in the routine, otherwise the automatic step for the planned
  weight (for example 2 kg at 22,5 kg, 2,5 kg at 100 kg). The step is fixed by the
  plan, so it stays the same while tapping. Decimals such as 22,5 are kept. It
  starts from the planned weight (0 when none is planned) and stores an override
  only while it differs from the plan. Weights that are not plain kilograms (for
  example `2 x 10 kg`) cannot be stepped.
- Tapping the number between the - and + buttons types an exact value instead
  (reps 0-100, weight 0-10 000 kg, decimal comma or point). Enter or leaving the
  field saves it, Escape cancels, an empty weight returns to the planned weight,
  and invalid input is reported without changing the record.
- Each movement shows the sets of its latest earlier workout ("Viimeksi ...").
  Sets without a logged rep count show the target, never an invented number.
- Mark sets done as before; tapping a set button or adjusting reps with the `-` / `+`
  buttons and `+ Sarja` is sufficient for automatic progression without opening the
  optional results panel. When RIR is not manually entered, effort is inferred
  from completed set performance relative to target. Turn on the logging setting and
  expand the exercise's optional
  panel to enter exact RIR (0-5; 5 means
  at least 5) or pain. Detailed completed workouts are visible in history.
- After saving, a summary card shows sets, duration and the known volume, with a
  "Muokkaa tulosta" shortcut for forgotten sets or weights.
- History lists 10 workouts and pages 20 more at a time. Each workout can be
  corrected (done state, reps, weight per set; duration can only be shortened) or
  deleted after confirmation, and a delete can be undone right away. Summary-only
  legacy entries can be deleted but have no sets to edit. Editing the workout that
  produced a progression revision tells you to run "Tarkista seuraava treeni" again;
  that recomputes from the targets that preceded the revision instead of stacking it.
- Rest intervals (`recommendedRestSeconds`) are calculated automatically for each
  exercise and set rather than requiring a manual global seconds setting:
  180 s for heavy multi-joint work (<= 6 reps), 120-150 s for moderate compound
  sets (lower-body and full-body movements receive 150 s, upper-body 120 s),
  75-90 s for single-joint isolation exercises, 60 s for core and conditioning,
  and 45 s for mobility. High effort (RIR <= 1), extra repetitions beyond target,
  or 4th+ working sets automatically extend the rest interval by 30 s (up to
  180 s for compounds and 120 s for isolation).
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
  their origin cannot safely be inferred. The editor's "Valitse toistoalue automaattisesti"
  explicitly opts a movement back into selection from its current prescription.
  Available weight steps and load semantics are retained. Manual limits support
  1-30; automatic selection does not prescribe near-maximal singles or doubles.
- Extra repetitions and extra completed sets are accounted for scientifically:
  - Completing planned sets at target with RIR >= 2 adds 1 rep per set.
  - Performing **extra repetitions** above the target advances the next workout
    directly to the demonstrated sustainable 2-RIR repetition capacity (`r + 1`
    at RIR >= 2, or `r - (2 - rir)` when pushing extra reps at RIR 0-1) instead
    of only adding +1 to the old target.
  - Performing **extra completed sets** (`+ Sarja`) at or above the target with
    RIR >= 2 increases the next session's working set count (capped at 5 working
    sets per exercise to prevent single-session junk volume) along with the
    repetition progression.
  - Surpassing the repetition ceiling via extra repetitions or completing extra
    working sets at the ceiling with RIR >= 2 confirms strength reserve in a
    single session and triggers an immediate load increase without waiting for a
    second ceiling session.
- At the range ceiling without extra reps or extra sets, require two consecutive,
  comparable successful workouts with RIR >= 2 before adding a load step. The
  increase cannot exceed 10%. Reduce reps according to the size of that step and
  the demonstrated repetitions (`ceil((30 + reps) * step / newWeight)`, at least
  one rep).
- Load increments (`automaticWeightStep`) scale automatically with exercise
  biomechanics and working weight (0.25-2.5 kg, or up to 2 steps when a large
  repetition/set surplus is demonstrated while remaining <= 10% of load) so lighter
  isolation movements and narrower strength ranges progress automatically without
  manual step configuration. Numeric kg loads are supported. Bodyweight, compound
  notation, other units, assisted/band movements, or disabled external-load
  progression never receive guessed load changes.
- Explicit poor recovery, acute severe failure (< 70% of target reps at RIR 0),
  or two comparable sessions achieving less than 90% of total target reps at
  RIR <= 1 triggers an automatic recovery deload: approximately
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
History keeps up to 10,000 completed workouts (the oldest are trimmed beyond that).
Browser storage (`localStorage`, usually about 5 MB) is the practical limit; if a
write fails the app shows the storage warning and offers an export. Backup files up
to 50 MB can be imported.
Quick rep and weight adjustments reuse the existing optional `actualReps` and
`actualWeight` fields (the per-set text inputs were replaced by steppers; sessions
saved with free-text values such as `97,5` or `105 lbs` keep them unchanged, and
non-kilogram values simply show disabled weight buttons). They survive
reload, workout completion, and backup/restore without any additional migration.
Untouched sets still have unknown actual reps; planned targets are never silently
copied into performance history merely by marking a set done.
A session exercise may carry one more optional field, `weightStep`, copied from a
routine's saved progression step when a workout starts. Sessions and history
without it use the automatic step; nothing is migrated or rewritten.
A corrected history record may carry one more optional field, `editedAt` (a timestamp);
records without it are unchanged. Deleting a workout removes it from history and
statistics and is saved as a critical write; the undo banner lives only until the page
is reloaded, so use a backup export if you need a longer safety net. Merging an older
backup into the app can bring back workouts deleted since (the local copy wins only
when the same workout still exists locally); use replace to restore a backup exactly.

Normalization happens in memory, without replacing saved browser bytes on load.
It is deterministic for valid saved records and safe to retry. Successful writes
and imports use the existing origin-wide write lock and latest-state/conflict
checks. Revision, undo, opt-in, and finish are critical writes: a quota or storage
failure cannot partially commit the history, delete an active session, or replace
the routine with an unpersisted revision. The app shows a storage warning and
provides retry/export recovery using the retained data; no prior backup is needed.
Merge/replace imports include all new metadata. The service worker caches all
application assets together and does not force an update over existing windows.
When merge creates a separate copy of a conflicting routine, its incoming history and active session
are linked to that copy; repeating that import reuses the same copy.

## Data safety and hosting

- Saved data that cannot be read (corrupt JSON or an unexpected shape) is never
  overwritten. Writes are blocked and the app offers "Vie alkuperäiset tiedot"
  (export the raw text) and "Aloita tyhjästä", which first stores a verified copy
  under `gym-tracker-v1-unreadable-<timestamp>` before starting fresh.
- Result fields update in place while typing, so the mobile keyboard stays open.
- Export in an installed iOS app uses the system share sheet; elsewhere it downloads
  a file. The "last backup" time is recorded only after delivery succeeds.
- `npm start` serves on `127.0.0.1` only. To test on a phone over the LAN use
  `npm start -- 8080 0.0.0.0`; note that service workers/install need HTTPS or localhost.
- `index.html` carries a Content-Security-Policy `<meta>` so the policy also applies
  on static hosts; `serve.mjs` additionally sends it as a header.
- A maskable icon (`icon-maskable-512.png`) is included for Android adaptive icons.

## Installed-app updates

Opening from the installed desktop/home-screen icon checks for a new version.
Returning to the app (including an already-open standalone window) and reconnecting
to the network check again. A fully downloaded update shows an accessible
"Uusi versio saatavilla" notice on every view, with "Päivitä nyt" and "Myöhemmin".
Finding an update does not reload the app or steal focus from an editor.
Postponement lasts until the next launch or foreground visit.

Accepting an update activates the downloaded worker and reloads the app only
after outstanding changes and any draft can be saved. Storage failures or
conflicts block activation and show recovery guidance; in-memory progress and
the original saved data are retained for retry. Saved running sessions, actual
reps, targets, history, imports, revision/undo metadata and rest timers use the
same storage keys and resume after reload. Editor drafts use the same tab's
session storage. No data migration, uninstall, clearing storage or prior backup
is required for this update mechanism.

Immediate activation requires closing other windows/tabs of this app, so an
update cannot interrupt their workouts or unsaved drafts. The worker checks
this itself before accepting the activation request. Without explicit acceptance,
normal service-worker activation still waits until old clients close.

Offline launches keep the cached version. An already-downloaded update can be
accepted offline; otherwise reconnection checks for a download. Failed checks,
incomplete asset downloads and activation failures show retry guidance rather
than reporting success. Check failures appear below the app without displacing
workout controls. The current version stays usable. Run `npm run test:updates`
for real two-version lifecycle and data-preservation tests in Chromium and WebKit.

An installation still running an older release without this prompt must first
receive this release through the existing close-all-windows/reopen update flow.
Do not uninstall the app or clear browser/site data to force it.
