# ARISE Strategy Package System Phase 1 Report

**Status:** PASSED  
**Branch:** `feature/strategy-packages`  
**Product version:** `1.0.0-beta.2`  
**Package schema:** `1`  
**Date:** 2026-09-14

## Outcome

ARISE now accepts externally authored, data-only Strategy Packages through the installed Windows application. The accepted workflow is:

```text
external .arise-strategy file
-> Strategy / Import Package
-> parse and fail-closed validation
-> user-visible preview
-> explicit import
-> immutable Strategy Definition and Strategy Map versions
-> restart persistence
-> export and identical re-import
-> OBSERVE runtime
```

The installed `1.0.0-beta.2` executable completed that workflow with the published Price Touch Notification fixture. The imported detector confirmed, its notification action was traced as `ACTION_OBSERVED`, no action proposal was created, broker command count remained `0`, and a direct request for `LIVE` was rejected.

## Architecture and public contract

- `.arise-strategy`, `.arise-combo`, and `.arise-template` are canonical JSON with an explicit `packageType`; filename extensions do not confer meaning.
- [`docs/STRATEGY_PACKAGE_SPEC.md`](docs/STRATEGY_PACKAGE_SPEC.md) is the human authoring contract.
- [`docs/schema/strategy-package-v1.schema.json`](docs/schema/strategy-package-v1.schema.json) is the machine-readable schema.
- `packages/strategy-engine/src/packages.ts` owns strict parsing, limits, checksums, semantic-version ranges, trusted identifiers, graph reconstruction, and trust validation.
- `StrategyPackageRepository` owns preview classification, dependency resolution, atomic import, immutable provenance, upgrade rules, and export.
- Electron main owns Windows file dialogs and filesystem reads/writes. The sandboxed renderer receives a typed preview and short-lived token, not filesystem authority.
- Imported parameters populate the existing detector `parameterSchema`; graph parameters use the existing node/runtime mechanism.
- Portable Strategy references resolve to exact immutable `StrategyVersion` IDs before the existing graph validator/runtime sees the graph.
- Evidence declarations use existing Evidence/Decision Trace vocabulary. The manifest is retained exactly, while runtime confirmations and action observations continue through the existing Decision Trace path.

## Trust and security model

Packages are data only. The validator rejects unknown fields, unsupported schema/package/node/parameter/enum/action values, executable-code or side-effect field names, prototype-pollution keys, path traversal, absolute Windows paths, invalid integrity data, invalid graphs, unresolved required dependencies, and `LIVE` deployment requests.

No `eval`, `Function`, dynamic import, package-provided module, process spawn, DLL/native loader, network fetch, or package-directed filesystem operation was added. Packages reference only detectors, node families, actions, modifiers, states, Market Object conditions, and capabilities compiled into ARISE.

Limits are 1 MiB, nesting depth 32, 512 graph nodes, and 1,024 graph edges. Validation and dependency failures occur before the atomic database transaction. Import never launches a runtime or changes account/broker configuration.

## Dependencies, identity, and upgrades

Required detector, Strategy, Combo, and capability dependencies report `SATISFIED`, `MISSING`, `INCOMPATIBLE_VERSION`, `UNSUPPORTED_CAPABILITY`, or `CIRCULAR_DEPENDENCY`. Exact, `>=`, `^`, and `~` semantic-version ranges are supported. Phase 1 never downloads dependencies.

Imports distinguish `NEW`, `IDENTICAL`, `UPGRADE`, `OLDER`, and `CONFLICT`. Identical content is an idempotent no-op. Same identity/version with different content is blocked. A newer version requires explicit confirmation and appends immutable Definition/Map versions. Older versions cannot replace the current head. Imported Strategies begin as `EXPERIMENTAL`; OBSERVE is the default and the existing deployment ceiling remains authoritative.

## Database migration

Migration `12` adds `strategy_package_imports`, indexed by package identity, with:

