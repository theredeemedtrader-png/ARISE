# ARISE M1.1 — Core Domain Foundations

Baseline: `ARISE_M1_1_HANDOFF(1).zip`. M0 remains frozen and verified on Windows as supplied by the owner. This report covers M1.1 only; M1.2 has not been started. Canonical `/docs` files are unchanged.

## 1. Files changed

Modified:

- `packages/domain/src/idea.ts` — canonical Idea and pure lifecycle, plus the existing M0 factory re-export.
- `packages/domain/src/index.ts` — public exports for M1.1.
- `packages/database/src/idea-repository.ts` — type-only compatibility adjustment from `Idea` to `LegacyIdea`.

Added:

- `packages/domain/src/primitives.ts` — branded identities, immutable timestamps, validation errors and guards.
- `packages/domain/src/market.ts` — Instrument and Timeframe metadata.
- `packages/domain/src/idea-version.ts` — immutable thesis versions and successor helper.
- `packages/domain/src/colony.ts` — Colony, lineage, state events and transitions.
- `packages/domain/src/target.ts` — semantic Target, events and transitions.
- `packages/domain/src/lifecycle.ts` — transition validation and audit context.
- `packages/domain/src/legacy-idea.ts` — isolated frozen M0 record/factory behavior.
- `packages/domain/src/foundations.test.ts` — 97 new domain tests.
- `packages/domain/M1_1_REPORT.md` — this handoff report.

## 2. Domain types and entities added

Branded string identities: InstrumentId, TimeframeId, IdeaId, IdeaVersionId, ColonyId, ColonyLineageId, ColonyStateEventId, TargetId, TargetEventId, MarketObjectId and MarketObjectVersionId. Callers supply IDs; no generator or database semantics are embedded. The parser preserves accepted tokens exactly. Types distinguish entity IDs from labels and from other ID kinds. Token syntax excludes whitespace and `#`, rejecting the presentation-label examples in the specification.

Entities: Instrument, Timeframe, Idea, IdeaVersion, Colony, ColonyLineage, ColonyStateEvent, Target and TargetEvent. Supporting types include Direction, lifecycle/status unions, TargetManagementMode, ThesisSnapshot, Timestamp and TransitionContext.

Canonical factories return fresh frozen objects. Historical records contain only primitive values and readonly fields; timestamps are validated ISO UTC strings with milliseconds, avoiding mutable Date objects inside frozen history. All new canonical operations require caller-supplied time and IDs. Successive thesis versions retain Idea identity, increment versionNo and record the exact superseded version. Colony creation verifies the supplied original version belongs to its Idea and derives the instrument from that Idea.

## 3. State-machine rules

Colony implements exactly the explicit edges in `STATE_MACHINES.md` section 7:

| From | Allowed destinations |
| --- | --- |
| DORMANT | BUILDING, INVALIDATED |
| BUILDING | ESTABLISHED, DECAYING, INVALIDATED, COMPLETED |
| ESTABLISHED | MATURE, DECAYING, INVALIDATED, COMPLETED |
| MATURE | DECAYING, INVALIDATED, COMPLETED |
| DECAYING | INVALIDATED |
| INVALIDATED | COMPLETED |
| COMPLETED | None |

Idea uses the following conservative defaults because the canonical documents list states but do not enumerate edges:

| From | Allowed destinations |
| --- | --- |
| DRAFT | WATCHING, CANCELLED |
| WATCHING | ACTIVE, INVALIDATED, CANCELLED |
| ACTIVE | IN_PLAY, INVALIDATED, CANCELLED |
| IN_PLAY | TARGET_APPROACHING, INVALIDATED, CANCELLED |
| TARGET_APPROACHING | TARGET_HIT, INVALIDATED, CANCELLED |
| TARGET_HIT | COMPLETED |
| COMPLETED, INVALIDATED, CANCELLED | ARCHIVED |
| ARCHIVED | None |

Target uses these conservative defaults:

| From | Allowed destinations |
| --- | --- |
| ACTIVE | APPROACHING, INVALIDATED, REASSIGNED |
| APPROACHING | REACHED, INVALIDATED, REASSIGNED |
| REACHED | HIT, INVALIDATED, REASSIGNED |
| HIT, INVALIDATED, REASSIGNED | COMPLETED |
| COMPLETED | None |

Self-transitions and unlisted transitions fail explicitly. Manual-override metadata does not bypass the transition guard. Colony and Target transitions return both a frozen new state and a frozen event for a future atomic persistence operation. Event constructors also support independent event creation with transition validation. Events preserve reason, source, time, manual-override flag and optional correlation identity. The final Target COMPLETED transition also has an event.

Idea archivedAt is present exactly in ARCHIVED; Colony completedAt is present exactly in COMPLETED. Supplied times must be valid and not precede the entity/version being referenced. Transitions do not execute orders, move stops, infer management, invalidate an Idea from a Scout stop-out, or mutate another entity. Target REACHED and HIT are separate states/events. Management mode is retained across Target state transitions.

## 4. Tests and results

The 97 new tests cover identity stability and type separation; malformed IDs and timestamps; Instrument/Timeframe metadata; D/W/M calendar rules without H/A/E assignments; all directions; Idea lifecycle/archive semantics; version numbering, lineage, unchanged prior snapshots, reused immediate IDs and overflow rejection; cross-Idea Colony guards; all lineage kinds; every Colony/Idea/Target state pair; immutable audit events; target modes and destination shapes; explicit invalid states; determinism and absence of input mutation.

