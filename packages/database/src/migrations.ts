import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  sql: string;
}

const immutableTables = [
  'idea_versions',
  'colony_lineage',
  'colony_state_events',
  'target_events',
  'market_object_versions',
  'market_object_relations',
  'timeframe_projections',
  'trades',
  'position_state_events',
] as const;

function immutableTriggers(table: string): string {
  return `
CREATE TRIGGER ${table}_immutable_update
BEFORE UPDATE ON ${table}
BEGIN
  SELECT RAISE(ABORT, '${table} is immutable');
END;
CREATE TRIGGER ${table}_immutable_delete
BEFORE DELETE ON ${table}
BEGIN
  SELECT RAISE(ABORT, '${table} is immutable');
END;`;
}

const m2Schema = `
ALTER TABLE ideas RENAME TO legacy_ideas;

CREATE TABLE instruments (
  id TEXT PRIMARY KEY NOT NULL,
  canonical_symbol TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  pip_size REAL NOT NULL CHECK (pip_size > 0),
  tick_size REAL NOT NULL CHECK (tick_size > 0),
  price_digits INTEGER NOT NULL CHECK (price_digits >= 0),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE timeframes (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  calendar_rule TEXT,
  display_order INTEGER NOT NULL CHECK (display_order >= 0),
  CHECK (duration_seconds IS NOT NULL OR calendar_rule IS NOT NULL)
);

CREATE TABLE ideas (
  id TEXT PRIMARY KEY NOT NULL,
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  thesis_timeframe_id TEXT NOT NULL REFERENCES timeframes(id),
  current_status TEXT NOT NULL CHECK (current_status IN ('DRAFT','WATCHING','ACTIVE','IN_PLAY','TARGET_APPROACHING','TARGET_HIT','COMPLETED','INVALIDATED','CANCELLED','ARCHIVED')),
  created_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK ((current_status = 'ARCHIVED') = (archived_at IS NOT NULL))
);

CREATE TABLE idea_versions (
  id TEXT PRIMARY KEY NOT NULL,
  idea_id TEXT NOT NULL REFERENCES ideas(id),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  direction TEXT NOT NULL CHECK (direction IN ('LONG','SHORT','NEUTRAL')),
  thesis_text TEXT NOT NULL,
  target_description TEXT NOT NULL,
  invalidation_description TEXT NOT NULL,
  primary_target_market_object_version_id TEXT REFERENCES market_object_versions(id),
  invalidation_market_object_version_id TEXT REFERENCES market_object_versions(id),
  created_at TEXT NOT NULL,
  supersedes_idea_version_id TEXT REFERENCES idea_versions(id),
  UNIQUE (idea_id, version_no),
  CHECK ((version_no = 1) = (supersedes_idea_version_id IS NULL)),
  CHECK (id <> supersedes_idea_version_id)
);

CREATE TABLE colonies (
  id TEXT PRIMARY KEY NOT NULL,
  idea_id TEXT NOT NULL REFERENCES ideas(id),
  original_idea_version_id TEXT NOT NULL REFERENCES idea_versions(id),
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  label TEXT NOT NULL,
  current_state TEXT NOT NULL CHECK (current_state IN ('DORMANT','BUILDING','ESTABLISHED','MATURE','DECAYING','INVALIDATED','COMPLETED')),
  current_target_id TEXT REFERENCES targets(id),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK ((current_state = 'COMPLETED') = (completed_at IS NOT NULL))
);

CREATE TABLE colony_lineage (
  id TEXT PRIMARY KEY NOT NULL,
  source_colony_id TEXT NOT NULL REFERENCES colonies(id),
  target_colony_id TEXT NOT NULL REFERENCES colonies(id),
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('PROMOTED_TO','CONSOLIDATED_INTO','DERIVED_FROM')),
  CHECK (source_colony_id <> target_colony_id)
);

CREATE TABLE colony_state_events (
  id TEXT PRIMARY KEY NOT NULL,
  colony_id TEXT NOT NULL REFERENCES colonies(id),
  from_state TEXT NOT NULL CHECK (from_state IN ('DORMANT','BUILDING','ESTABLISHED','MATURE','DECAYING','INVALIDATED','COMPLETED')),
  to_state TEXT NOT NULL CHECK (to_state IN ('DORMANT','BUILDING','ESTABLISHED','MATURE','DECAYING','INVALIDATED','COMPLETED')),
  reason TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  occurred_at TEXT NOT NULL,
  manual_override INTEGER NOT NULL CHECK (manual_override IN (0, 1)),
  correlation_id TEXT
);
CREATE INDEX colony_state_events_colony_time_idx ON colony_state_events(colony_id, occurred_at, id);

CREATE TABLE targets (
  id TEXT PRIMARY KEY NOT NULL,
  colony_id TEXT NOT NULL REFERENCES colonies(id),
  target_type TEXT NOT NULL,
  exact_price REAL,
  zone_market_object_id TEXT REFERENCES market_objects(id),
  management_mode TEXT NOT NULL CHECK (management_mode IN ('REFERENCE_ONLY','FULL_TP','PARTIAL_TP','TRAIL','MANUAL','HYBRID','RUNNER')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','APPROACHING','REACHED','HIT','INVALIDATED','REASSIGNED','COMPLETED')),
  created_at TEXT NOT NULL
);
CREATE INDEX targets_colony_idx ON targets(colony_id, created_at, id);

CREATE TABLE target_events (
  id TEXT PRIMARY KEY NOT NULL,
  target_id TEXT NOT NULL REFERENCES targets(id),
  from_status TEXT NOT NULL CHECK (from_status IN ('ACTIVE','APPROACHING','REACHED','HIT','INVALIDATED','REASSIGNED','COMPLETED')),
  to_status TEXT NOT NULL CHECK (to_status IN ('APPROACHING','REACHED','HIT','INVALIDATED','REASSIGNED','COMPLETED')),
  event_type TEXT NOT NULL CHECK (event_type IN ('APPROACHING','REACHED','HIT','INVALIDATED','REASSIGNED','COMPLETED')),
  reason TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  occurred_at TEXT NOT NULL,
  manual_override INTEGER NOT NULL CHECK (manual_override IN (0, 1)),
  correlation_id TEXT,
  CHECK (event_type = to_status)
);
CREATE INDEX target_events_target_time_idx ON target_events(target_id, occurred_at, id);

CREATE TABLE market_objects (
  id TEXT PRIMARY KEY NOT NULL,
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  geometry_type TEXT NOT NULL CHECK (geometry_type IN ('LINE','RAY','RECTANGLE','TRENDLINE','POINT','CANDLE_REFERENCE','TEXT')),
  semantic_type TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('REFERENCE','AREA','TRIGGER','TARGET','INVALIDATION','PROTECTION','CONFIRMATION','ORIGIN')),
  timeframe_id TEXT REFERENCES timeframes(id),
  name TEXT NOT NULL,
  current_version_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE market_object_versions (
  id TEXT PRIMARY KEY NOT NULL,
  market_object_id TEXT NOT NULL REFERENCES market_objects(id),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  geometry_type TEXT NOT NULL CHECK (geometry_type IN ('LINE','RAY','RECTANGLE','TRENDLINE','POINT','CANDLE_REFERENCE','TEXT')),
  semantic_type TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('REFERENCE','AREA','TRIGGER','TARGET','INVALIDATION','PROTECTION','CONFIRMATION','ORIGIN')),
  timeframe_id TEXT REFERENCES timeframes(id),
  name TEXT NOT NULL,
  geometry_json TEXT NOT NULL,
  semantic_properties_json TEXT NOT NULL,
  source_candle_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  supersedes_version_id TEXT REFERENCES market_object_versions(id),
  UNIQUE (market_object_id, version_no),
  CHECK ((version_no = 1) = (supersedes_version_id IS NULL)),
  CHECK (id <> supersedes_version_id)
);
CREATE INDEX market_object_versions_object_idx ON market_object_versions(market_object_id, version_no);

CREATE TABLE market_object_relations (
  id TEXT PRIMARY KEY NOT NULL,
  source_market_object_id TEXT NOT NULL REFERENCES market_objects(id),
  target_market_object_id TEXT NOT NULL REFERENCES market_objects(id),
  relation_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX market_object_relations_source_idx ON market_object_relations(source_market_object_id, created_at, id);
CREATE INDEX market_object_relations_target_idx ON market_object_relations(target_market_object_id, created_at, id);

CREATE TABLE timeframe_projections (
  id TEXT PRIMARY KEY NOT NULL,
  source_entity_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  source_timeframe_id TEXT NOT NULL REFERENCES timeframes(id),
  target_timeframe_id TEXT NOT NULL REFERENCES timeframes(id),
  interval_start TEXT NOT NULL,
  interval_end TEXT NOT NULL,
  source_high REAL,
  source_low REAL,
  colony_id TEXT REFERENCES colonies(id),
  parent_projection_id TEXT REFERENCES timeframe_projections(id),
  created_at TEXT NOT NULL,
  CHECK (interval_end > interval_start),
  CHECK (source_high IS NULL OR source_low IS NULL OR source_high >= source_low),
  CHECK (id <> parent_projection_id)
);
CREATE INDEX timeframe_projections_colony_idx ON timeframe_projections(colony_id, interval_start, id);
CREATE INDEX timeframe_projections_parent_idx ON timeframe_projections(parent_projection_id, interval_start, id);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY NOT NULL,
  colony_id TEXT NOT NULL REFERENCES colonies(id),
  strategy_runtime_id TEXT,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 1),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  result TEXT CHECK (result IS NULL OR result IN ('EXPIRED','FAILED','SCRATCH','SURVIVED')),
  pip_cost REAL,
  UNIQUE (colony_id, sequence_no),
  CHECK (result IS NULL OR completed_at IS NOT NULL)
);
CREATE INDEX attempts_colony_idx ON attempts(colony_id, sequence_no);

CREATE TABLE trades (
  id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT REFERENCES attempts(id),
  colony_id TEXT NOT NULL REFERENCES colonies(id),
  idea_version_id TEXT NOT NULL REFERENCES idea_versions(id),
  strategy_map_version_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('LONG','SHORT','NEUTRAL')),
  created_at TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('ARISE_AUTO','ARISE_MANUAL','EXTERNAL_MANUAL','IMPORTED'))
);
CREATE INDEX trades_colony_idx ON trades(colony_id, created_at, id);
CREATE INDEX trades_attempt_idx ON trades(attempt_id, created_at, id);

CREATE TABLE positions (
  id TEXT PRIMARY KEY NOT NULL,
  trade_id TEXT NOT NULL REFERENCES trades(id),
  broker_account_id TEXT NOT NULL,
  broker_position_key TEXT NOT NULL,
  original_colony_id TEXT NOT NULL REFERENCES colonies(id),
  current_colony_id TEXT NOT NULL REFERENCES colonies(id),
  direction TEXT NOT NULL CHECK (direction IN ('LONG','SHORT','NEUTRAL')),
  original_size REAL NOT NULL CHECK (original_size > 0),
  current_size REAL NOT NULL CHECK (current_size >= 0),
  entry_price REAL NOT NULL,
  current_state TEXT NOT NULL CHECK (current_state IN ('SCOUT','SURVIVOR','PROTECTED','LEG','MATURE_LEG','RUNNER','FAILED','CLOSED','CONSOLIDATED')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  UNIQUE (broker_account_id, broker_position_key),
  CHECK (closed_at IS NULL OR current_size = 0),
  CHECK (current_state <> 'CLOSED' OR closed_at IS NOT NULL)
);
CREATE INDEX positions_trade_idx ON positions(trade_id, opened_at, id);
CREATE INDEX positions_current_colony_idx ON positions(current_colony_id, opened_at, id);

CREATE TABLE position_state_events (
  id TEXT PRIMARY KEY NOT NULL,
  position_id TEXT NOT NULL REFERENCES positions(id),
  from_state TEXT NOT NULL CHECK (from_state IN ('CANDIDATE','SCOUT','SURVIVOR','PROTECTED','LEG','MATURE_LEG','RUNNER','FAILED','CLOSED','CONSOLIDATED')),
  to_state TEXT NOT NULL CHECK (to_state IN ('CANDIDATE','SCOUT','SURVIVOR','PROTECTED','LEG','MATURE_LEG','RUNNER','FAILED','CLOSED','CONSOLIDATED')),
  reason TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  occurred_at TEXT NOT NULL,
  manual_override INTEGER NOT NULL CHECK (manual_override IN (0, 1)),
  correlation_id TEXT
);
CREATE INDEX position_state_events_position_time_idx ON position_state_events(position_id, occurred_at, id);

CREATE TABLE attempt_budgets (
  id TEXT PRIMARY KEY NOT NULL,
  colony_id TEXT NOT NULL REFERENCES colonies(id),
  max_attempts INTEGER CHECK (max_attempts IS NULL OR max_attempts >= 0),
  max_scouting_loss_pips REAL CHECK (max_scouting_loss_pips IS NULL OR max_scouting_loss_pips >= 0),
  cooldown_rule_json TEXT,
  reset_rule_json TEXT NOT NULL,
  current_period_key TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX attempt_budgets_colony_idx ON attempt_budgets(colony_id, id);


CREATE TRIGGER idea_versions_linear_insert
BEFORE INSERT ON idea_versions
BEGIN
  SELECT CASE
    WHEN NEW.version_no <> COALESCE((SELECT MAX(version_no) + 1 FROM idea_versions WHERE idea_id = NEW.idea_id), 1)
    THEN RAISE(ABORT, 'IdeaVersion must extend current history head')
  END;
  SELECT CASE
    WHEN NEW.version_no > 1 AND NEW.supersedes_idea_version_id <> (
      SELECT id FROM idea_versions WHERE idea_id = NEW.idea_id ORDER BY version_no DESC LIMIT 1
    )
    THEN RAISE(ABORT, 'IdeaVersion supersedes pointer must reference current history head')
  END;
  SELECT CASE
    WHEN NEW.version_no > 1 AND NEW.created_at < (
      SELECT created_at FROM idea_versions WHERE idea_id = NEW.idea_id ORDER BY version_no DESC LIMIT 1
    )
    THEN RAISE(ABORT, 'IdeaVersion cannot predate current history head')
  END;
END;

CREATE TRIGGER market_object_versions_linear_insert
BEFORE INSERT ON market_object_versions
BEGIN
  SELECT CASE
    WHEN NEW.version_no <> COALESCE((SELECT MAX(version_no) + 1 FROM market_object_versions WHERE market_object_id = NEW.market_object_id), 1)
    THEN RAISE(ABORT, 'MarketObjectVersion must extend current history head')
  END;
  SELECT CASE
    WHEN NEW.version_no > 1 AND NEW.supersedes_version_id <> (
      SELECT id FROM market_object_versions WHERE market_object_id = NEW.market_object_id ORDER BY version_no DESC LIMIT 1
    )
    THEN RAISE(ABORT, 'MarketObjectVersion supersedes pointer must reference current history head')
  END;
  SELECT CASE
    WHEN NEW.version_no > 1 AND NEW.created_at < (
      SELECT created_at FROM market_object_versions WHERE market_object_id = NEW.market_object_id ORDER BY version_no DESC LIMIT 1
    )
    THEN RAISE(ABORT, 'MarketObjectVersion cannot predate current history head')
  END;
END;

CREATE TRIGGER market_objects_current_revision_integrity
BEFORE UPDATE OF current_version_id, geometry_type, semantic_type, role, timeframe_id, name ON market_objects
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM market_object_versions v
      WHERE v.id = NEW.current_version_id
        AND v.market_object_id = NEW.id
        AND v.geometry_type = NEW.geometry_type
        AND v.semantic_type = NEW.semantic_type
        AND v.role = NEW.role
        AND v.timeframe_id IS NEW.timeframe_id
        AND v.name = NEW.name
    )
    THEN RAISE(ABORT, 'MarketObject current snapshot must match its current version')
  END;
END;

${immutableTables.map(immutableTriggers).join('\n')}
`;



