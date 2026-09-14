# ARISE — REVIEW_SYSTEM.md

**Status:** Canonical
**Version:** 1.0-draft
**Purpose:** Define ARISE Market Review scheduling, trade/Colony review, Highlights, Lessons, comparison, study queues and review-driven strategy evolution.

---

## 1. Governing principle

> ARISE Review should preserve the complete decision process, not only the trade outcome.

Review asks:
- What did I think?
- What did ARISE detect?
- Why did participation occur?
- What happened to the Scout?
- How was it managed?
- Did the Colony logic remain valid?
- What should become a Lesson or strategy change?

---

## 2. Review system has two major domains

### Market Review
Forward-looking recurring review of instruments/timeframes.

### Performance / Decision Review
Backward-looking study of Trades, Positions, Colonies, strategy behavior and Lessons.

They share evidence/knowledge infrastructure but are not the same workflow.

---

# 3. Market Review Scheduler

ARISE supports review schedules on **any timeframe**.

Examples:
- Monthly
- Weekly
- Daily
- 12H
- 8H
- 6H
- 4H
- 2H
- 1H
- 30M.

No hard-coded D/W/M-only system.

---

## 4. Review timing

Reviews are created from canonical market candle boundaries supplied by TimeframeService.

The market's actual timeframe close determines when ARISE asks the user to review.

Do not schedule 4H/8H reviews from arbitrary desktop wall-clock assumptions.

---

## 5. Review frequency

Per schedule:
- EVERY_CANDLE
- EVERY_2_CANDLES
- EVERY_3_CANDLES
- ONCE_TRADING_DAY
- MANUAL.

Instrument lists can differ by timeframe.

Example:
- Weekly Review: 20 FX pairs
- Daily Review: 12 pairs
- 4H Review: 5 active pairs.

---

## 6. Review cycle states

- DUE
- COMPLETED
- MISSED
- SKIPPED.

Important:

`Not Reviewed != NEUTRAL`

If a review is missed, preserve that fact.

---

## 7. Review timing UI

Top bar can show:

```text
NEXT REVIEW
4H · 01:42:17
```

After close:

```text
4H REVIEW DUE
+00:18:44
```

Timer is informational and uses canonical next candle close.

---

## 8. Focused Market Review workflow

Example:

```text
EURUSD · Daily Review
```

User can update:
- LONG / SHORT / NEUTRAL / UNCHANGED
- thesis text
- target
- invalidation
- important Market Objects
- important candle
- Colony creation/update
- notes
- economic-event context.

Actions:
- SAVE + NEXT
- SAVE
- SKIP.

---

## 9. Immutable review history

Each completed review preserves:
- instrument
- timeframe
- reviewed Candle ID
- due time
- reviewed time
- prior direction
- new direction
- IdeaVersion
- target changes
- Market Object references
- notes
- economic-event context
- evidence.

Do not overwrite yesterday's review with today's bias.

---

## 10. Missed reviews

A missed review creates a historical state, not a fake backfilled decision.

Catch-up should summarize:
- last reviewed candle
- current candle
- how many review cycles were missed
- important intervening movement/events.

User may inspect missed candles via Timeframe Projection.

---

## 11. Missed Changes

Feature:

```text
REVIEW MISSED CHANGES
```

Compare:
- last reviewed state
- current state
- intervening candles
- important Market Object interactions
- economic events
- Colony/position events.

Do not fabricate what the user “would have thought” during missed cycles.

---

## 12. Review freshness

Watchlist/instrument UI can show review freshness.

Examples:
- ✓ current
- ! due
- 2× missed
- stale.

Freshness is derived per schedule and timeframe.

---

## 13. Overview review progress

Overview may show:

```text
Weekly  18/20 reviewed
Daily    8/12 reviewed
4H       3/5 reviewed
```

Click opens remaining queue.

---

## 14. Economic calendar in Review

Weekly/Daily review surfaces upcoming relevant economic events.

Calendar context is planning-first.

Near-event execution blocks remain Strategy/Execution policy, not the entire review system.

---

# 15. Trade Review

A Trade Review should assemble:

- Thesis at inception
- Colony context
- Decision Evidence
- Entry Snapshot
- strategy tags
- assigned timeframes/purposes
- exact StrategyVersions
- entry/stop/size
- position lifecycle
- management timeline
- protection actions
- partials
- exit
- outcome
- notes
- Highlights
- Lessons.

---

## 16. Review tabs / modes

Suggested Trade Review structure:
- OVERVIEW
- DECISION EVIDENCE
- TIMELINE
- MANAGEMENT
- NOTES
- LESSONS.

Decision Evidence supports:
- BOARD
- DRILL-DOWN.

---

## 17. Outcome-hidden study

Study Queue can temporarily hide:
- final P&L
- result
- later candles.

User reviews original evidence and answers:
- Would I take this?
- What was valid?
- What would invalidate it?
- How should it be managed?

Then reveal outcome.

This prevents hindsight bias during study.

---

## 18. Colony Review

A Colony should be reviewed as a campaign, not simply as a set of individual Trades.

Evaluate:
- thesis quality
- target quality
- scouting cost
- number of Attempts
- number of Scouts
- Survivors
- established Legs
- Mature Legs
- stacking quality
- Fresh Risk discipline
- protected exposure
- target-management quality
- consolidation/promotion
- final outcome.

A profitable Trade can exist inside a poor Colony process and vice versa.

---

## 19. Position lifecycle timeline

Review timeline can show:

