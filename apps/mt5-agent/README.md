# ARISE MT5 Agent

The Agent exposes the frozen localhost Desktop protocol and has three explicit transport identities:

- `MT5_READ_ONLY` — default; terminal mutation is unavailable.
- `FAKE_HARNESS` — deterministic automated failure coverage.
- `MT5_DEMO` — real MetaTrader 5 Python integration, hard-limited to an account whose terminal reports `ACCOUNT_TRADE_MODE_DEMO`.

There is deliberately no `MT5_LIVE` mode.

## Real demo prerequisites

1. Install Python 3 and the pinned official bridge package:

   ```powershell
   py -m venv .venv-mt5
   .\.venv-mt5\Scripts\python.exe -m pip install -r apps\mt5-agent\requirements-real-mt5.txt
   ```

2. Start MT5 and log into a dedicated demo hedging account. Enable algorithmic trading and external Python API access.
3. Configure explicit terminal, ledger, and symbol identities. The ledger must be on durable local storage.

   ```powershell
   $env:ARISE_MT5_MODE='DEMO'
   $env:ARISE_MT5_PYTHON='C:\path\to\.venv-mt5\Scripts\python.exe'
   $env:ARISE_MT5_TERMINAL_PATH='C:\Program Files\MetaTrader 5\terminal64.exe'
   $env:ARISE_MT5_LEDGER_PATH="$env:LOCALAPPDATA\ARISE\mt5-agent-ledger.json"
   $env:ARISE_MT5_SYMBOLS_JSON='[{"canonicalSymbol":"EURUSD","brokerSymbol":"EURUSD.i","pipSize":0.0001}]'
   pnpm --filter @arise/mt5-agent start
   ```

`ARISE_MT5_SYMBOLS_JSON` is mandatory: the Agent does not guess a broker suffix or pip size for executable instruments.

## Safety boundary

Before every effect, the Desktop gateway, local Agent server, TypeScript demo connector, and Python terminal bridge validate their applicable context. The Python bridge checks demo account mode before preparing its durable ledger or calling `order_send`. Contest and real-money accounts are rejected as unsafe.

The connector supports the frozen M10 market `CREATE_ORDER` command and frozen M11 stop, TP, partial-close, and full-close commands. It does not add a pending-entry command because the frozen M10 command has no pending type/price semantics. Broker pending orders are still imported in snapshots and remain external unless existing reconciliation rules classify them otherwise.

The bridge uses an ARISE magic number plus a compact idempotency marker in the broker comment, backed by an atomic durable Agent ledger. A prepared command is reconciled against current broker position/order state before retry. A bridge failure after send produces no guessed success/rejection; the Desktop enters its existing UNKNOWN/reconciliation path.

## Real-terminal probe

With the environment above configured:

```powershell
pnpm --filter @arise/mt5-agent test:real-mt5
```

The probe prints no login/account number. It exits non-zero unless the connected terminal is an eligible demo account and the live-account guard is intact. Full mutation acceptance additionally requires the controlled demo scenario checklist in `REAL_MT5_DEMO_ACCEPTANCE_REPORT.md`.