const m5Schema = `
CREATE TABLE folders (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  parent_folder_id TEXT REFERENCES folders(id),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  created_at TEXT NOT NULL,
  CHECK (id <> parent_folder_id)
);
CREATE INDEX folders_parent_idx ON folders(parent_folder_id, sort_order, id);

CREATE TABLE documents (
  id TEXT PRIMARY KEY NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('THESIS','COLONY_NOTE','POSITION_NOTE','TRADE_REVIEW','MARKET_REVIEW','LESSON','STRATEGY_ENCYCLOPEDIA','RESEARCH','NOTE')),
  title TEXT NOT NULL,
  current_version_id TEXT NOT NULL,
  primary_folder_id TEXT REFERENCES folders(id),
  linked_entity_type TEXT,
  linked_entity_id TEXT,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK ((linked_entity_type IS NULL) = (linked_entity_id IS NULL))
);
CREATE INDEX documents_folder_idx ON documents(primary_folder_id, created_at, id);
CREATE INDEX documents_linked_entity_idx ON documents(linked_entity_type, linked_entity_id, created_at, id);

CREATE TABLE blocks (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id),
  created_at TEXT NOT NULL
);
CREATE INDEX blocks_document_idx ON blocks(document_id, created_at, id);

CREATE TABLE document_versions (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  supersedes_document_version_id TEXT REFERENCES document_versions(id),
  UNIQUE (document_id, version_no),
  CHECK ((version_no = 1) = (supersedes_document_version_id IS NULL)),
  CHECK (id <> supersedes_document_version_id)
);
CREATE INDEX document_versions_document_idx ON document_versions(document_id, version_no);

CREATE TABLE folder_items (
  id TEXT PRIMARY KEY NOT NULL,
  folder_id TEXT NOT NULL REFERENCES folders(id),
  item_type TEXT NOT NULL CHECK (item_type IN ('DOCUMENT','ENTITY_SHORTCUT')),
  item_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX folder_items_folder_idx ON folder_items(folder_id, sort_order, id);

CREATE TABLE entity_links (
  id TEXT PRIMARY KEY NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (source_type <> target_type OR source_id <> target_id)
);
CREATE INDEX entity_links_source_idx ON entity_links(source_type, source_id, created_at, id);
CREATE INDEX entity_links_target_idx ON entity_links(target_type, target_id, created_at, id);

CREATE TABLE tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (category, name)
);

CREATE TABLE tag_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  tag_id TEXT NOT NULL REFERENCES tags(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (tag_id, entity_type, entity_id)
);
CREATE INDEX tag_assignments_entity_idx ON tag_assignments(entity_type, entity_id, created_at, id);

CREATE TABLE review_schedules (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  timeframe_id TEXT NOT NULL REFERENCES timeframes(id),
  instrument_scope_type TEXT NOT NULL CHECK (instrument_scope_type = 'INSTRUMENT'),
  instrument_scope_id TEXT NOT NULL REFERENCES instruments(id),
  frequency_type TEXT NOT NULL CHECK (frequency_type IN ('EVERY_CANDLE','EVERY_2_CANDLES','EVERY_3_CANDLES','ONCE_TRADING_DAY','MANUAL')),
  frequency_value INTEGER NOT NULL CHECK (frequency_value >= 1),
  notification_policy_id TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX review_schedules_scope_idx ON review_schedules(instrument_scope_id, timeframe_id, enabled, id);

CREATE TABLE review_cycles (
  id TEXT PRIMARY KEY NOT NULL,
  review_schedule_id TEXT NOT NULL REFERENCES review_schedules(id),
  due_at TEXT NOT NULL,
  candle_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('DUE','COMPLETED','MISSED','SKIPPED')),
  created_at TEXT NOT NULL
);
CREATE INDEX review_cycles_schedule_due_idx ON review_cycles(review_schedule_id, due_at, id);
CREATE INDEX review_cycles_status_due_idx ON review_cycles(status, due_at, id);

CREATE TABLE market_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  review_cycle_id TEXT NOT NULL UNIQUE REFERENCES review_cycles(id),
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  timeframe_id TEXT NOT NULL REFERENCES timeframes(id),
  status TEXT NOT NULL CHECK (status IN ('DUE','COMPLETED','MISSED','SKIPPED')),
  previous_review_id TEXT REFERENCES market_reviews(id),
  idea_version_id TEXT REFERENCES idea_versions(id),
  direction TEXT NOT NULL CHECK (direction IN ('LONG','SHORT','NEUTRAL','UNCHANGED')),
  notes_document_id TEXT REFERENCES documents(id),
  reviewed_at TEXT,
  CHECK ((status = 'DUE') = (reviewed_at IS NULL))
);
CREATE INDEX market_reviews_scope_idx ON market_reviews(instrument_id, timeframe_id, reviewed_at, id);
CREATE INDEX market_reviews_status_idx ON market_reviews(status, id);

CREATE TABLE review_events (
  id TEXT PRIMARY KEY NOT NULL,
  market_review_id TEXT NOT NULL REFERENCES market_reviews(id),
  from_status TEXT NOT NULL CHECK (from_status = 'DUE'),
  to_status TEXT NOT NULL CHECK (to_status IN ('COMPLETED','MISSED','SKIPPED')),
  occurred_at TEXT NOT NULL,
  reason TEXT NOT NULL
);
CREATE INDEX review_events_review_idx ON review_events(market_review_id, occurred_at, id);

CREATE TABLE economic_events (
  id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL,
  provider_event_key TEXT NOT NULL,
  title TEXT NOT NULL,
  currency TEXT NOT NULL,
  impact TEXT NOT NULL CHECK (impact IN ('LOW','MEDIUM','HIGH','UNKNOWN')),
  scheduled_at TEXT NOT NULL,
  actual TEXT,
  forecast TEXT,
  previous TEXT,
  status TEXT NOT NULL,
  UNIQUE (provider_id, provider_event_key)
);
CREATE INDEX economic_events_schedule_idx ON economic_events(scheduled_at, currency, id);

CREATE TABLE economic_event_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  economic_event_id TEXT NOT NULL REFERENCES economic_events(id),
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (economic_event_id, revision_no)
);
CREATE INDEX economic_event_revisions_event_idx ON economic_event_revisions(economic_event_id, revision_no);

CREATE TRIGGER document_versions_linear_insert
BEFORE INSERT ON document_versions
BEGIN
  SELECT CASE
    WHEN NEW.version_no <> COALESCE((SELECT MAX(version_no) + 1 FROM document_versions WHERE document_id = NEW.document_id), 1)
    THEN RAISE(ABORT, 'DocumentVersion must extend current history head')
  END;
  SELECT CASE
    WHEN NEW.version_no > 1 AND NEW.supersedes_document_version_id <> (
      SELECT id FROM document_versions WHERE document_id = NEW.document_id ORDER BY version_no DESC LIMIT 1
    )
    THEN RAISE(ABORT, 'DocumentVersion supersedes pointer must reference current history head')
  END;
  SELECT CASE
    WHEN NEW.version_no > 1 AND NEW.created_at < (
      SELECT created_at FROM document_versions WHERE document_id = NEW.document_id ORDER BY version_no DESC LIMIT 1
    )
    THEN RAISE(ABORT, 'DocumentVersion cannot predate current history head')
  END;
END;

CREATE TRIGGER documents_current_version_integrity
BEFORE UPDATE OF current_version_id ON documents
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM document_versions v WHERE v.id = NEW.current_version_id AND v.document_id = NEW.id
  ) THEN RAISE(ABORT, 'Document current version must belong to document') END;
END;

${['document_versions','entity_links','review_events','economic_event_revisions'].map(immutableTriggers).join('\n')}
`;


