# M12 — Analytics + Review Report

**Completed:** 2026-09-12  
**Status:** implementation complete; Windows acceptance passed; freeze recommended  
**Boundary:** M0–M11 preserved; M13 not started

## Outcome

M12 adds pip-first, lineage-aware Analytics and an evidence-backed Review learning loop. It reads immutable/runtime-authoritative facts and creates append-only study records; it does not change frozen execution, protection, reconciliation, MT5, or LIVE permissions.

## Analytics implementation

The new pure `@arise/analytics` package provides explicit `AVAILABLE` / `UNAVAILABLE` metrics and deterministic calculations:

- **Realized pips:** quantity-weighted exit distance from the weighted actual entry price for each Position.
- **Open pips:** current marked distance from weighted entry for remaining broker quantity.
- **Position-pips:** sum of `quantity × pips` across realized fills plus remaining marked exposure.
- **Scouting cost:** absolute recorded pip cost of failed/scratch Attempts; a missing failed-Attempt cost makes the metric unavailable.
- **Protected pips:** non-negative stop-secured pip distance, adjusted for the fraction of current quantity verified protected.
- **Average Scout loss:** average absolute realized-pip loss among Positions that never reached Survivor.
- **Survivor contribution:** position-pips from Positions that reached Survivor or later lifecycle states.
- **Millipede Efficiency:** Survivor contribution divided by scouting cost; absent/zero denominator is unavailable.
- **Longest-lived Leg:** elapsed time from the first Leg-or-later lifecycle event to close or the analytics `asOf` time.
- **Outcomes:** win/loss/BE only for terminal Positions with complete realized facts; incomplete outcomes remain a separate count.

Balance curves replay immutable exits. Equity curves replay exits plus timestamped marks and preserve gaps wherever an open Position lacks a mark. Both expose PIPS, POSITION-PIPS, and authoritative money. The global `$ HIDDEN` preference suppresses all monetary rendering without deleting raw values.

Exact dimensions are derived from the source IdeaVersion, StrategyMapVersion graph, referenced StrategyVersions/tags, UTC entry timestamp, direction, and immutable runtime approval provenance. Unsupported dimensions are counted as unavailable. In particular, trading session is not guessed from an entry hour.

Colony views preserve Position origin/current Colony IDs and traverse explicit promotion/consolidation lineage for campaign rollups. Failed Scouts remain visible alongside the larger Survivor/Leg/Runner contribution.

## Review implementation

The Review Lab supports:

`Trade / Colony → Dissection → Lesson → Repeated Pattern → Playbook Rule → Mastered / Archived`

- Review creation freezes the exact IdeaVersion, StrategyMapVersion where applicable, source analytics snapshot, and EvidenceEvent links.
- Dissection revisions append immutable narrative versions while retaining the original analytics snapshot.
- Lesson transitions are validated and cannot skip stages. Each LessonVersion retains evidence links.
- `PLAYBOOK_RULE` can create a Strategy change proposal with expected effect and validation requirements.
- Acceptance creates a new immutable `EXPERIMENTAL` StrategyVersion and never mutates the source; stale proposals are rejected.
- Main-process evidence verification exposes verified, missing, failed-capture, and corrupt asset states without renderer filesystem access.

## Persistence and application boundary

SQLite migration v11 adds:

- `position_performance_events`
- `performance_reviews`
- `review_dissection_versions`
- `review_evidence_links`
- `lessons`
- `lesson_versions`
- `lesson_evidence`
- `review_lesson_links`
- `strategy_change_proposals`
- `strategy_change_proposal_events`

Historical tables reject update/delete. Public typed IPC provides Analytics reads and Review/Lesson/Playbook actions. No renderer-direct database or broker access was introduced.

## Adversarial tests added or strengthened

