# ARISE Windows Productization Phase 1 Report

**Status:** PASSED  
**Validated:** 2026-09-14 on Windows x64  
**Branch:** `product/windows-packaging`  
**Product version:** `1.0.0-beta.1`

## Scope and frozen baseline

Phase 1 packages the accepted ARISE desktop and its local MT5 Agent. It does not redesign trading behavior, change Strategy Runtime semantics, weaken execution/protection/reconciliation gates, enable LIVE, or begin Strategy Package work.

- Frozen acceptance tag: `v1.0.0-demo-accepted`
- Frozen tag target: `50d68cd25dbe1e24720374a82fe40156e8af5cae`
- Productization source branch point: `cfed9ecf9fe40a651b36b976206ac250c2f7907d` (the accepted baseline plus the official brand assets)
- The historical M13 and Real MT5 Demo Acceptance results remain unchanged.

## Packaging architecture

ARISE uses `electron-builder` 26 with its established NSIS target. The installer is per-user and does not require administrator privileges. It creates an ARISE Start Menu shortcut and Desktop shortcut, registers an uninstaller, and packages the application in an `asar` archive while unpacking the native `better-sqlite3` binding. No publisher or auto-update endpoint is configured.

Build commands:

```powershell
pnpm package:dir
pnpm package:win
```

Artifacts:

- Installer: `release/windows/ARISE-Setup-1.0.0-beta.1.exe`
- Unpacked executable: `release/windows/win-unpacked/ARISE.exe`
- Default installed executable: `%LOCALAPPDATA%\Programs\ARISE\ARISE.exe`
- Default uninstaller: `%LOCALAPPDATA%\Programs\ARISE\Uninstall ARISE.exe`

The build embeds the short Git commit and UTC build date. System Health displays those values together with application version, SQLite schema version, MT5 protocol version, runtime type, data directory, and log directory.

## Official branding

Canonical, maintained sources:

- `assets/brand/arise-symbol.svg`
- `assets/brand/arise-wordmark.svg`

Generated build derivatives:

- `apps/desktop/build/generated/arise.ico`
- `apps/desktop/build/generated/arise-symbol-{16,24,32,48,64,128,256}.png`

`build-assets.mjs` rasterizes the canonical symbol without changing its SVG geometry. The symbol-only ICO is configured for the executable, installer, BrowserWindow, taskbar/Alt+Tab inheritance, Start Menu shortcut, Desktop shortcut, and uninstall entry. The full official wordmark appears in System Health; the official symbol appears in the application shell.

Validation extracted the embedded icon from both the installed `ARISE.exe` and installer and visually confirmed the official blue angular symbol. Neither extraction showed the Electron default icon, text, an emoji, or a generic letter A.

## Production data and database safety

The stable product root is `%LOCALAPPDATA%\ARISE\`:

```text
%LOCALAPPDATA%\ARISE\
  data\arise.db
  evidence\
  logs\arise.log
  backups\
  config\mt5.json
  runtime\mt5-agent-ledger.json