const m6Schema = `
CREATE TABLE strategy_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  current_version_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE strategy_versions (
  id TEXT PRIMARY KEY NOT NULL,
  strategy_definition_id TEXT NOT NULL REFERENCES strategy_definitions(id),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  automation_capability TEXT NOT NULL CHECK (automation_capability IN ('MANUAL','DETECTABLE','AUTOMATABLE')),
  detector_json TEXT,
  created_at TEXT NOT NULL,
  supersedes_strategy_version_id TEXT REFERENCES strategy_versions(id),
  UNIQUE (strategy_definition_id, version_no),
  CHECK ((version_no = 1) = (supersedes_strategy_version_id IS NULL)),
  CHECK (id <> supersedes_strategy_version_id),
  CHECK (automation_capability <> 'AUTOMATABLE' OR detector_json IS NOT NULL)
);
CREATE INDEX strategy_versions_definition_idx ON strategy_versions(strategy_definition_id, version_no);

CREATE TABLE strategy_maps (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('COMBO','STRATEGY_MAP','TEMPLATE')),
  name TEXT NOT NULL,
  current_version_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE strategy_map_versions (
  id TEXT PRIMARY KEY NOT NULL,
  strategy_map_id TEXT NOT NULL REFERENCES strategy_maps(id),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  graph_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  supersedes_strategy_map_version_id TEXT REFERENCES strategy_map_versions(id),
  UNIQUE (strategy_map_id, version_no),
  CHECK ((version_no = 1) = (supersedes_strategy_map_version_id IS NULL)),
  CHECK (id <> supersedes_strategy_map_version_id)
);
CREATE INDEX strategy_map_versions_map_idx ON strategy_map_versions(strategy_map_id, version_no);

CREATE TRIGGER strategy_versions_linear_insert
BEFORE INSERT ON strategy_versions
BEGIN
  SELECT CASE
    WHEN NEW.version_no <> COALESCE((SELECT MAX(version_no) + 1 FROM strategy_versions WHERE strategy_definition_id = NEW.strategy_definition_id), 1)
    THEN RAISE(ABORT, 'StrategyVersion must extend current history head')
  END;
  SELECT CASE
    WHEN NEW.version_no > 1 AND NEW.supersedes_strategy_version_id <> (
      SELECT id FROM strategy_versions WHERE strategy_definition_id = NEW.strategy_definition_id ORDER BY version_no DESC LIMIT 1
    )
    THEN RAISE(ABORT, 'StrategyVersion supersedes pointer must reference current history head')
  END;
END;

CREATE TRIGGER strategy_map_versions_linear_insert
BEFORE INSERT ON strategy_map_versions
BEGIN
  SELECT CASE
    WHEN NEW.version_no <> COALESCE((SELECT MAX(version_no) + 1 FROM strategy_map_versions WHERE strategy_map_id = NEW.strategy_map_id), 1)
    THEN RAISE(ABORT, 'StrategyMapVersion must extend current history head')
  END;
  SELECT CASE
    WHEN NEW.version_no > 1 AND NEW.supersedes_strategy_map_version_id <> (
      SELECT id FROM strategy_map_versions WHERE strategy_map_id = NEW.strategy_map_id ORDER BY version_no DESC LIMIT 1
    )
    THEN RAISE(ABORT, 'StrategyMapVersion supersedes pointer must reference current history head')
  END;
END;

CREATE TRIGGER strategy_definitions_current_version_integrity
BEFORE UPDATE OF current_version_id ON strategy_definitions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM strategy_versions v WHERE v.id = NEW.current_version_id AND v.strategy_definition_id = NEW.id
  ) THEN RAISE(ABORT, 'Strategy current version must belong to definition') END;
END;

CREATE TRIGGER strategy_maps_current_version_integrity
BEFORE UPDATE OF current_version_id ON strategy_maps
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM strategy_map_versions v WHERE v.id = NEW.current_version_id AND v.strategy_map_id = NEW.id
  ) THEN RAISE(ABORT, 'Strategy Map current version must belong to map') END;
END;

${['strategy_versions','strategy_map_versions'].map(immutableTriggers).join('\n')}
`;


