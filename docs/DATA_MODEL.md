# ARISE — DATA_MODEL.md

**Status:** Canonical  
**Version:** 1.0-draft  
**Purpose:** Define the canonical entities, identities, versioning rules, immutable history requirements, and major relationships used by ARISE.

---

## 1. Core data principles

ARISE uses a relational, versioned, event-driven data model.

General rule:

> Anything that can be referenced, reviewed, versioned, linked, automated, studied, audited, or reconstructed should have a permanent ID.

Historical decisions must not be silently overwritten.

Use mutable current-state records for operational convenience, but preserve immutable version/event history for consequential changes.

---

## 2. Identity rules

Every durable entity uses a stable opaque ID.

Recommended style:

```text
instrument_id
idea_id
idea_version_id
colony_id
market_object_id
market_object_version_id
strategy_definition_id
strategy_version_id
runtime_id
trade_id
position_id
attempt_id
evidence_event_id
review_id
```

Human-readable labels such as:

```text
Weekly Long #05
D FVG #03
Scout #24
```

are presentation identifiers and must not replace canonical IDs.

---

## 3. Market domain

### Instrument

Represents ARISE's normalized symbol identity.

Fields:
- instrument_id
- canonical_symbol
- display_name
- asset_class
- base_currency
- quote_currency
- pip_size
- tick_size
- price_digits
- enabled
- created_at

Broker symbols are mapped separately.

### Timeframe

Canonical timeframe identity.

Fields:
- timeframe_id
- code
- duration_seconds where applicable
- calendar_rule for D/W/M
- display_order

Examples:
- 1M
- 5M
- 1H
- 4H
- D
- W
- M

### Candle

Stable candle reference.

Identity should include:
- instrument_id
- timeframe_id
- open_timestamp
- data_source

Fields:
- candle_id
- open/high/low/close
- volume if available
- is_closed
- source_revision
- created_at / updated_at

Do not use volatile chart bar indexes as canonical identity.

### QuoteSnapshot

Persisted only when evidence/execution/audit requires it.

Fields:
- quote_snapshot_id
- instrument_id
- bid
- ask
- spread
- captured_at
- broker_time
- source

### EconomicEvent

Normalized calendar event.

Fields:
- economic_event_id
- provider_id
- provider_event_key
- title
- currency
- impact
- scheduled_at
- actual
- forecast
- previous
- status

### EconomicEventRevision

Preserves provider updates.

Fields:
- revision_id
- economic_event_id
- revision_no
- payload fields
- received_at

---

## 4. Idea / Thesis domain

### Idea

Durable identity for a trading thesis across revisions.

Fields:
- idea_id
- instrument_id
- thesis_timeframe_id
- current_status
- created_at
- archived_at

### IdeaVersion

Immutable thesis snapshot.

Fields:
- idea_version_id
- idea_id
- version_no
- direction LONG / SHORT / NEUTRAL
- thesis_text
- target_description
- invalidation_description
- primary_target_market_object_version_id nullable
- invalidation_market_object_version_id nullable
- created_at
- supersedes_idea_version_id nullable

Trades and live deployment snapshots must reference the exact IdeaVersion active at inception.

---

## 5. Colony domain

### Colony

Represents a campaign around one explicit thesis.

Fields:
- colony_id
- idea_id
- original_idea_version_id
- instrument_id
- label
- current_state
- current_target_id nullable
- created_at
- completed_at nullable

### ColonyLineage

Tracks campaign relationships.

Fields:
- colony_lineage_id
- source_colony_id
- target_colony_id
- relationship_type

Relationship types:
- PROMOTED_TO
- CONSOLIDATED_INTO
- DERIVED_FROM

### ColonyStateEvent

Immutable transition history.

Fields:
- colony_state_event_id
- colony_id
- from_state
- to_state
- reason
- source_type
- source_id nullable
- occurred_at

---

## 6. Target domain

### Target

Represents intended destination, not necessarily broker TP.

Fields:
- target_id
- colony_id
- target_type
- exact_price nullable
- zone_market_object_id nullable
- management_mode
- status
- created_at

Target management modes:
- REFERENCE_ONLY
- FULL_TP
- PARTIAL_TP
- TRAIL
- MANUAL
- HYBRID
- RUNNER

### TargetEvent

Immutable events:
- APPROACHING
- REACHED
- HIT
- INVALIDATED
- REASSIGNED

---

## 7. Market Object domain

### MarketObject

Stable semantic identity.

Fields:
- market_object_id
- instrument_id
- owner_type
- owner_id
- geometry_type
- semantic_type
- role
- timeframe_id nullable
- name
- current_version_id
- created_at
- archived_at