- stable package ID/type/version and SHA-256 checksum;
- import time, source/author JSON, and originating filename;
- resulting Definition/DefinitionVersion and Map/MapVersion IDs;
- dependency validation state and the exact original manifest;
- a unique identity/version constraint and immutable update/delete triggers.

Migration tests proved schema 11 data upgrades to schema 12 without losing existing records.

## Examples

- [`examples/strategy-packages/price-touch-notification.arise-strategy`](examples/strategy-packages/price-touch-notification.arise-strategy)
- [`examples/strategy-packages/minimal-observe-combo.arise-combo`](examples/strategy-packages/minimal-observe-combo.arise-combo)
- [`examples/strategy-packages/minimal-observe-template.arise-template`](examples/strategy-packages/minimal-observe-template.arise-template)

The Price Touch Notification fixture uses only the published contract and portable identities. It contains no SQLite IDs or internal source representation.

## Installed Windows acceptance

Artifact:

`release/windows/ARISE-Setup-1.0.0-beta.2.exe`

- Size: `117,508,083` bytes
- SHA-256: `A36EFD9D991FA669BB4278CB5751033F1178EC56B9CBA830FDEB4DEBF2636DDC`
- NSIS per-user silent install: exit `0`
- Preview/validation/import: PASS
- Encyclopedia reconstruction: PASS, imported Strategy is `EXPERIMENTAL`
- Graph reconstruction: PASS, 2 nodes / 1 edge
- Restart persistence: PASS
- Lossless export and identical re-import: PASS
- OBSERVE detector/action trace: PASS
- Broker commands before/after: `0 / 0`
- LIVE request: rejected
- Uninstall: exit `0`; acceptance data retained

Upgrade/data retention used the existing beta.1 installer and one persistent isolated data root. Beta.1 created marker Idea `525b8d31-cfc4-42ac-9282-4d374a925c04`; after installing beta.2 over beta.1, the same marker ID was returned, migration reached schema 12, and the Strategy Package workflow passed in that retained profile.

## Automated validation

- `pnpm check`: PASS — 659 unit/integration tests.
- `pnpm build`: PASS.
- `pnpm test:e2e`: PASS — 14 standard Electron journeys; the explicitly gated real-Eightcap trade journey skipped.
- Package schema/adversarial validation: PASS — 19 package tests, including all required malformed/security classes.
- Strategy engine: PASS — 36 tests.
- Database: PASS — 78 tests, including migration, dependency, version/conflict, atomic import, and round-trip coverage.
- External package development E2E: PASS.
- Packaged `win-unpacked` external package smoke: PASS.
- Installed NSIS beta.2 external package smoke: PASS.
- Beta.1 -> beta.2 marker/data retention: PASS.

No real broker trade was placed during this phase.

## Source commits

- `e0a8c23` — portable package domain/schema/spec/examples
- `4ac6426` — immutable persistence and import/export services
- `53c54e9` — typed IPC and Strategy import/export UI
- `22efbaf` — adversarial validation and external-package E2E
- `23d34ae` — installed-package acceptance tooling

## Known limitations and deferred work

- Windows file association/double-click import is deferred; the supported Phase 1 path is the Strategy file picker.
- Dependencies are neither downloaded nor recursively embedded.
- Phase 1 does not define new detector primitives or a detector-definition language.
- No generic scripting or arbitrary plugin execution exists.
- Template Colony/attempt/stacking/protection settings are preserved as immutable package configuration; applying them to a newly created Idea/Colony remains an explicit later workflow.
- Evidence policies are preserved and use current Decision Trace behavior; a future milestone may add more policy-driven automatic capture events.
- LIVE remains unavailable. Imported package metadata cannot grant deployment authority.
- The installer remains unsigned and Windows x64 only, consistent with Windows Productization Phase 1.

## Recommendation

STRATEGY PACKAGE SYSTEM PHASE 1: PASSED