const m7Schema = `
ALTER TABLE strategy_versions ADD COLUMN deployment_status TEXT NOT NULL DEFAULT 'EXPERIMENTAL'
  CHECK (deployment_status IN ('EXPERIMENTAL','VALIDATED','DEMO_APPROVED','LIVE_APPROVED','RETIRED'));

CREATE TABLE strategy_runtimes (
  id TEXT PRIMARY KEY NOT NULL,
  colony_id TEXT NOT NULL REFERENCES colonies(id),
  strategy_map_version_id TEXT NOT NULL REFERENCES strategy_map_versions(id),
  mode TEXT NOT NULL CHECK (mode IN ('OBSERVE','SHADOW','DEMO','LIVE')),
  current_status TEXT NOT NULL CHECK (current_status IN ('READY','RUNNING','PAUSED','COMPLETED','CANCELLED','ERROR')),
  started_at TEXT NOT NULL,
  stopped_at TEXT
);
CREATE INDEX strategy_runtimes_colony_idx ON strategy_runtimes(colony_id, started_at, id);

CREATE TABLE runtime_nodes (
  id TEXT PRIMARY KEY NOT NULL,
  strategy_runtime_id TEXT NOT NULL REFERENCES strategy_runtimes(id),
  graph_node_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('DORMANT','ARMED','WATCHING','TRIGGERED','CONFIRMED','COMPLETED','FAILED','EXPIRED','CANCELLED','BYPASSED')),
  armed_at TEXT,
  triggered_at TEXT,
  confirmed_at TEXT,
  last_evaluated_candle_id TEXT,
  trigger_count INTEGER NOT NULL DEFAULT 0 CHECK (trigger_count >= 0),
  runtime_memory_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (strategy_runtime_id, graph_node_id)
);
CREATE INDEX runtime_nodes_runtime_state_idx ON runtime_nodes(strategy_runtime_id, state, graph_node_id);

CREATE TABLE runtime_node_events (
  id TEXT PRIMARY KEY NOT NULL,
  strategy_runtime_id TEXT NOT NULL REFERENCES strategy_runtimes(id),
  runtime_node_id TEXT NOT NULL REFERENCES runtime_nodes(id),
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_event_id TEXT,
  summary TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX runtime_node_events_runtime_time_idx ON runtime_node_events(strategy_runtime_id, occurred_at, id);

CREATE TABLE detector_evaluations (
  id TEXT PRIMARY KEY NOT NULL,
  runtime_node_id TEXT NOT NULL REFERENCES runtime_nodes(id),
  strategy_version_id TEXT NOT NULL REFERENCES strategy_versions(id),
  detector_key TEXT NOT NULL,
  detector_version TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('NOT_MET','PARTIAL','TRIGGERED','CONFIRMED','BLOCKED','FAILED','EXPIRED','ERROR')),
  evaluated_at TEXT NOT NULL,
  candle_id TEXT,
  diagnostics_json TEXT NOT NULL
);
CREATE INDEX detector_evaluations_node_time_idx ON detector_evaluations(runtime_node_id, evaluated_at, id);

CREATE TABLE decision_traces (
  id TEXT PRIMARY KEY NOT NULL,
  strategy_runtime_id TEXT NOT NULL REFERENCES strategy_runtimes(id),
  event_type TEXT NOT NULL,
  runtime_node_id TEXT REFERENCES runtime_nodes(id),
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX decision_traces_runtime_time_idx ON decision_traces(strategy_runtime_id, occurred_at, id);

CREATE TABLE runtime_processed_events (
  strategy_runtime_id TEXT NOT NULL REFERENCES strategy_runtimes(id),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (strategy_runtime_id, event_id)
);

CREATE TABLE runtime_action_proposals (
  correlation_id TEXT PRIMARY KEY NOT NULL,
  strategy_runtime_id TEXT NOT NULL REFERENCES strategy_runtimes(id),
  runtime_node_id TEXT NOT NULL REFERENCES runtime_nodes(id),
  graph_node_id TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX runtime_action_proposals_runtime_idx ON runtime_action_proposals(strategy_runtime_id, created_at, correlation_id);

${['runtime_node_events','detector_evaluations','decision_traces','runtime_processed_events','runtime_action_proposals'].map(immutableTriggers).join('\n')}
`;

