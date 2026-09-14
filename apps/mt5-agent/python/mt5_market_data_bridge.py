"""Read-only MetaTrader 5 market-data bridge for ARISE charts.

This bridge intentionally has no mutation surface. It returns broker/account
metadata, current quotes, positions/orders, and a configurable amount of OHLC
history for the configured symbols/timeframes. JSON is read from stdin and JSON
is written to stdout.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import MetaTrader5 as mt5


class BridgeError(RuntimeError):
    pass


def utc_iso(seconds: float | int | None = None) -> str:
    value = time.time() if seconds is None else float(seconds)
    return datetime.fromtimestamp(value, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def finite(value: Any, fallback: float = 0.0) -> float:
    number = float(value if value is not None else fallback)
    return number if math.isfinite(number) else fallback


def account_key(account: Any) -> str:
    identity = f"{account.server}:{account.login}".encode("utf-8")
    return hashlib.sha256(identity).hexdigest()[:24]


def initialize_terminal(request: dict[str, Any]) -> tuple[Any, Any]:
    terminal_path = str(request.get("terminalPath", "")).strip()
    if not terminal_path:
        raise BridgeError("Explicit terminalPath is required")
    if not mt5.initialize(path=terminal_path, timeout=60_000, portable=False):
        raise BridgeError(f"MT5 initialize failed: {mt5.last_error()}")
    terminal = mt5.terminal_info()
    account = mt5.account_info()
    if terminal is None or account is None:
        raise BridgeError(f"MT5 terminal/account unavailable: {mt5.last_error()}")
    return terminal, account


def mapping_by_broker(request: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for item in request.get("symbolMappings", []):
        broker = str(item.get("brokerSymbol", "")).strip()
        canonical = str(item.get("canonicalSymbol", "")).strip()
        pip_size = finite(item.get("pipSize"))
        if not broker or not canonical or pip_size <= 0:
            raise BridgeError("Invalid explicit broker symbol mapping")
        result[broker] = {"brokerSymbol": broker, "canonicalSymbol": canonical, "pipSize": pip_size}
    if not result:
        raise BridgeError("At least one explicit broker symbol mapping is required")
    return result


TIMEFRAMES: dict[str, tuple[int, int]] = {
    "M1": (mt5.TIMEFRAME_M1, 60),
    "M5": (mt5.TIMEFRAME_M5, 300),
    "M15": (mt5.TIMEFRAME_M15, 900),
    "H1": (mt5.TIMEFRAME_H1, 3600),
    "H4": (mt5.TIMEFRAME_H4, 14400),
    "D1": (mt5.TIMEFRAME_D1, 86400),
    "W1": (mt5.TIMEFRAME_W1, 604800),
}


def symbol_snapshot(symbol: str, mapping: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    if not mt5.symbol_select(symbol, True):
        raise BridgeError(f"MT5 symbol_select failed for {symbol}: {mt5.last_error()}")
    info = mt5.symbol_info(symbol)
    tick = mt5.symbol_info_tick(symbol)
    if info is None or tick is None or finite(tick.ask) < finite(tick.bid):
        raise BridgeError(f"MT5 symbol/quote unavailable for {symbol}")
    symbol_value = {
        "brokerSymbol": symbol,
        "canonicalSymbol": mapping["canonicalSymbol"],
        "digits": int(info.digits),
        "tickSize": finite(info.trade_tick_size, finite(info.point)),
        "pipSize": finite(mapping["pipSize"]),
        "contractSize": finite(info.trade_contract_size),
        "minVolume": finite(info.volume_min),
        "volumeStep": finite(info.volume_step),
        "maxVolume": finite(info.volume_max),
        "stopsLevel": max(0, int(info.trade_stops_level)),
        "freezeLevel": max(0, int(info.trade_freeze_level)),
    }
    broker_time = utc_iso(
        finite(getattr(tick, "time_msc", 0)) / 1000
        if getattr(tick, "time_msc", 0)
        else getattr(tick, "time", time.time())
    )
    quote = {
        "brokerSymbol": symbol,
        "bid": finite(tick.bid),
        "ask": finite(tick.ask),
        "brokerTime": broker_time,
        "receivedAt": broker_time,
        "sequence": max(0, int(getattr(tick, "time_msc", 0))),
    }
    return symbol_value, quote


def candle_snapshots(symbol: str, timeframe_name: str, bars: int) -> list[dict[str, Any]]:
    descriptor = TIMEFRAMES.get(timeframe_name)
    if descriptor is None:
        return []
    count = max(1, min(2000, int(bars)))
    rates = mt5.copy_rates_from_pos(symbol, descriptor[0], 0, count)
    if rates is None:
        return []
    result: list[dict[str, Any]] = []
    now = time.time()
    for rate in rates:
        opened = int(rate["time"])
        close_seconds = opened + descriptor[1]
        result.append({
            "brokerSymbol": symbol,
            "timeframe": timeframe_name,
            "openTime": utc_iso(opened),
            "closeTime": utc_iso(close_seconds) if close_seconds <= now else None,
            "open": finite(rate["open"]),
            "high": finite(rate["high"]),
            "low": finite(rate["low"]),
            "close": finite(rate["close"]),
            "tickVolume": max(0, int(rate["tick_volume"])),
            "origin": "LIVE",
        })
    return result


def position_snapshot(position: Any) -> dict[str, Any]:
    return {
        "brokerPositionKey": str(position.ticket),
        "brokerSymbol": position.symbol,
        "direction": "LONG" if int(position.type) == int(mt5.POSITION_TYPE_BUY) else "SHORT",
        "volume": finite(position.volume),
        "openPrice": finite(position.price_open),
        "currentPrice": finite(position.price_current),
        "stopLoss": finite(position.sl) if finite(position.sl) > 0 else None,
        "takeProfit": finite(position.tp) if finite(position.tp) > 0 else None,
        "openedAt": utc_iso(position.time),
        "magic": int(position.magic),
        "comment": str(position.comment or ""),
    }


ORDER_TYPE_NAMES = {
    mt5.ORDER_TYPE_BUY_LIMIT: ("BUY_LIMIT", "LONG"),
    mt5.ORDER_TYPE_SELL_LIMIT: ("SELL_LIMIT", "SHORT"),
    mt5.ORDER_TYPE_BUY_STOP: ("BUY_STOP", "LONG"),
    mt5.ORDER_TYPE_SELL_STOP: ("SELL_STOP", "SHORT"),
    mt5.ORDER_TYPE_BUY_STOP_LIMIT: ("BUY_STOP_LIMIT", "LONG"),
    mt5.ORDER_TYPE_SELL_STOP_LIMIT: ("SELL_STOP_LIMIT", "SHORT"),
}


def order_snapshot(order: Any) -> dict[str, Any]:
    order_name, direction = ORDER_TYPE_NAMES.get(int(order.type), (f"TYPE_{order.type}", "LONG"))
    return {
        "brokerOrderKey": str(order.ticket),
        "brokerSymbol": order.symbol,
        "orderType": order_name,
        "direction": direction,
        "volume": finite(order.volume_current),
        "price": finite(order.price_open),
        "stopLoss": finite(order.sl) if finite(order.sl) > 0 else None,
        "takeProfit": finite(order.tp) if finite(order.tp) > 0 else None,
        "placedAt": utc_iso(order.time_setup),
        "magic": int(order.magic),
        "comment": str(order.comment or ""),
    }


def make_snapshot(request: dict[str, Any], terminal: Any, account: Any) -> dict[str, Any]:
    configured = mapping_by_broker(request)
    positions = list(mt5.positions_get() or [])
    orders = list(mt5.orders_get() or [])
    needed = set(configured)
    needed.update(position.symbol for position in positions)
    needed.update(order.symbol for order in orders)
    symbols: list[dict[str, Any]] = []
    quotes: list[dict[str, Any]] = []
    candles: list[dict[str, Any]] = []
    missing: list[str] = []
    history_bars = max(1, min(2000, int(request.get("historyBars", 3))))
    requested_timeframes = [str(value) for value in request.get("timeframes", ["M1", "M5"])]
    for broker_symbol in sorted(needed):
        mapping = configured.get(
            broker_symbol,
            {
                "brokerSymbol": broker_symbol,
                "canonicalSymbol": broker_symbol,
                "pipSize": finite(getattr(mt5.symbol_info(broker_symbol), "point", 0)),
            },
        )
        try:
            symbol_value, quote = symbol_snapshot(broker_symbol, mapping)
            symbols.append(symbol_value)
            quotes.append(quote)
            if broker_symbol in configured:
                for timeframe in requested_timeframes:
                    candles.extend(candle_snapshots(broker_symbol, timeframe, history_bars))
        except BridgeError:
            missing.append(broker_symbol)
    complete = bool(terminal.connected) and not missing
    captured = utc_iso()
    is_demo = int(account.trade_mode) == int(mt5.ACCOUNT_TRADE_MODE_DEMO)
    return {
        "snapshotId": str(uuid.uuid4()),
        "complete": complete,
        "capturedAt": captured,
        "account": {
            "accountKey": account_key(account),
            "broker": str(account.company),
            "server": str(account.server),
            "login": str(account.login),
            "currency": str(account.currency),
            "balance": finite(account.balance),
            "equity": finite(account.equity),
            "margin": max(0, finite(account.margin)),
            "freeMargin": finite(account.margin_free),
            "leverage": max(1, int(account.leverage)),
            "isLive": not is_demo,
            "hedging": int(account.margin_mode) == int(mt5.ACCOUNT_MARGIN_MODE_RETAIL_HEDGING),
            "capturedAt": captured,
        },
        "symbols": symbols,
        "positions": [position_snapshot(position) for position in positions],
        "pendingOrders": [order_snapshot(order) for order in orders],
        "quotes": quotes,
        "candles": candles,
        "unavailableReason": None if complete else f"MT5 snapshot incomplete; unavailable symbols: {','.join(missing)}",
    }


def terminal_metadata(terminal: Any, account: Any) -> dict[str, Any]:
    trade_mode = int(account.trade_mode)
    if trade_mode == int(mt5.ACCOUNT_TRADE_MODE_DEMO):
        account_mode = "DEMO"
    elif trade_mode == int(mt5.ACCOUNT_TRADE_MODE_CONTEST):
        account_mode = "CONTEST"
    else:
        account_mode = "REAL"
    return {
        "build": int(getattr(terminal, "build", 0)),
        "company": str(getattr(terminal, "company", "")),
        "connected": bool(getattr(terminal, "connected", False)),
        "tradeAllowed": bool(getattr(terminal, "trade_allowed", False)),
        "externalApiDisabled": bool(getattr(terminal, "tradeapi_disabled", False)),
        "accountTradeAllowed": bool(getattr(account, "trade_allowed", False)),
        "accountTradeExpert": bool(getattr(account, "trade_expert", False)),
        "accountTradeMode": account_mode,
        "server": str(getattr(account, "server", "")),
    }


def main() -> None:
    try:
        request = json.load(sys.stdin)
        if request.get("operation") != "snapshot":
            raise BridgeError("Market-data bridge accepts only snapshot operations")
        terminal, account = initialize_terminal(request)
        output = {
            "ok": True,
            "snapshot": make_snapshot(request, terminal, account),
            "terminalMetadata": terminal_metadata(terminal, account),
        }
    except Exception as error:
        output = {"ok": False, "error": str(error)}
    finally:
        try:
            mt5.shutdown()
        except Exception:
            pass
    sys.stdout.write(json.dumps(output, separators=(",", ":")))


if __name__ == "__main__":
    main()