Geometry types:
- LINE
- RAY
- RECTANGLE
- TRENDLINE
- POINT
- CANDLE_REFERENCE
- TEXT

Semantic examples:
- GENERIC_ZONE
- FVG
- ORDER_BLOCK
- LIQUIDITY_ZONE
- RANGE
- PREMIUM_DISCOUNT
- TARGET_ZONE
- INVALIDATION_ZONE
- CUSTOM

Roles:
- REFERENCE
- AREA
- TRIGGER
- TARGET
- INVALIDATION
- PROTECTION
- CONFIRMATION
- ORIGIN

### MarketObjectVersion

Immutable geometry/semantic revision.

Fields:
- market_object_version_id
- market_object_id
- version_no
- geometry_json
- semantic_properties_json
- source_candle_ids_json
- created_at
- supersedes_version_id nullable

### MarketObjectRelation

Fields:
- relation_id
- source_market_object_id
- target_market_object_id
- relation_type
- created_at

---

## 8. Timeframe Projection

### TimeframeProjection

A semantic time-container projection between timeframes.

Fields:
- projection_id
- source_entity_type
- source_entity_id
- source_timeframe_id
- target_timeframe_id
- interval_start
- interval_end
- source_high nullable
- source_low nullable
- colony_id nullable
- parent_projection_id nullable
- created_at

Used for nested drill-down and evidence.

---

## 9. Review Scheduler domain

### ReviewSchedule

Defines recurring review expectations.

Fields:
- review_schedule_id
- name
- timeframe_id
- instrument_scope_type
- instrument_scope_id
- frequency_type
- frequency_value
- notification_policy_id nullable
- enabled
- created_at

Frequency examples:
- EVERY_CANDLE
- EVERY_2_CANDLES
- EVERY_3_CANDLES
- ONCE_TRADING_DAY
- MANUAL

### ReviewCycle

Represents an actual scheduled occurrence.

Fields:
- review_cycle_id
- review_schedule_id
- due_at
- candle_id nullable
- status
- created_at

### MarketReview

Per-instrument completed or missed review.

Fields:
- market_review_id
- review_cycle_id
- instrument_id
- timeframe_id
- status
- previous_review_id nullable
- idea_version_id nullable
- direction
- notes_document_id nullable
- reviewed_at nullable

Statuses:
- DUE
- COMPLETED
- MISSED
- SKIPPED

Not reviewed must never be converted to NEUTRAL.

### ReviewEvent

Immutable events for review state/history.

---

## 10. Watchlist domain

### Watchlist

Fields:
- watchlist_id
- name
- sort_order
- created_at

### WatchlistItem

Fields:
- watchlist_item_id
- watchlist_id
- instrument_id
- sort_order
- pinned_colony_id nullable
- created_at

Live values such as price, review freshness and news counts are derived, not redundantly persisted as canonical fields.

---

## 11. Strategy Encyclopedia domain

### StrategyDefinition

Durable strategy identity.

Fields:
- strategy_definition_id
- name
- category
- purpose
- description_document_id nullable
- automation_capability
- created_at
- retired_at nullable

Automation capability:
- MANUAL
- DETECTABLE
- AUTOMATABLE

### StrategyVersion

Immutable strategy implementation version.

Fields:
- strategy_version_id
- strategy_definition_id
- version_no
- detector_key nullable
- detector_version nullable
- parameter_schema_json
- executable_contract_json nullable
- deployment_status
- created_at
- supersedes_version_id nullable

Deployment:
- EXPERIMENTAL
- VALIDATED
- DEMO_APPROVED
- LIVE_APPROVED
- RETIRED

### StrategyParameterDefinition

Fields:
- parameter_definition_id
- strategy_version_id
- key
- value_type
- default_value_json
- constraints_json
- required

### StrategyEvidenceProfile

Defines what to capture on trigger/confirmation/failure/expiry.

---

## 12. Combo domain

### ComboDefinition

Durable reusable strategy combination.

### ComboVersion

Immutable version.

### ComboStrategyNode

Defines ordered/structured membership of StrategyVersions within a ComboVersion.

---

## 13. Strategy Map / Graph domain

### StrategyMap

Durable strategy-map identity.

### StrategyMapVersion

Immutable complete map version.

### StrategyMapStage

Fields:
- stage_id
- strategy_map_version_id
- timeframe_id
- purpose_hindsight bool
- purpose_area bool
- purpose_entry bool
- importance
- execution_mode
- sort_order