const m8Schema = `
CREATE TABLE evidence_events (
  id TEXT PRIMARY KEY NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('STRATEGY_RUNTIME','TRADE','POSITION','REVIEW','MANUAL')),
  source_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('REVIEW','STRATEGY_TRIGGER','STRATEGY_CONFIRMATION','STRATEGY_FAILURE','STRATEGY_EXPIRY','CANDIDATE','ENTRY','SURVIVOR','PROTECTED','LEG','MATURE_LEG','TARGET_APPROACHING','TARGET_HIT','PARTIAL_EXIT','EXIT','CONSOLIDATION','RUNNER_CONVERSION','MANUAL')),
  status TEXT NOT NULL CHECK (status IN ('CONFIRMED','MANUALLY_CONFIRMED','FAILED','EXPIRED','BLOCKED','ERROR')),
  occurred_at TEXT NOT NULL,
  summary TEXT NOT NULL,
  decision_trace_id TEXT REFERENCES decision_traces(id),
  strategy_runtime_id TEXT REFERENCES strategy_runtimes(id),
  runtime_node_id TEXT REFERENCES runtime_nodes(id),
  timeframe TEXT,
  capture_policy TEXT NOT NULL CHECK (capture_policy IN ('ENTRY_ONLY','STRATEGY_EVIDENCE_AND_ENTRY','STRATEGY_EVIDENCE_ONLY','CUSTOM')),
  chart_workspace_state_json TEXT NOT NULL,
  framing_profile_json TEXT NOT NULL,
  UNIQUE (source_type, source_id, event_type)
);
CREATE INDEX evidence_events_runtime_time_idx ON evidence_events(strategy_runtime_id, occurred_at, id);
CREATE INDEX evidence_events_type_time_idx ON evidence_events(event_type, occurred_at, id);

CREATE TABLE evidence_references (
  id TEXT PRIMARY KEY NOT NULL,
  evidence_event_id TEXT NOT NULL REFERENCES evidence_events(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_version_id TEXT,
  relation_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX evidence_references_event_idx ON evidence_references(evidence_event_id, id);
CREATE INDEX evidence_references_entity_idx ON evidence_references(entity_type, entity_id, entity_version_id, id);

CREATE TABLE evidence_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  evidence_event_id TEXT NOT NULL REFERENCES evidence_events(id),
  chart_workspace_state_json TEXT NOT NULL,
  image_path TEXT NOT NULL UNIQUE,
  image_hash TEXT NOT NULL CHECK (length(image_hash) = 64),
  framing_profile_json TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  capture_origin TEXT NOT NULL CHECK (capture_origin IN ('AUTOMATIC','MANUAL','REGENERATED_VIEW'))
);
CREATE INDEX evidence_snapshots_event_idx ON evidence_snapshots(evidence_event_id, captured_at, id);

CREATE TABLE evidence_capture_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  evidence_event_id TEXT NOT NULL REFERENCES evidence_events(id),
  evidence_snapshot_id TEXT REFERENCES evidence_snapshots(id),
  status TEXT NOT NULL CHECK (status IN ('SUCCEEDED','FAILED')),
  error TEXT,
  attempted_at TEXT NOT NULL,
  CHECK ((status = 'SUCCEEDED') = (evidence_snapshot_id IS NOT NULL)),
  CHECK ((status = 'FAILED') = (error IS NOT NULL))
);
CREATE INDEX evidence_capture_attempts_event_idx ON evidence_capture_attempts(evidence_event_id, attempted_at, id);

CREATE TABLE evidence_stage_summaries (
  id TEXT PRIMARY KEY NOT NULL,
  strategy_runtime_id TEXT NOT NULL REFERENCES strategy_runtimes(id),
  timeframe TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE evidence_stage_summary_items (
  stage_summary_id TEXT NOT NULL REFERENCES evidence_stage_summaries(id),
  evidence_event_id TEXT NOT NULL REFERENCES evidence_events(id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (stage_summary_id, evidence_event_id),
  UNIQUE (stage_summary_id, ordinal)
);
CREATE INDEX evidence_stage_summary_items_event_idx ON evidence_stage_summary_items(evidence_event_id, stage_summary_id);

${['evidence_events','evidence_references','evidence_snapshots','evidence_capture_attempts','evidence_stage_summaries','evidence_stage_summary_items'].map(immutableTriggers).join('\n')}
`;

const m9Schema = `
CREATE TABLE mt5_session_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1), connection_state TEXT NOT NULL, truth_state TEXT NOT NULL,
  transport_mode TEXT, session_id TEXT, terminal_connected INTEGER NOT NULL CHECK (terminal_connected IN (0,1)),
  last_message_at TEXT, detail TEXT NOT NULL, account_key TEXT, updated_at TEXT NOT NULL
);
INSERT INTO mt5_session_state VALUES (1,'DISCONNECTED','UNKNOWN',NULL,NULL,0,NULL,'Local MT5 Agent unavailable; broker truth is unknown.',NULL,datetime('now'));

CREATE TABLE mt5_inbox (message_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, message_kind TEXT NOT NULL, correlation_id TEXT, received_at TEXT NOT NULL, processed_at TEXT NOT NULL);
CREATE TABLE mt5_outbox (message_id TEXT PRIMARY KEY, message_kind TEXT NOT NULL CHECK (message_kind IN ('HELLO','SNAPSHOT_REQUEST','HEARTBEAT')), payload_json TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('PENDING','SENT','ACKNOWLEDGED','FAILED','UNKNOWN')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE mt5_outbox_events (id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES mt5_outbox(message_id), from_status TEXT, to_status TEXT NOT NULL, occurred_at TEXT NOT NULL, detail TEXT NOT NULL);
CREATE TABLE broker_snapshots (id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES mt5_inbox(message_id), account_key TEXT, complete INTEGER NOT NULL CHECK (complete IN (0,1)), captured_at TEXT NOT NULL, payload_json TEXT NOT NULL, unavailable_reason TEXT);
CREATE TABLE broker_account_snapshots (id TEXT PRIMARY KEY, broker_snapshot_id TEXT NOT NULL REFERENCES broker_snapshots(id), account_key TEXT NOT NULL, payload_json TEXT NOT NULL, captured_at TEXT NOT NULL);
CREATE TABLE broker_symbol_mappings (account_key TEXT NOT NULL, broker_symbol TEXT NOT NULL, canonical_symbol TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(account_key,broker_symbol));
CREATE TABLE broker_quotes_current (account_key TEXT NOT NULL, broker_symbol TEXT NOT NULL, canonical_symbol TEXT NOT NULL, sequence INTEGER NOT NULL, payload_json TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY(account_key,broker_symbol));
CREATE TABLE broker_candles (account_key TEXT NOT NULL, broker_symbol TEXT NOT NULL, canonical_symbol TEXT NOT NULL, timeframe TEXT NOT NULL, open_time TEXT NOT NULL, payload_json TEXT NOT NULL, origin TEXT NOT NULL, PRIMARY KEY(account_key,broker_symbol,timeframe,open_time));
CREATE TABLE broker_positions_current (account_key TEXT NOT NULL, broker_position_key TEXT NOT NULL, canonical_symbol TEXT NOT NULL, payload_json TEXT NOT NULL, reality_state TEXT NOT NULL CHECK(reality_state IN ('OPEN','UNKNOWN')), classification TEXT CHECK(classification IN ('ATTACH_TO_COLONY','TRACK_AS_EXTERNAL','IGNORE')), colony_id TEXT REFERENCES colonies(id), first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, PRIMARY KEY(account_key,broker_position_key), CHECK((classification='ATTACH_TO_COLONY')=(colony_id IS NOT NULL)));
CREATE TABLE broker_pending_orders_current (account_key TEXT NOT NULL, broker_order_key TEXT NOT NULL, canonical_symbol TEXT NOT NULL, payload_json TEXT NOT NULL, reality_state TEXT NOT NULL CHECK(reality_state IN ('PENDING','UNKNOWN')), first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, PRIMARY KEY(account_key,broker_order_key));
CREATE TABLE broker_reality_events (id TEXT PRIMARY KEY, broker_snapshot_id TEXT, entity_type TEXT NOT NULL, entity_key TEXT NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL);
CREATE TABLE reconciliation_runs (id TEXT PRIMARY KEY, trigger TEXT NOT NULL CHECK(trigger IN ('STARTUP','RECONNECT','MANUAL')), status TEXT NOT NULL CHECK(status IN ('MATCHED','RECOVERY_REQUIRED','UNKNOWN')), broker_snapshot_id TEXT, account_key TEXT, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, detail TEXT NOT NULL);
CREATE TABLE reconciliation_items (id TEXT PRIMARY KEY, reconciliation_run_id TEXT NOT NULL REFERENCES reconciliation_runs(id), category TEXT NOT NULL CHECK(category IN ('MATCH','BROKER_ONLY','ARISE_ONLY','QUANTITY_MISMATCH','PROTECTION_MISMATCH','UNKNOWN')), entity_type TEXT NOT NULL, entity_key TEXT NOT NULL, detail TEXT NOT NULL);
CREATE TABLE mt5_connection_events (id TEXT PRIMARY KEY, from_state TEXT NOT NULL, to_state TEXT NOT NULL, reason TEXT NOT NULL, occurred_at TEXT NOT NULL, session_id TEXT);
CREATE TABLE mt5_safety_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, severity TEXT NOT NULL, detail TEXT NOT NULL, occurred_at TEXT NOT NULL, reconciliation_run_id TEXT);
${['mt5_inbox','mt5_outbox_events','broker_snapshots','broker_account_snapshots','broker_reality_events','reconciliation_runs','reconciliation_items','mt5_connection_events','mt5_safety_events'].map(immutableTriggers).join('\n')}
`;