```text
09:33 Scout
10:15 Survivor
11:00 True BE
13:40 Leg
next day Mature
target + partial
Runner
exit
```

Every point deep-links to EvidenceEvent and state/protection event.

---

## 20. Highlights

User can designate any Document Block, Evidence item, Review note or timeline event as a Highlight.

Highlights feed is a curated study stream.

Actions:
- open source
- tag
- link
- convert to Lesson
- add to review report.

---

## 21. Lesson lifecycle

Canonical statuses:

```text
OBSERVATION
  ↓
REPEATED_PATTERN
  ↓
PLAYBOOK_RULE
  ↓
MASTERED
```

Alternate:
- ARCHIVED.

A Lesson contains:
- statement
- supporting evidence
- contradicting evidence where relevant
- linked Trades/Colonies
- tags
- version history
- confidence/importance optional.

---

## 22. Lesson evidence

Lessons link exact source entities:
- EvidenceSnapshot
- EvidenceEvent
- Trade
- Position
- Colony
- MarketReview
- StrategyVersion
- MarketObjectVersion.

Do not copy evidence into an untraceable note.

---

## 23. Strategy change proposal

A Lesson may create:

```text
STRATEGY CHANGE PROPOSAL
```

Proposal describes:
- current StrategyVersion
- observed problem/pattern
- proposed change
- linked evidence
- expected effect
- test requirements.

Acceptance creates a new StrategyVersion.

Never mutate the old version.

---

## 24. Compare Trades

Comparison should align reasoning, not only metrics.

Compare by:
- Thesis
- Hindsight/Area/Entry map
- strategy sequence
- Market Objects
- Decision Evidence
- entry
- protection
- management
- outcome.

Example side-by-side:

```text
Trade A  | Trade B
D Area   | D Area
4H Sweep | 4H Sweep
1H MSS   | MSS absent
5M Entry | 5M Entry
```

This makes pattern differences visible.

---

## 25. Compare Colonies

Useful dimensions:
- number of Attempts
- scouting cost
- Survivors
- Mature Legs
- target distance captured
- position-pips
- Fresh Risk
- time to establishment
- management quality.

Do not reduce Colony comparison to P&L only.

---

## 26. Study Queue

Queue sources may include:
- new closed Trades
- failed cascades
- missed Reviews
- manually added items
- Lesson-linked cases
- representative winners
- representative failed Scouts
- Colonies needing review.

Priority can be manual initially.

Future spaced repetition is compatible but not required V1.

---

## 27. Database / Review relationship

Database is the structured entity explorer.

Review is the guided study workflow.

Database can browse:
- Trades
- Positions
- Colonies
- Ideas
- Strategies
- Combos
- Lessons
- Market Objects
- Documents
- Highlights
- Targets
- Market Reviews.

Review assembles those entities into a study experience.

---

## 28. Saved database views

Support:
- filters
- sort
- grouping
- visible columns
- saved view.

Examples:
- Failed Scouts by Strategy
- Weekly Long Colonies
- Trades near High-impact news
- MSS setups that never produced Survivor
- Mature Legs by instrument.

---

## 29. Review metrics

Pip-first metrics:
- realized pips
- open pips
- protected pips
- scouting cost
- position-pips
- attempts
- survivors
- longest leg
- Fresh Risk
- target progress/capture.

R remains secondary research statistic where useful.

Money display follows global presentation setting.

---

## 30. Equity / balance review

Analytics supports:
- EQUITY
- BALANCE
- BOTH.

Display units:
- PIPS
- POSITION-PIPS
- MONEY if enabled.

Markers may include:
- entry
- exit
- lifecycle state
- Colony event
- note/highlight.

Click marker deep-links to Review.

---

## 31. Review and economic events

Future/optional analysis can group:
- trades within X time of High-impact events
- Colony behavior across event weeks
- spread/slippage near news.

Calendar data must use historical EconomicEventRevision references where appropriate.

---

## 32. Review and strategy deployment

Review can show exact deployment status/version used at inception.

If a Lesson suggests a change, user can compare outcomes across:
- v1
- v2
- v3.

This is central to versioned strategy learning.

---

## 33. Knowledge integration

Review notes use the universal Document/Block engine.

Supports:
- wiki links
- block links
- tags
- backlinks
- Evidence embeds
- Trade/Colony embeds
- Market Object embeds
- Strategy embeds.

Review should feel connected to Knowledge, not siloed.

---

## 34. PDF reports

Supported review exports:
- Compact Trade Review
- Full Trade Dissection
- Colony Report
- Drill-Down Study Note
- Strategy Playbook
- Research Paper
- Batch Trade Study Book.

Export uses canonical evidence and versioned metadata.

---

## 35. Review UX principles

- Evidence-first, not spreadsheet-first.
- Outcome is visible but not the only focus.
- Deep links everywhere.
- Minimal duplicate data entry.
- Failed Attempts receive equal study support.
- Colony process is reviewable independently from individual Trade outcome.
- Important state transitions are clickable.
- Long/Short terminology only.

---

## 36. Required tests

- missed Review does not become Neutral
- repeated Review creates new immutable history
- Save+Next advances correct queue
- Review freshness derives correctly
- important candle can create Evidence root
- Trade Review resolves inception IdeaVersion
- Trade Review resolves exact StrategyMapVersion
- Board links to per-node evidence
- Colony Review aggregates Attempts without losing individual identity
- Lesson links exact evidence
- accepted StrategyChangeProposal creates new StrategyVersion
- outcome-hidden study does not expose future outcome data
- Compare Trades aligns exact evidence chains