Importance:
- REQUIRED
- OPTIONAL
- INFORMATIONAL

Execution mode:
- MANUAL
- CONFIRMATION
- AUTOMATED
- IGNORED

### LogicGraph

Fields:
- logic_graph_id
- strategy_map_version_id
- graph_json_metadata

### GraphNode

Fields:
- graph_node_id
- logic_graph_id
- node_type
- referenced_entity_type nullable
- referenced_entity_version_id nullable
- display_position_json
- config_json

Node types:
- STRATEGY
- LOGIC
- MODIFIER
- MARKET_OBJECT
- STATE
- ACTION

### GraphEdge

Fields:
- graph_edge_id
- logic_graph_id
- source_node_id
- source_port
- target_node_id
- target_port
- edge_type

### GraphNodeParameter

Instance-level overrides for node behavior.

---

## 14. Strategy Runtime domain

### StrategyRuntime

One stateful execution instance tied to a Colony and exact StrategyMapVersion.

Fields:
- strategy_runtime_id
- colony_id
- strategy_map_version_id
- deployment_snapshot_id nullable
- current_status
- started_at
- stopped_at nullable

### RuntimeNode

Persistent node state.

Fields:
- runtime_node_id
- strategy_runtime_id
- graph_node_id
- state
- armed_at nullable
- triggered_at nullable
- confirmed_at nullable
- last_evaluated_candle_id nullable
- trigger_count
- runtime_memory_json

States:
- DORMANT
- ARMED
- WATCHING
- TRIGGERED
- CONFIRMED
- COMPLETED
- FAILED
- EXPIRED
- CANCELLED
- BYPASSED

### RuntimeNodeEvent

Immutable transitions/evaluations.

### DecisionTrace

Human-readable chronological explanation of strategy progression.

Fields:
- decision_trace_id
- strategy_runtime_id
- event_type
- runtime_node_id nullable
- summary
- details_json
- occurred_at

---

## 15. Detector domain

### DetectorEvaluation

Fields:
- detector_evaluation_id
- runtime_node_id
- strategy_version_id
- detector_key
- detector_version
- result
- evaluated_at
- candle_id nullable
- diagnostics_json

Results should distinguish:
- NOT_MET
- PARTIAL
- TRIGGERED
- CONFIRMED
- BLOCKED
- FAILED
- EXPIRED
- ERROR

### DetectorEvidenceReference

Links a detector evaluation to exact:
- Candle
- MarketObjectVersion
- swing reference
- EconomicEventRevision
- QuoteSnapshot
- other evidence entity

---

## 16. Evidence domain

### EvidenceEvent

Fields:
- evidence_event_id
- source_type
- source_id
- event_type
- occurred_at

Sources:
- STRATEGY_RUNTIME
- TRADE
- POSITION
- REVIEW
- MANUAL

Event types:
- CONFIRMATION
- FAILURE
- EXPIRY
- ENTRY
- SURVIVOR
- PROTECTED
- LEG
- MATURE
- TARGET_HIT
- EXIT
- MANUAL

### EvidenceSnapshot

Fields:
- evidence_snapshot_id
- evidence_event_id
- chart_workspace_state_json
- image_path nullable
- image_hash nullable
- captured_at

### EvidenceReference

Links snapshot/event to exact entity/version references.

---

## 17. Attempts / trades / positions

### Attempt

Represents one effort to acquire exposure.

Fields:
- attempt_id
- colony_id
- strategy_runtime_id nullable
- sequence_no
- started_at
- completed_at nullable
- result nullable
- pip_cost nullable

Results:
- EXPIRED
- FAILED
- SCRATCH
- SURVIVED

### Trade

ARISE conceptual trade/scout identity.

Fields:
- trade_id
- attempt_id nullable
- colony_id
- idea_version_id
- strategy_map_version_id nullable
- direction
- created_at
- source_type

Source types:
- ARISE_AUTO
- ARISE_MANUAL
- EXTERNAL_MANUAL
- IMPORTED

### Position

Broker-facing live exposure identity.

Fields:
- position_id
- trade_id
- broker_account_id
- broker_position_key
- original_colony_id
- current_colony_id
- direction
- original_size
- current_size
- entry_price
- current_state
- opened_at
- closed_at nullable

### PositionLeg

Use where needed to preserve logical leg attribution across partials/netting.

### PositionStateEvent

Immutable transition history.

---

## 18. Orders and execution

### ExecutionIntent

ARISE intent before broker operation.

