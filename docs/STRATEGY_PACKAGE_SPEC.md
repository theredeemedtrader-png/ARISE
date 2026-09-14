# ARISE Strategy Package Specification

**Status:** Phase 1 public authoring contract  
**Schema version:** `1`  
**Minimum product:** ARISE `1.0.0-beta.2`

## Purpose

ARISE Strategy Packages are portable, declarative JSON documents. An external author, including ChatGPT, can create a package without repository access. A user selects the file in the installed application, reviews validation results, and explicitly imports it into the immutable Strategy Encyclopedia/Graph history.

Packages are data only. They cannot contain or execute TypeScript, JavaScript, Python, shell commands, DLLs, native code, modules, filesystem instructions, network instructions, or process commands. They can reference only trusted capabilities compiled into ARISE.

Machine-readable schema: [`schema/strategy-package-v1.schema.json`](schema/strategy-package-v1.schema.json)

## Extensions and declared type

| Extension | `packageType` | Meaning |
|---|---|---|
| `.arise-strategy` | `STRATEGY` | One reusable Strategy Definition/detector-level definition; optional graph |
| `.arise-combo` | `COMBO` | Reusable graph composition |
| `.arise-template` | `TEMPLATE` | Higher-level graph plus Colony/attempt/stacking/protection-reference configuration |

The declared `packageType` is authoritative. A mismatched filename extension produces a warning; it never changes semantics. `COMBO` and `TEMPLATE` require a graph. `STRATEGY` requires `definition`. Only `TEMPLATE` may contain `template` configuration.

## Root object

Every root field is required, including fields whose value is `null` or an empty array.

| Field | Contract |
|---|---|
| `schemaVersion` | Integer `1`. Unknown versions fail closed. |
| `packageType` | `STRATEGY`, `COMBO`, or `TEMPLATE`. |
| `packageId` | Stable opaque identity matching `^[A-Za-z0-9][A-Za-z0-9_.:-]*$`, maximum 128 characters. |
| `name`, `description` | Human-facing metadata. |
| `version` | Semantic version such as `1.0.0` or `1.0.0-beta.1`. |
| `createdAt` | ISO-8601 timestamp. |
| `author` | `{ name, source, url }`; `url` may be `null`. |
| `minimumAriseVersion` | Minimum compatible ARISE semantic version. |
| `capabilityRequirements` | Required trusted built-in capabilities. |
| `dependencies` | Explicit detector, Strategy-package, and Combo-package requirements. |
| `parameters` | Typed public parameters. |
| `graph` | Portable Strategy Graph or `null`. |
| `timeframeMappings` | Timeframe/purpose assignments; no timeframe has a hard-coded purpose. |
| `evidencePolicy` | Existing ARISE Evidence/Decision Trace capture intent. |
| `deploymentRestrictions` | Package compatibility only; never grants authority. |
| `definition` | Strategy metadata for `STRATEGY`; otherwise `null`. |
| `template` | Template metadata for `TEMPLATE`; otherwise `null`. |
| `integrity` | SHA-256 metadata. |

Unknown fields are rejected. This prevents a newer or malicious producer from relying on behavior that the installed validator does not understand.

## Integrity checksum

`integrity.algorithm` is `SHA-256`. `integrity.checksum` is 64 lowercase hexadecimal characters.

To calculate it:

1. Remove the entire root `integrity` property.
2. Canonically serialize the remaining value:
   - JSON primitives use normal JSON encoding;
   - arrays retain their order;
   - object keys are sorted lexicographically at every depth;
   - emit no whitespace.
3. SHA-256 hash the UTF-8 bytes.
4. Store the lowercase hexadecimal digest in `integrity.checksum`.

Whitespace and object-key order in the downloaded file do not affect integrity. Array order does.

## Dependencies and semantic versions

Each dependency is:

```json
{ "id": "price_touch", "versionRange": ">=1.0.0", "required": true }
```

Supported ranges are exact (`1.0.0`), minimum (`>=1.0.0`), compatible-major (`^1.0.0`), and compatible-minor (`~1.2.0`). Phase 1 never downloads dependencies.