const m10Schema = `
CREATE TABLE deployment_snapshots (id TEXT PRIMARY KEY, strategy_runtime_id TEXT NOT NULL REFERENCES strategy_runtimes(id), strategy_map_version_id TEXT NOT NULL, exact_versions_json TEXT NOT NULL, approved_mode TEXT NOT NULL CHECK(approved_mode IN ('SHADOW','DEMO')), created_at TEXT NOT NULL);
CREATE TABLE execution_intents (id TEXT PRIMARY KEY, proposal_correlation_id TEXT NOT NULL UNIQUE REFERENCES runtime_action_proposals(correlation_id), strategy_runtime_id TEXT NOT NULL REFERENCES strategy_runtimes(id), mode TEXT NOT NULL CHECK(mode IN ('SHADOW','DEMO')), payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE execution_validations (id TEXT PRIMARY KEY, execution_intent_id TEXT NOT NULL REFERENCES execution_intents(id), status TEXT NOT NULL CHECK(status IN ('PASS','BLOCK','ERROR')), checks_json TEXT NOT NULL, evaluated_at TEXT NOT NULL);
CREATE TABLE order_plans (id TEXT PRIMARY KEY, execution_intent_id TEXT NOT NULL UNIQUE REFERENCES execution_intents(id), deployment_snapshot_id TEXT NOT NULL REFERENCES deployment_snapshots(id), mode TEXT NOT NULL CHECK(mode IN ('SHADOW','DEMO')), account_key TEXT, expected_session_id TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE execution_lifecycles (order_plan_id TEXT PRIMARY KEY REFERENCES order_plans(id), state TEXT NOT NULL CHECK(state IN ('PLANNED','SHADOW_COMPLETED','COMMAND_PENDING','SENT','ACKNOWLEDGED','PARTIALLY_FILLED','FILLED','PROTECTING','ACTIVE','REJECTED','FAILED','FLATTENED','UNKNOWN')), filled_volume REAL NOT NULL DEFAULT 0 CHECK(filled_volume>=0), protected_volume REAL NOT NULL DEFAULT 0 CHECK(protected_volume>=0), updated_at TEXT NOT NULL, detail TEXT NOT NULL);
CREATE TABLE execution_lifecycle_events (id TEXT PRIMARY KEY, order_plan_id TEXT NOT NULL REFERENCES order_plans(id), from_state TEXT, to_state TEXT NOT NULL, event_type TEXT NOT NULL, detail TEXT NOT NULL, occurred_at TEXT NOT NULL);
CREATE TABLE execution_commands (id TEXT PRIMARY KEY, order_plan_id TEXT NOT NULL REFERENCES order_plans(id), idempotency_key TEXT NOT NULL UNIQUE, command_type TEXT NOT NULL CHECK(command_type IN ('CREATE_ORDER','SET_INITIAL_STOP','SAFETY_FLATTEN')), status TEXT NOT NULL CHECK(status IN ('CREATED','SENDING','ACKNOWLEDGED','COMPLETED','FAILED','UNKNOWN')), attempt_count INTEGER NOT NULL DEFAULT 0, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE execution_command_events (id TEXT PRIMARY KEY, command_id TEXT NOT NULL REFERENCES execution_commands(id), from_status TEXT, to_status TEXT NOT NULL, event_type TEXT NOT NULL, detail TEXT NOT NULL, occurred_at TEXT NOT NULL);
CREATE TABLE broker_execution_events (event_id TEXT PRIMARY KEY, message_id TEXT NOT NULL UNIQUE, command_id TEXT NOT NULL, order_plan_id TEXT NOT NULL, event_kind TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL);
CREATE TABLE execution_fills (event_id TEXT PRIMARY KEY REFERENCES broker_execution_events(event_id), order_plan_id TEXT NOT NULL REFERENCES order_plans(id), broker_order_key TEXT NOT NULL, broker_position_key TEXT NOT NULL, volume REAL NOT NULL CHECK(volume>0), price REAL NOT NULL, cumulative_volume REAL NOT NULL CHECK(cumulative_volume>0), remaining_volume REAL NOT NULL CHECK(remaining_volume>=0), filled_at TEXT NOT NULL);
CREATE TABLE initial_protection_attempts (event_id TEXT PRIMARY KEY REFERENCES broker_execution_events(event_id), order_plan_id TEXT NOT NULL REFERENCES order_plans(id), broker_position_key TEXT NOT NULL, attempt_no INTEGER NOT NULL CHECK(attempt_no>0), requested_stop REAL NOT NULL, actual_stop REAL, status TEXT NOT NULL CHECK(status IN ('VERIFIED','REJECTED')), reason TEXT, occurred_at TEXT NOT NULL);
CREATE TABLE execution_position_links (order_plan_id TEXT PRIMARY KEY REFERENCES order_plans(id), attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id), trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id), position_id TEXT NOT NULL UNIQUE REFERENCES positions(id), broker_position_key TEXT NOT NULL, materialized_at TEXT NOT NULL);
${['deployment_snapshots','execution_intents','execution_validations','order_plans','execution_lifecycle_events','execution_command_events','broker_execution_events','execution_fills','initial_protection_attempts','execution_position_links'].map(immutableTriggers).join('\n')}
`;

// M10 audit compatibility migration: preserve frozen v8 tables while adding an
// immutable ledger for Agent-owned protection and emergency-flatten effects.
const m10AuditSchema = `
CREATE TABLE execution_safety_operations (
  event_id TEXT PRIMARY KEY REFERENCES broker_execution_events(event_id),
  order_plan_id TEXT NOT NULL REFERENCES order_plans(id),
  broker_command_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK(operation_type IN ('SET_INITIAL_STOP','SAFETY_FLATTEN')),
  broker_position_key TEXT NOT NULL,
  target_volume REAL NOT NULL CHECK(target_volume>0),
  target_stop REAL,
  status TEXT NOT NULL CHECK(status IN ('VERIFIED','REJECTED')),
  attempt_no INTEGER NOT NULL CHECK(attempt_no>0 AND attempt_no<=2),
  occurred_at TEXT NOT NULL
);
${immutableTriggers('execution_safety_operations')}
`;