Fields:
- execution_intent_id
- trade_id nullable
- colony_id
- strategy_runtime_id nullable
- instrument_id
- direction
- requested_size
- entry_type
- semantic_stop_rule_json
- semantic_target_rule_json
- created_at
- status

### OrderPlan

Frozen validated execution plan.

Fields:
- order_plan_id
- execution_intent_id
- entry_price nullable
- sl_price nullable
- tp_price nullable
- max_spread nullable
- max_slippage nullable
- expires_at nullable
- frozen_context_json
- created_at

### OrderIntent

Optional explicit broker-order intent abstraction if multiple broker orders derive from one execution plan.

### BrokerCommand

Durable command.

Fields:
- broker_command_id
- idempotency_key
- command_type
- payload_json
- status
- attempt_count
- created_at
- last_attempt_at nullable

### Order

Broker order representation.

Fields:
- order_id
- broker_account_id
- broker_order_key
- execution_intent_id nullable
- broker_command_id nullable
- status
- requested_size
- filled_size
- remaining_size
- created_at

### ExecutionFill

Immutable fill record.

Fields:
- execution_fill_id
- order_id
- broker_fill_key
- size
- price
- commission
- swap nullable
- account_currency
- quote_snapshot_id nullable
- filled_at

### BrokerEvent

Immutable inbound broker event with deduplication key.

---

## 19. Position management

### ManagementPolicy

Durable policy identity.

### ManagementPolicyVersion

Immutable behavior version.

### PositionManagementAssignment

Links Position to exact ManagementPolicyVersion.

---

## 20. Protection domain

### ProtectionRule

Durable identity.

### ProtectionRuleVersion

Immutable rule version.

### ProtectionTriggerEvent

Captures what caused evaluation.

### ProtectionProposal

Fields:
- protection_proposal_id
- position_id
- protection_rule_version_id
- trigger_event_id
- proposed_action
- calculated_value_json
- status
- created_at

### ProtectionAction

Semantic action.

Examples:
- MOVE_TO_PRICE_BE
- MOVE_TO_TRUE_BE
- BE_PLUS_OFFSET
- LOCK_PIPS
- LOCK_MONEY
- MOVE_TO_PRICE
- MOVE_TO_MARKET_OBJECT
- TRAIL_FIXED_DISTANCE
- TRAIL_MARKET_OBJECT
- TRAIL_STRUCTURE
- PARTIAL_CLOSE
- FULL_CLOSE
- REMOVE_TP
- SET_TP
- CONVERT_TO_RUNNER

### ProtectionRequest

Broker-bound request.

Lifecycle:
- CREATED
- CALCULATED
- VALIDATED
- SENT
- ACCEPTED
- CONFIRMED
- VERIFIED
- BLOCKED
- REJECTED
- FAILED
- SUPERSEDED
- CANCELLED

### ProtectionVerification

Stores refreshed broker-state verification result.

---

## 21. Attempt budgets and stacking

### AttemptBudget

Fields:
- attempt_budget_id
- colony_id
- max_attempts nullable
- max_scouting_loss_pips nullable
- cooldown_rule_json nullable
- reset_rule_json
- current_period_key
- updated_at

### StackingPolicy

Recommended explicit entity/version if behavior becomes complex.

Fields may include:
- mode
- max_active_scouts
- max_fresh_risk_position_pips
- cooldown
- target_proximity_block
- strategy-state constraints

Modes:
- ANY_VALID_ENTRY
- ONLY_AFTER_SURVIVOR
- ONLY_AFTER_PROTECTED
- ONLY_AFTER_LEG
- MANUAL

---

## 22. Pip-first derived metrics

Do not store derived metrics as canonical values unless caching is needed.

Derive from fills/current state where possible:

- open pips,
- realized pips,
- protected pips,
- scouting cost,
- position-pips,
- fresh risk,
- protected exposure,
- mature exposure,
- target progress.

Raw values must retain:
- price,
- size,
- pip size/value,
- commission,
- swap,
- account currency.

---

## 23. Documents and knowledge

### Document

Fields:
- document_id
- document_type
- title
- current_version_id
- primary_folder_id nullable
- linked_entity_type nullable
- linked_entity_id nullable
- created_at
- archived_at nullable

### DocumentVersion

Immutable or snapshot-versioned document content.

### Block

Stable block identity where block references/backlinks are needed.

### Folder

Nested folder tree.

### FolderItem

Associates document/entity shortcuts with folders.

### EntityLink

Generic semantic backlinks.

Fields:
- entity_link_id
- source_type
- source_id
- target_type
- target_id
- relation_type
- created_at

### Tag

### TagAssignment

Generic tags across supported entities.