```

Electron-owned cache/state directories also live below this user-data root. No mutable database, evidence, configuration, ledger, or log is stored below the installation directory.

Before opening an existing database, ARISE creates a timestamped backup (with WAL/SHM sidecars when present) and retains the ten latest database backups. The existing ordered migrations remain authoritative, WAL remains required, and an unsupported/migration-failing database closes and produces a visible startup error pointing to the production log. Legacy `arise.db` data is adopted only when the organized destination is absent; it is never used to overwrite an existing destination. Explicit test/diagnostic roots do not import unrelated profile data.

## Logging and diagnostics

The production log is `%LOCALAPPDATA%\ARISE\logs\arise.log`. It is structured JSON Lines, rotates at 5 MiB, and records version/build, startup, pre-start backup, database schema readiness, Agent process state, local transport handshake, startup failures, and clean shutdown. Common secret fields and credential-bearing MT5 URLs are redacted. No renderer API exposes arbitrary files, Python, SQLite, environment variables, or credentials.

## MT5 Agent and private Python deployment

The packaged Electron main process launches the bundled Agent with Electron `utilityProcess`; it does not require global Node. The Agent JavaScript bundle resides inside the application archive. Runtime resources are resolved only from `process.resourcesPath` and the product data directories.

The installer contains:

- private CPython `3.13.14` x64 runtime;
- `MetaTrader5==5.0.6180`;
- `numpy==2.5.3`;
- the packaged `mt5_bridge.py` resource.

The CPython archive SHA-256 is pinned and verified during packaging. The Python packages are exact-version, binary-only installs, followed by an import/version smoke test. A Python 3.13 build interpreter and network access are packaging-host prerequisites only; users do not need Python.

On first launch, ARISE creates a credential-free `config/mt5.json` in `READ_ONLY` mode. An explicit terminal path and explicit symbol mappings are required before a terminal connector starts. `LIVE` is not a valid product config value. In read-only mode the Agent supplies snapshots but is not given a mutation connector. `DEMO` remains the sole mutation-capable option and the frozen account-mode, fingerprint, reconciliation, idempotency, retry, protection, and LIVE hard-block gates remain authoritative.

## Electron security

Packaged validation confirmed:

- `contextIsolation: true`;
- `sandbox: true`;
- `nodeIntegration: false`;
- renderer `window.require` and `window.process` are unavailable;
- the typed `window.arise` preload remains the only renderer bridge;
- no automatic DevTools opening;
- no direct renderer access to SQLite, MT5, Python, or arbitrary filesystem operations.

## Validation results

Fresh install:

- NSIS installer exited `0` without elevation.
- Installed executable and uninstaller were present.
- Start Menu and Desktop shortcuts targeted the installed ARISE executable.
- `%LOCALAPPDATA%\ARISE` directories were created while pre-existing acceptance ledgers were preserved.
- SQLite opened in WAL mode and migrated to schema `11`.
- Installed UI, chart, Ideas, Strategy, Review, Evidence, Database, and System Health loaded.
- App closed cleanly and relaunched successfully.

Upgrade/data retention:

- A temporary `1.0.0-beta.0` NSIS package was installed for upgrade testing; it was not committed or designated as a release.
- Through the normal typed IPC, it created marker Idea `205ce914-f4b7-417b-9ed9-b1a2c931de73`.
- Installing final `1.0.0-beta.1` over it succeeded and returned the same marker ID from the same database.
- Startup backups and schema `11` remained intact.

Uninstall:

- Silent NSIS uninstall exited `0` and removed the installation directory.
- `%LOCALAPPDATA%\ARISE`, `data/arise.db`, configuration, evidence/log directories, and pre-existing acceptance files remained.
- The database SHA-256 was unchanged across the isolated uninstall check.

Packaged MT5 read-only check:

- Installed app launched its packaged Agent and private Python bridge without the repository, VS Code, PowerShell, pnpm, global Node, global Python, or the acceptance venv on the runtime path.
- The Agent completed protocol-v3 handshake in `MT5_READ_ONLY` mode.
- The installed app recognized `Eightcap-Demo`, DEMO account mode, and `EURUSD.i` from an explicit read-only product config.
- Broker truth reached `CONNECTED / VERIFIED`; `readOnly=true`; `executionAvailable=false`.
- No broker execution or management command was sent during productization validation.

Automated gates:

- `pnpm check`: PASS, 635 unit/integration tests.
- `pnpm build`: PASS.
- `pnpm test:e2e`: PASS, 13 standard Electron journeys; the explicitly gated real-trade journey skipped.
- Private Python runtime import/version smoke: PASS.
- Packaged application smoke and renderer-isolation smoke: PASS.
- Real MT5 read-only recognition from the installed app: PASS.

## Known limitations

- The build and installer are unsigned. Windows SmartScreen may warn until a trusted code-signing certificate is introduced.
- Phase 1 produces Windows x64 artifacts only.
- Auto-update distribution is intentionally not configured; NSIS package identity and stable data paths are ready for a later update phase.
- Terminal discovery/configuration has no settings UI yet. The operator must edit `%LOCALAPPDATA%\ARISE\config\mt5.json` with an explicit terminal path and symbol mappings. The file contains no broker credentials.
- The build host needs Python 3.13/pip and network access to assemble the pinned private runtime. Installed users do not.
- The Desktop shortcut is created by the Phase 1 installer and may be deleted by the user; a dedicated installer checkbox is not yet provided.

## Recommendation

WINDOWS PRODUCTIZATION PHASE 1: PASSED