- 12 pure analytics tests cover weighted partial entry fills, partial closes, quantity mismatch, missing exits/marks/protection/money, multiple Scouts, failed Scouts plus a large Runner, incomplete outcomes, zero-trade behavior, all metric units, equity gaps, `$ HIDDEN`, grouping, and promoted/consolidated identity.
- 5 Analytics/Review repository tests cover multi-Colony lineage rollup, human approval from immutable runtime confirmation, automatic qualification, unsupported sessions, authoritative-fact deduplication, immutable rows, exact Dissection snapshots/revisions, every Lesson stage, EXPERIMENTAL Playbook versioning, skipped-stage rejection, and stale-proposal rejection.
- Migration tests verify schema v11 and the M12 tables/triggers.
- Desktop IPC tests verify corrupt Evidence assets are reported distinctly.
- The new Electron E2E journey covers empty/unknown analytics, `$ HIDDEN`, Dissection → Lesson → Pattern → Playbook acceptance, exact old Idea/Strategy identity after revisions, and durable restart reconstruction.
- Existing M0–M11 unit/integration/Electron suites remain green.

## Acceptance results

- `pnpm install --frozen-lockfile` — passed
- `pnpm check` — passed: typecheck, lint, **616 tests**
- `pnpm build` — passed
- `pnpm test:e2e` — **13 passed** on Windows
- `pnpm dev` — Electron/Vite process launched and remained healthy; intentionally stopped after smoke observation
- `pnpm --filter @arise/desktop native:node` — passed after Electron validation
- post-restore `pnpm --filter @arise/database test` — **71 passed**

## Files changed

- `AGENTS.md`
- `docs/CURRENT_MILESTONE.md`
- `docs/PROJECT_ROADMAP.md`
- `apps/desktop/M12_REPORT.md`
- `pnpm-lock.yaml`
- `tsconfig.base.json`
- `packages/analytics/package.json`
- `packages/analytics/tsconfig.json`
- `packages/analytics/src/index.ts`
- `packages/analytics/src/analytics.test.ts`
- `packages/database/package.json`
- `packages/database/src/index.ts`
- `packages/database/src/schema.ts`
- `packages/database/src/migrations.ts`
- `packages/database/src/migrations.test.ts`
- `packages/database/src/analytics-review-repository.ts`
- `packages/database/src/analytics-review-repository.test.ts`
- `packages/shared/src/ipc.ts`
- `apps/desktop/src/main/main.ts`
- `apps/desktop/src/main/ipc.ts`
- `apps/desktop/src/main/ipc.test.ts`
- `apps/desktop/src/preload/preload.ts`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/ReviewWorkspace.tsx`
- `apps/desktop/src/renderer/AnalyticsWorkspace.tsx`
- `apps/desktop/src/renderer/PerformanceReviewLab.tsx`
- `apps/desktop/src/renderer/styles.css`
- `apps/desktop/e2e/analytics-review.spec.ts`

## Safety invariants verified

- M12 is read/study-only with respect to broker state and does not emit or widen broker commands.
- Renderer access remains isolated behind typed IPC.
- Existing M9 reconciliation, M10 execution, M11 protection, idempotency, manual/external isolation, UNKNOWN/BLOCKED, SHADOW/DEMO, and broker-authoritative behavior is unchanged and remains covered by the green frozen suites.
- LIVE remains unavailable.
- Missing or inconsistent data is explicit rather than inferred.
- Historical Idea, Strategy, map, Review, Lesson, evidence, and performance facts remain immutable/versioned.

## Limitations

- Session analytics remain unavailable until an authoritative session fact exists.
- Money is calculated only from authoritative supplied monetary facts; no currency conversion or broker-charge estimation is invented.
- Frozen M11 management close results record actual quantity but not execution price. A corresponding authoritative M12 `EXIT_FILL` fact is therefore required for realized price analytics; otherwise dependent metrics remain unavailable.
- No M13 production/live-readiness hardening was implemented.

## Recommendation

**M12 FREEZE**