Validation reports `SATISFIED`, `MISSING`, `INCOMPATIBLE_VERSION`, `UNSUPPORTED_CAPABILITY`, or `CIRCULAR_DEPENDENCY`. Unresolved required dependencies block import. Optional unresolved dependencies are visible but do not block. Cycles across Strategy/Combo package identities are rejected.

`graph` Strategy nodes reference portable package identity rather than SQLite IDs:

```json
"strategyRef": {
  "packageId": "org.example.price-touch",
  "versionRange": "^1.0.0"
}
```

A Strategy package may reference itself. Other references must resolve to already imported Strategy packages. Combo dependencies document composition prerequisites; Phase 1 does not recursively embed or auto-download another Combo graph.

## Parameter definitions

Supported `type` values:

- `BOOLEAN`, `INTEGER`, `DECIMAL`, `PIPS`, `PRICE`
- `TIMEFRAME`, `DIRECTION`, `ENUM`, `STRING`, `DURATION`, `CANDLE_COUNT`
- `MARKET_OBJECT_ROLE`, `MARKET_OBJECT_TYPE`, `DETECTOR_REFERENCE`

Each parameter has `key`, `label`, `description`, `type`, `defaultValue`, `minimum`, `maximum`, `allowedValues`, `required`, `unit`, `scope`, and `access`.

- `scope`: `INHERITED` or `LOCAL`
- `access`: `USER_EDITABLE` or `READ_ONLY`
- `DIRECTION`: `LONG`, `SHORT`, or `NEUTRAL`
- bounds apply to numeric values
- `allowedValues`, when non-empty, constrains the default and user value

On a Strategy import, these definitions become the trusted detector contract's existing `parameterSchema`. Graph-node `parameters` remain the existing per-node runtime parameter mechanism; no parallel runtime parameter engine is introduced.

## Graph format

`graph` contains `nodes` and `edges`. Node IDs and edge IDs must be unique. Edge endpoints must exist. Self-edges, duplicate connections, dangling references, and cycles fail validation. Phase 1 graphs are DAGs because repeated participation belongs to Attempt/Stacking policies, not graph cycles.

Common node fields:

```text
id, family, label, position {x,y}, timeframe|null,
purposes[], importance, executionMode
```

Families and additional fields:

| Family | Fields |
|---|---|
| `STRATEGY` | `strategyRef`, `parameters` |
| `LOGIC` | `operator`: `AND`, `OR`, `THEN`, `NOT` |
| `MODIFIER` | `modifierKey`, `parameters` |
| `MARKET_OBJECT` | `marketObjectId`, `marketObjectVersionId`, `conditionKey` |
| `STATE` | `stateKey` |
| `ACTION` | `actionKey`, `parameters` |

Supported trusted Phase 1 identifiers:

- Detectors: `price_touch`, `price_cross`, `zone_entry`, `spread`, `liquidity_sweep`, `displacement`, `fvg`, `fvg_retracement`, `mss`; detector version `1`.
- Modifiers: `require_candle_close`, `allow_intracandle`, `max_spread`.
- Market Object conditions: `price_touch`, `zone_entry`.
- State keys: `thesis_active`, `area_armed`, `scout_active`, `leg_protected`, `target_approaching`.
- Actions: `notify`, `arm_strategy`, `create_scout`, `cancel_pending`, `move_stop`, `partial_close`, `promote_leg`, `convert_runner`, `take_snapshot`, `create_lesson_marker`.

An accepted action identifier only means the existing runtime can represent it. Import never runs an action. Runtime, deployment, validation, Attempt/Stacking, reconciliation, and broker gateways retain authority.

## Timeframe mappings

Each mapping contains:

```json
{
  "timeframe": "M5",
  "purposes": ["ENTRY"],
  "importance": "REQUIRED",
  "mode": "AUTOMATED"
}
```

Purposes are `HINDSIGHT`, `AREA`, and `ENTRY`, in any combination or none. Importance is `REQUIRED`, `OPTIONAL`, or `INFORMATIONAL`. Mapping mode is `MANUAL`, `CONFIRMATION`, `AUTOMATED`, or `IGNORED`. No Weekly/Daily/intraday role mapping is implicit.