// M11 keeps frozen Position state intact and records management/protection as
// an independent, durable event stream. Broker effects use their own serialized
// command ledger but travel through the same Desktop <-> Agent gateway.
const m11Schema = `
CREATE TABLE protection_rule_versions (
  id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, version_no INTEGER NOT NULL CHECK(version_no>0),
  trigger_type TEXT NOT NULL, action_type TEXT NOT NULL, scope TEXT NOT NULL,
  config_json TEXT NOT NULL, allow_worsening INTEGER NOT NULL DEFAULT 0 CHECK(allow_worsening IN (0,1)),
  created_at TEXT NOT NULL, supersedes_id TEXT REFERENCES protection_rule_versions(id),
  UNIQUE(rule_id,version_no)
);
CREATE TABLE protection_trigger_events (
  id TEXT PRIMARY KEY, rule_version_id TEXT NOT NULL REFERENCES protection_rule_versions(id),
  source_type TEXT NOT NULL, source_id TEXT NOT NULL, payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL, correlation_id TEXT NOT NULL
);
CREATE TABLE protection_requests (
  id TEXT PRIMARY KEY, position_id TEXT NOT NULL REFERENCES positions(id), broker_position_key TEXT NOT NULL,
  rule_version_id TEXT NOT NULL REFERENCES protection_rule_versions(id), trigger_event_id TEXT NOT NULL REFERENCES protection_trigger_events(id),
  mode TEXT NOT NULL CHECK(mode IN ('SHADOW','DEMO')), action_type TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK(sequence_no>0), requested_stop REAL, requested_take_profit REAL,
  requested_close_volume REAL, status TEXT NOT NULL CHECK(status IN ('PLANNED','SHADOW_COMPLETED','COMMAND_PENDING','SENDING','UNKNOWN','VERIFIED','REJECTED','FAILED','SUPERSEDED')),
  payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(position_id,sequence_no)
);
CREATE TABLE protection_request_events (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES protection_requests(id), from_status TEXT,
  to_status TEXT NOT NULL, event_type TEXT NOT NULL, detail TEXT NOT NULL, occurred_at TEXT NOT NULL
);
CREATE TABLE management_commands (
  id TEXT PRIMARY KEY, protection_request_id TEXT NOT NULL UNIQUE REFERENCES protection_requests(id),
  position_id TEXT NOT NULL REFERENCES positions(id), idempotency_key TEXT NOT NULL UNIQUE,
  command_type TEXT NOT NULL CHECK(command_type IN ('MOVE_STOP','SET_TP','REMOVE_TP','PARTIAL_CLOSE','FULL_CLOSE')),
  sequence_no INTEGER NOT NULL CHECK(sequence_no>0), status TEXT NOT NULL CHECK(status IN ('CREATED','SENDING','UNKNOWN','COMPLETED','FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0 AND attempt_count<=3),
  payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX management_commands_position_status_idx ON management_commands(position_id,status,sequence_no);
CREATE TABLE management_command_events (
  id TEXT PRIMARY KEY, command_id TEXT NOT NULL REFERENCES management_commands(id), from_status TEXT,
  to_status TEXT NOT NULL, event_type TEXT NOT NULL, detail TEXT NOT NULL, occurred_at TEXT NOT NULL
);
CREATE TABLE broker_management_events (
  event_id TEXT PRIMARY KEY, message_id TEXT NOT NULL UNIQUE, command_id TEXT NOT NULL,
  protection_request_id TEXT NOT NULL, broker_position_key TEXT NOT NULL, sequence_no INTEGER NOT NULL,
  status TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL
);
CREATE TABLE position_protection_current (
  position_id TEXT PRIMARY KEY REFERENCES positions(id), state TEXT NOT NULL CHECK(state IN ('UNPROTECTED','PROTECTION_PENDING','PARTIALLY_PROTECTED','PROTECTED','PROTECTION_ERROR')),
  broker_position_key TEXT NOT NULL, broker_volume REAL NOT NULL CHECK(broker_volume>=0), protected_volume REAL NOT NULL CHECK(protected_volume>=0),
  verified_stop REAL, verified_take_profit REAL, last_applied_sequence INTEGER NOT NULL DEFAULT 0,
  truth_state TEXT NOT NULL CHECK(truth_state IN ('VERIFIED','UNKNOWN')), updated_at TEXT NOT NULL
);
CREATE TABLE protection_verifications (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES protection_requests(id), command_id TEXT NOT NULL,
  broker_position_key TEXT NOT NULL, broker_volume REAL NOT NULL CHECK(broker_volume>=0), protected_volume REAL NOT NULL CHECK(protected_volume>=0),
  actual_stop REAL, actual_take_profit REAL, status TEXT NOT NULL CHECK(status IN ('VERIFIED','REJECTED','STALE','UNKNOWN')),
  detail TEXT NOT NULL, occurred_at TEXT NOT NULL
);
CREATE TABLE broker_position_cost_events (
  id TEXT PRIMARY KEY, position_id TEXT NOT NULL REFERENCES positions(id), broker_fill_event_id TEXT,
  cost_type TEXT NOT NULL CHECK(cost_type IN ('COMMISSION','SWAP','FEE','ESTIMATED_EXIT_COST')),
  amount_money REAL NOT NULL, occurred_at TEXT NOT NULL, source_id TEXT NOT NULL
);
CREATE TABLE position_management_fills (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES protection_requests(id), position_id TEXT NOT NULL REFERENCES positions(id),
  broker_position_key TEXT NOT NULL, operation_type TEXT NOT NULL CHECK(operation_type IN ('PARTIAL_CLOSE','FULL_CLOSE')),
  requested_volume REAL NOT NULL CHECK(requested_volume>0), actual_closed_volume REAL NOT NULL CHECK(actual_closed_volume>=0),
  remaining_broker_volume REAL NOT NULL CHECK(remaining_broker_volume>=0), occurred_at TEXT NOT NULL
);
CREATE TABLE runner_conversion_events (
  id TEXT PRIMARY KEY, position_id TEXT NOT NULL REFERENCES positions(id), colony_id TEXT NOT NULL REFERENCES colonies(id),
  target_id TEXT REFERENCES targets(id), from_state TEXT NOT NULL, to_state TEXT NOT NULL CHECK(to_state='RUNNER'),
  policy_json TEXT NOT NULL, occurred_at TEXT NOT NULL, correlation_id TEXT NOT NULL
);
CREATE TABLE stacking_policy_versions (
  id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, colony_id TEXT NOT NULL REFERENCES colonies(id),
  version_no INTEGER NOT NULL CHECK(version_no>0), mode TEXT NOT NULL CHECK(mode IN ('ANY_VALID_ENTRY','ONLY_AFTER_SURVIVOR','ONLY_AFTER_PROTECTED','ONLY_AFTER_LEG','MANUAL')),
  config_json TEXT NOT NULL, created_at TEXT NOT NULL, supersedes_id TEXT REFERENCES stacking_policy_versions(id),
  UNIQUE(policy_id,version_no)
);
CREATE TABLE colony_automation_assignments (
  colony_id TEXT PRIMARY KEY REFERENCES colonies(id), stacking_policy_version_id TEXT NOT NULL REFERENCES stacking_policy_versions(id),
  attempt_budget_id TEXT REFERENCES attempt_budgets(id), invalidation_policy TEXT NOT NULL DEFAULT 'MANUAL_DECISION' CHECK(invalidation_policy IN ('KEEP_MANAGING','TIGHTEN','MOVE_TO_PROTECTION','CLOSE_ALL','MANUAL_DECISION')),
  countertrend_enabled INTEGER NOT NULL DEFAULT 0 CHECK(countertrend_enabled=0), entry_armed INTEGER NOT NULL DEFAULT 1 CHECK(entry_armed IN (0,1)),
  cooldown_until TEXT, current_period_key TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE colony_automation_events (
  id TEXT PRIMARY KEY, colony_id TEXT NOT NULL REFERENCES colonies(id), event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL, correlation_id TEXT NOT NULL
);
${['protection_rule_versions','protection_trigger_events','protection_request_events','management_command_events','broker_management_events','protection_verifications','broker_position_cost_events','position_management_fills','runner_conversion_events','stacking_policy_versions','colony_automation_events'].map(immutableTriggers).join('\n')}
`;