---

## 24. Lessons

### Lesson

Durable lesson identity.

### LessonVersion

Immutable text/status versions.

Lesson statuses:
- OBSERVATION
- REPEATED_PATTERN
- PLAYBOOK_RULE
- MASTERED
- ARCHIVED

### LessonEvidence

Links exact EvidenceSnapshots, Trades, Colonies, Reviews, etc.

### StrategyChangeProposal

A Lesson may propose a new StrategyVersion.

Never silently mutate an existing live strategy from a Lesson.

---

## 25. Broker / account

### BrokerAccount

Fields:
- broker_account_id
- provider
- broker_name
- account_key
- account_type
- hedging_mode
- currency
- is_live
- enabled

### TradingSession

### AccountSnapshot

Periodic broker account snapshot.

### ConnectionEvent

Immutable health/reconnect history.

---

## 26. Notifications

### Notification

Fields:
- notification_id
- category
- severity
- title
- body
- linked_entity_type nullable
- linked_entity_id nullable
- status
- created_at

### NotificationPolicy

Routing policy for in-app/desktop/sound.

### NotificationDelivery

Tracks actual delivery attempts.

---

## 27. Settings

Scoped settings:
- UserPreference
- WorkspacePreference
- InstrumentPreference
- StrategyPreference

Do not flatten all settings into one untyped JSON blob.

---

## 28. Workspace persistence

### Workspace

Logical app workspace.

### WorkspaceTab

Persistent tab.

### ChartWorkspace

Fields:
- chart_workspace_id
- instrument_id
- workspace_type
- colony_id nullable
- timeframe_id
- viewport_json
- layer_config_json

Types:
- MASTER
- COLONY
- REVIEW

### ChartLayer

Fields:
- chart_layer_id
- chart_workspace_id
- layer_type
- linked_entity_type
- linked_entity_id
- visibility
- z_order
- opacity

---

## 29. Safety and recovery

### SafetyEvent

Fields:
- safety_event_id
- event_type
- severity
- detected_at
- resolved_at nullable
- affected_entity_type nullable
- affected_entity_id nullable
- automatic_action
- user_action nullable
- details_json

Examples:
- UNPROTECTED_POSITION
- STALE_QUOTES
- ACCOUNT_MISMATCH
- BROKER_DISCONNECTED
- PROTECTION_REJECTED
- POSITION_MISMATCH
- DATABASE_ERROR
- AGENT_VERSION_MISMATCH

### DeploymentSnapshot

Freezes exact live/demo behavior.

Fields:
- deployment_snapshot_id
- colony_id
- strategy_map_version_id
- strategy_version_ids_json
- detector_versions_json
- parameter_values_json
- management_policy_version_id nullable
- protection_rule_version_ids_json
- gear_config_json
- execution_policy_json
- news_policy_json
- created_at

---

## 30. Mutable vs immutable

### Mutable operational state

Examples:
- current Position state
- current Colony state
- current RuntimeNode state
- current Watchlist ordering
- current workspace layout
- current connection health

### Immutable/versioned history

Examples:
- fills
- broker events
- detector confirmations
- evidence
- IdeaVersions
- StrategyVersions
- MarketObjectVersions
- PositionStateEvents
- ColonyStateEvents
- Reviews
- Protection events
- DeploymentSnapshots
- SafetyEvents

---

## 31. Canonical lineage

The high-level lineage is:

```text
Instrument
  ↓
Idea
  ↓
IdeaVersion
  ↓
Colony
  ├── Target
  ├── Market Objects
  ├── Strategy Runtime
  │    ├── Runtime Nodes
  │    ├── Detector Evaluations
  │    ├── Decision Trace
  │    └── Evidence
  ├── Attempts
  │    └── Trades
  │         └── Positions
  │              ├── Orders/Fills
  │              ├── Position State Events
  │              └── Protection
  └── Colony State / Lineage
```

---

## 32. Atomic domain-write principle

Where one domain event logically creates several records, use one database transaction where possible.

Example confirmed algorithmic progression may atomically create:

- DetectorEvaluation
- RuntimeNodeEvent
- DecisionTrace
- EvidenceEvent
- EvidenceSnapshot metadata
- EvidenceReferences

External broker operations cannot be transactional with SQLite; use durable commands and reconciliation instead.

---

## 33. V1 exclusions

Do not prematurely add:
- graph databases
- vector embeddings as core storage
- tick-history warehouse
- multi-broker portfolio aggregation
- cloud collaboration
- machine-learning feature stores
- full historical market database
- generalized netting engine beyond required compatibility