The state-pair tests cover 100 Idea, 49 Colony and 49 Target pairs against independent expected edge lists.

Previously completed validation passed on the isolated working copy: typecheck, lint, all 116 unit/integration tests (97 new + 19 frozen M0), and production build. Following a runtime reset, the three original-file edits were restored from the completed implementation and validation was repeated against the packaged working copy. No new scope was introduced during restoration.

Final acceptance results (pnpm 10.15.0):

| Command/check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed during implementation with pinned pnpm; lockfile unchanged |
| `pnpm check` (`typecheck`, `lint`, `test`) | Passed on the final restored source |
| `pnpm typecheck` | Passed through `check`, including existing Desktop/preload/test configurations |
| `pnpm lint` | Passed through `check`, including existing architecture import restrictions |
| `pnpm test` | 116 passed: 98 domain, 8 shared IPC, 5 database, 5 Desktop IPC |
| `pnpm build` | Passed on final source; renderer and Electron main/preload built |
| `pnpm test:e2e` | 1 failed at Electron launch due to missing X server / DISPLAY |
| Electron native SQLite rebuild within E2E | Passed |
| Byte comparison against uploaded handoff | Only the three listed original source files changed; all original tests/docs/configuration unchanged |

The 19 existing M0 unit/integration tests all pass unchanged. The GUI test does not reach its assertions in this environment; it is not counted as passed. Its decisive runtime message is `Missing X server or $DISPLAY`, followed by platform initialization failure.

Commands were run using the pinned pnpm executable; after the runtime reset it was invoked via `npm exec --yes --package=pnpm@10.15.0 -- pnpm ...`. New domain files were formatted using the existing Prettier dependency. An initial environment-provided pnpm 11 attempt blocked native build scripts; using the repository-pinned version resolved that setup issue without changes to dependency policy. Early validation attempts against a workspace copy that had reverted original files were discarded; the final source above was validated in an isolated copy and archived directly from it.

## 5. Compatibility outside packages/domain

Only `packages/database/src/idea-repository.ts` changes outside domain: its import, insert parameter, findById return and list return now name `LegacyIdea`. The executed SQL and returned record shape are identical to M0. This avoids falsely representing the old combined direction/timeframe record as the canonical Idea.

`createDraftIdea` retains M0 behavior, including its optional Date clock, solely for existing IPC/database smoke tests. New code should use `createIdea` and `createIdeaVersion`. There are no schema migrations, new persistence entities, IPC changes, Electron/renderer changes, dependency changes or configuration changes. All original M0 tests remain byte-for-byte unchanged.

## 6. Architecture/spec ambiguities and boundaries

- Idea and Target edge tables are implementation defaults, not edges explicitly mandated by the canonical docs. No shortcuts, revival, gap-price skipping or proximity rollback are inferred. Future product policy can deliberately extend these tables with tests.
- Colony routes are limited to the explicitly listed graph; e.g. DECAYING cannot go directly to COMPLETED, and DORMANT cannot go directly to COMPLETED.
- Asset class, target type, calendar rule and event source type have no canonical enum/schema. They remain validated nonempty semantic strings. Calendar rules are opaque metadata only; no TimeframeService or calendar-boundary calculations are implemented.
- Nullable exact-price and zone references remain independently nullable, including a semantic-only target. Finite zero/negative prices are allowed for general instruments. Target type does not imply a broker order or management action.
- REASSIGNED retires the old target semantically. Replacement Target creation and Colony target reassignment orchestration are deferred. A newly created Colony has no current target until a later explicit assignment operation.
- The pure successor helper validates the supplied previous version, immediate ID reuse, chronology and increment. Global ID uniqueness, current-head concurrency, full-chain uniqueness, referential existence, lineage-cycle checks and persistence-level ordering belong to higher layers. No storage or clock is consulted.
- Transition helpers can check time against entity creation; chronological ordering against prior events requires the historical event stream in a later application/persistence layer. Idea persistence must preserve consequential history; no extra IdeaStateEvent entity is introduced in this bounded task.
- `ASTRA_M1_1_TASK.md` calls later persistence M2, while PRODUCT_SPEC labels M2 Shell. This does not affect M1.1: persistence expansion and future milestone work remain deferred to the next explicit task.

The domain imports no UI, broker, filesystem or database implementation. Existing lint restrictions remain active. No trading logic was added to the renderer.

## 7. Remaining blockers and 8. Freeze recommendation

Remaining blocker: the updated M1.1 repository's Electron E2E smoke test must pass in a GUI-capable environment, preferably the owner's Windows setup. This environment has no X server / DISPLAY, so desktop status, renderer isolation and restart persistence could not be reverified through Electron here. Their unchanged M0 unit/integration checks pass.

Freeze recommendation: **M1.1 implementation is ready for final Windows verification, but M1.1 is not yet unconditionally ready to freeze.** Run `pnpm test:e2e` on this updated repository to close acceptance criterion 15. The supplied M0 Windows verification remains accepted and M0 remains frozen. No known domain-code blockers remain; the explicit lifecycle defaults and other spec ambiguities above remain visible for review. M1.2 has not been started.

## Windows validation of this handoff

From the extracted ARISE repository, using pnpm 10.15.0:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test:e2e
```

Run Node tests before Electron's native rebuild. If running Node tests again after Electron E2E, use the existing `pnpm --filter @arise/desktop native:node` command first. No source/configuration edits are required for that existing M0 workflow.

Do not begin M1.2 without explicit authorization.