// M12 is read/study infrastructure. It adds immutable valuation and review
// history only; no execution/protection table or permission is widened.
const m12Schema = `
CREATE TABLE position_performance_events (
  id TEXT PRIMARY KEY, position_id TEXT NOT NULL REFERENCES positions(id),
  event_type TEXT NOT NULL CHECK(event_type IN ('EXIT_FILL','MARK')),
  quantity REAL, price REAL NOT NULL, money REAL,
  source_type TEXT NOT NULL, source_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
  UNIQUE(source_type,source_id,event_type),
  CHECK((event_type='EXIT_FILL' AND quantity>0) OR (event_type='MARK' AND quantity IS NULL))
);
CREATE INDEX position_performance_position_time_idx ON position_performance_events(position_id,occurred_at,id);

CREATE TABLE performance_reviews (
  id TEXT PRIMARY KEY, source_type TEXT NOT NULL CHECK(source_type IN ('TRADE','COLONY')), source_id TEXT NOT NULL,
  title TEXT NOT NULL, idea_version_id TEXT NOT NULL REFERENCES idea_versions(id), strategy_map_version_id TEXT REFERENCES strategy_map_versions(id),
  current_dissection_version_id TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(source_type,source_id,id)
);
CREATE TABLE review_dissection_versions (
  id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES performance_reviews(id), version_no INTEGER NOT NULL CHECK(version_no>0),
  dissection_json TEXT NOT NULL, created_at TEXT NOT NULL, supersedes_id TEXT REFERENCES review_dissection_versions(id),
  UNIQUE(review_id,version_no), CHECK((version_no=1)=(supersedes_id IS NULL))
);
CREATE TABLE review_evidence_links (
  id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES performance_reviews(id), evidence_event_id TEXT NOT NULL REFERENCES evidence_events(id),
  relation_type TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(review_id,evidence_event_id,relation_type)
);
CREATE TABLE lessons (
  id TEXT PRIMARY KEY, current_version_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE lesson_versions (
  id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL REFERENCES lessons(id), version_no INTEGER NOT NULL CHECK(version_no>0),
  status TEXT NOT NULL CHECK(status IN ('OBSERVATION','REPEATED_PATTERN','PLAYBOOK_RULE','MASTERED','ARCHIVED')),
  statement TEXT NOT NULL, created_at TEXT NOT NULL, supersedes_id TEXT REFERENCES lesson_versions(id),
  UNIQUE(lesson_id,version_no), CHECK((version_no=1)=(supersedes_id IS NULL))
);
CREATE TABLE lesson_evidence (
  id TEXT PRIMARY KEY, lesson_version_id TEXT NOT NULL REFERENCES lesson_versions(id), evidence_event_id TEXT NOT NULL REFERENCES evidence_events(id),
  relation_type TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(lesson_version_id,evidence_event_id,relation_type)
);
CREATE TABLE review_lesson_links (
  id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES performance_reviews(id), lesson_id TEXT NOT NULL REFERENCES lessons(id),
  created_at TEXT NOT NULL, UNIQUE(review_id,lesson_id)
);
CREATE TABLE strategy_change_proposals (
  id TEXT PRIMARY KEY, lesson_version_id TEXT NOT NULL REFERENCES lesson_versions(id), source_strategy_version_id TEXT NOT NULL REFERENCES strategy_versions(id),
  proposed_change TEXT NOT NULL, expected_effect TEXT NOT NULL, test_requirements TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PROPOSED','ACCEPTED','REJECTED')), resulting_strategy_version_id TEXT REFERENCES strategy_versions(id),
  created_at TEXT NOT NULL, resolved_at TEXT,
  CHECK((status='PROPOSED')=(resolved_at IS NULL)), CHECK((status='ACCEPTED')=(resulting_strategy_version_id IS NOT NULL))
);
CREATE TABLE strategy_change_proposal_events (
  id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES strategy_change_proposals(id), from_status TEXT, to_status TEXT NOT NULL,
  detail TEXT NOT NULL, occurred_at TEXT NOT NULL
);

CREATE TRIGGER review_dissection_versions_linear_insert BEFORE INSERT ON review_dissection_versions BEGIN
  SELECT CASE WHEN NEW.version_no <> COALESCE((SELECT MAX(version_no)+1 FROM review_dissection_versions WHERE review_id=NEW.review_id),1)
    THEN RAISE(ABORT,'Review dissection must extend current history head') END;
  SELECT CASE WHEN NEW.version_no>1 AND NEW.supersedes_id <> (SELECT id FROM review_dissection_versions WHERE review_id=NEW.review_id ORDER BY version_no DESC LIMIT 1)
    THEN RAISE(ABORT,'Review dissection supersedes pointer must reference current history head') END;
END;
CREATE TRIGGER lesson_versions_linear_insert BEFORE INSERT ON lesson_versions BEGIN
  SELECT CASE WHEN NEW.version_no <> COALESCE((SELECT MAX(version_no)+1 FROM lesson_versions WHERE lesson_id=NEW.lesson_id),1)
    THEN RAISE(ABORT,'LessonVersion must extend current history head') END;
  SELECT CASE WHEN NEW.version_no>1 AND NEW.supersedes_id <> (SELECT id FROM lesson_versions WHERE lesson_id=NEW.lesson_id ORDER BY version_no DESC LIMIT 1)
    THEN RAISE(ABORT,'LessonVersion supersedes pointer must reference current history head') END;
END;
${['position_performance_events','review_dissection_versions','review_evidence_links','lesson_versions','lesson_evidence','review_lesson_links','strategy_change_proposal_events'].map(immutableTriggers).join('\n')}
`;

const strategyPackageSchema = `
CREATE TABLE strategy_package_imports (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  package_type TEXT NOT NULL CHECK(package_type IN ('STRATEGY','COMBO','TEMPLATE')),
  package_version TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK(length(checksum)=64),
  imported_at TEXT NOT NULL,
  source_json TEXT NOT NULL,
  originating_filename TEXT NOT NULL,
  definition_id TEXT REFERENCES strategy_definitions(id),
  definition_version_id TEXT REFERENCES strategy_versions(id),
  map_id TEXT REFERENCES strategy_maps(id),
  map_version_id TEXT REFERENCES strategy_map_versions(id),
  dependency_state_json TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  UNIQUE(package_id,package_version)
);
CREATE INDEX strategy_package_imports_package_id_idx ON strategy_package_imports(package_id);
${immutableTriggers('strategy_package_imports')}
`;

// Keep the original M0 table intact as migration v1, then move it aside in M2.
export const migrations: readonly Migration[] = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY NOT NULL,
      instrument_id TEXT NOT NULL,
      thesis_timeframe TEXT NOT NULL,
      direction TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );`,
  },
  { version: 2, sql: m2Schema },
  { version: 3, sql: m5Schema },
  { version: 4, sql: m6Schema },
  { version: 5, sql: m7Schema },
  { version: 6, sql: m8Schema },
  { version: 7, sql: m9Schema },
  { version: 8, sql: m10Schema },
  { version: 9, sql: m10AuditSchema },
  { version: 10, sql: m11Schema },
  { version: 11, sql: m12Schema },
  { version: 12, sql: strategyPackageSchema },
];

export function applyMigrations(sqlite: Database.Database, steps: readonly Migration[] = migrations): void {
  sqlite.transaction(() => {
    const current = sqlite.pragma('user_version', { simple: true }) as number;
    if (current > steps.length) throw new Error('Database schema is newer than this ARISE build');
    for (const [index, step] of steps.entries()) {
      if (step.version !== index + 1) throw new Error('Migrations must be sequential');
      if (step.version <= current) continue;
      sqlite.exec(step.sql);
      sqlite.pragma(`user_version = ${step.version}`);
    }
  })();
}