## Evidence policy

Profiles:

- `ENTRY_ONLY`
- `STRATEGY_EVIDENCE_AND_ENTRY`
- `STRATEGY_EVIDENCE_ONLY`
- `CUSTOM`

Events: `TRIGGER`, `CONFIRMATION`, `FAILURE`, `EXPIRY`, `ENTRY`, `STAGE_SUMMARY`.

References: `CANDLE`, `MARKET_OBJECT`, `DECISION_TRACE`, `RUNTIME_NODE_EVENT`, `ENTRY_SNAPSHOT`, `STAGE_SUMMARY`.

The package records capture intent against the existing Evidence/Decision Trace vocabulary. It does not introduce another evidence store. Phase 1 preserves the complete policy in immutable package provenance; existing runtime confirmation and Decision Trace behavior remains authoritative.

## Deployment and safety

`allowedModes` may contain only `OBSERVE`, `SHADOW`, and `DEMO`. `preferredMode` must be in `allowedModes`. A declaration describes compatibility; it is not permission.

All imported Strategy versions are created as `EXPERIMENTAL`, and the UI defaults imported operation to `OBSERVE`. Existing graph weakest-dependency gating still controls SHADOW/DEMO. `LIVE` is rejected by the package validator and remains unavailable in the product. Import does not launch a runtime, create a proposal, place an order, change account permissions, change broker configuration, or contact a dependency service.

## Identity, upgrades, and conflicts

- New `packageId`: creates stable Strategy/Map identities and immutable version 1.
- Same identity/version/checksum: `IDENTICAL`; import is an idempotent no-op.
- Same identity/version/different checksum: `CONFLICT`; blocked.
- Newer semantic version: `UPGRADE`; requires explicit confirmation and appends immutable Strategy/Map versions.
- Older than the imported head: `OLDER`; blocked from becoming current.
- Same identity/different package type: `CONFLICT`; blocked.

Historical imported package rows, manifests, checksums, source metadata, filenames, dependency results, and resulting Definition/Map version IDs remain immutable.

## Import and export flow

Import:

```text
Strategy -> Import Package -> Windows file picker -> parse -> validate
-> preview -> explicit Import/Confirm Upgrade -> immutable database transaction
```

The renderer never receives arbitrary filesystem access. Electron main reads only the user-selected file and keeps the parsed manifest behind a short-lived preview token. Import revalidates the manifest/checksum before writing.

Export:

```text
select Strategy/Combo/Template -> Export Package -> Windows save picker
-> canonical manifest + checksum
```

An unchanged imported version exports its preserved public manifest losslessly. Native ARISE definitions/maps receive stable exported package identities and explicit dependencies.

## Limits and rejection behavior

- Maximum UTF-8 package size: 1 MiB.
- Maximum structural nesting: 32.
- Maximum graph: 512 nodes / 1024 edges.
- Executable or side-effect field names, prototype-pollution keys, path traversal, absolute Windows paths, unknown fields, invalid scalar types, invalid enum values, and unsupported identifiers fail closed.
- Validation failure performs no package database write and no broker mutation.

## Examples

- [`../examples/strategy-packages/price-touch-notification.arise-strategy`](../examples/strategy-packages/price-touch-notification.arise-strategy)
- [`../examples/strategy-packages/minimal-observe-combo.arise-combo`](../examples/strategy-packages/minimal-observe-combo.arise-combo)
- [`../examples/strategy-packages/minimal-observe-template.arise-template`](../examples/strategy-packages/minimal-observe-template.arise-template)

The Price Touch Notification file is the external-authoring acceptance fixture. It was authored against this specification, uses only public package IDs and trusted identifiers, and contains no internal database IDs.

## Deferred work

Phase 1 does not add detector implementations, a scripting language, arbitrary plugins, dependency downloads, Combo graph embedding, LIVE deployment, or real trading methodology content. A later phase may define a constrained detector-definition language under a separate safety milestone.
