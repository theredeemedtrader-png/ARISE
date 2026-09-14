"""One-shot, demo-only MetaTrader 5 bridge for the ARISE local Agent.

JSON is read from stdin and JSON is written to stdout. The bridge deliberately
checks ACCOUNT_TRADE_MODE_DEMO before touching its durable mutation ledger or
calling order_send. Contest and real-money accounts are treated as live/unsafe.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

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


def marker(idempotency_key: str) -> str:
    digest = hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()[:16]
    return f"ARISE:{digest}"


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


def require_demo(terminal: Any, account: Any, expected_account_key: str | None = None) -> None:
    if int(account.trade_mode) != int(mt5.ACCOUNT_TRADE_MODE_DEMO):
        raise BridgeError("LIVE/contest account detected; demo-only connector blocked mutation before order_send")
    if expected_account_key is not None and account_key(account) != expected_account_key:
        raise BridgeError("MT5 account identity changed; mutation blocked")
    if not bool(terminal.connected) or not bool(terminal.trade_allowed):
        raise BridgeError("MT5 terminal is disconnected or terminal trading is disabled")
    if bool(getattr(terminal, "tradeapi_disabled", False)):
        raise BridgeError("MT5 external Python trading API is disabled")
    if not bool(account.trade_allowed) or not bool(account.trade_expert):
        raise BridgeError("MT5 account does not permit Expert/Python trading")
    if int(account.margin_mode) != int(mt5.ACCOUNT_MARGIN_MODE_RETAIL_HEDGING):
        raise BridgeError("Real ARISE demo mutation requires a hedging account for independent Scout identity")


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
    broker_time = utc_iso(finite(getattr(tick, "time_msc", 0)) / 1000 if getattr(tick, "time_msc", 0) else getattr(tick, "time", time.time()))
    quote = {
        "brokerSymbol": symbol,
        "bid": finite(tick.bid),
        "ask": finite(tick.ask),
        "brokerTime": broker_time,
        # A one-shot query does not make an old broker tick fresh. Reuse the
        # authoritative tick time so the Agent's stale-quote gate fails closed.
        "receivedAt": broker_time,
        "sequence": max(0, int(getattr(tick, "time_msc", 0))),
    }
    return symbol_value, quote


TIMEFRAMES: dict[str, tuple[int, int]] = {
    "M1": (mt5.TIMEFRAME_M1, 60),
    "M5": (mt5.TIMEFRAME_M5, 300),
    "M15": (mt5.TIMEFRAME_M15, 900),
    "H1": (mt5.TIMEFRAME_H1, 3600),
    "H4": (mt5.TIMEFRAME_H4, 14400),
    "D1": (mt5.TIMEFRAME_D1, 86400),
}


def candle_snapshots(symbol: str, timeframe_name: str) -> list[dict[str, Any]]:
    descriptor = TIMEFRAMES.get(timeframe_name)
    if descriptor is None:
        return []
    rates = mt5.copy_rates_from_pos(symbol, descriptor[0], 0, 3)
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
    for broker_symbol in sorted(needed):
        mapping = configured.get(broker_symbol, {
            "brokerSymbol": broker_symbol,
            "canonicalSymbol": broker_symbol,
            "pipSize": finite(getattr(mt5.symbol_info(broker_symbol), "point", 0)),
        })
        try:
            symbol_value, quote = symbol_snapshot(broker_symbol, mapping)
            symbols.append(symbol_value)
            quotes.append(quote)
            if broker_symbol in configured:
                for timeframe in request.get("timeframes", ["M1", "M5"]):
                    candles.extend(candle_snapshots(broker_symbol, str(timeframe)))
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


def load_ledger(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "commands": {}}
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("version") != 1 or not isinstance(value.get("commands"), dict):
        raise BridgeError("MT5 Agent ledger is corrupt or incompatible")
    return value


def save_ledger(path: Path, ledger: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        handle.write(json.dumps(ledger, sort_keys=True, separators=(",", ":")))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def command_fingerprint(operation: str, command: dict[str, Any]) -> str:
    stable = {key: value for key, value in command.items() if key not in {"commandId", "expectedSessionId"}}
    return hashlib.sha256(json.dumps({"operation": operation, "command": stable}, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def volume_aligned(volume: float, step: float) -> bool:
    return step > 0 and abs(volume / step - round(volume / step)) <= 1e-7


def broker_position(ticket: str) -> Any | None:
    values = mt5.positions_get(ticket=int(ticket))
    return values[0] if values else None


def find_marker_position(symbol: str, comment: str, magic: int) -> Any | None:
    for position in mt5.positions_get(symbol=symbol) or []:
        if int(position.magic) == magic and str(position.comment or "").startswith(comment):
            return position
    return None


def find_marker_order(symbol: str, comment: str, magic: int) -> Any | None:
    for order in mt5.orders_get(symbol=symbol) or []:
        if int(order.magic) == magic and str(order.comment or "").startswith(comment):
            return order
    return None


def command_history_window(command: dict[str, Any]) -> tuple[datetime, datetime]:
    try:
        created = datetime.fromisoformat(str(command.get("createdAt", "")).replace("Z", "+00:00"))
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        created = datetime.now(timezone.utc) - timedelta(days=30)
    return created - timedelta(minutes=5), datetime.now(timezone.utc) + timedelta(minutes=1)


def find_marker_history(command: dict[str, Any], comment: str, magic: int) -> tuple[list[Any], list[Any]]:
    start, end = command_history_window(command)
    symbol = str(command["brokerSymbol"])
    orders = [
        order for order in (mt5.history_orders_get(start, end) or [])
        if str(getattr(order, "symbol", "")) == symbol
        and int(getattr(order, "magic", 0)) == magic
        and str(getattr(order, "comment", "") or "").startswith(comment)
    ]
    deals = [
        deal for deal in (mt5.history_deals_get(start, end) or [])
        if str(getattr(deal, "symbol", "")) == symbol
        and int(getattr(deal, "magic", 0)) == magic
        and str(getattr(deal, "comment", "") or "").startswith(comment)
        and int(getattr(deal, "entry", -1)) == int(mt5.DEAL_ENTRY_IN)
        and finite(getattr(deal, "volume", 0)) > 0
    ]
    return orders, deals


def historical_execution_payloads(command: dict[str, Any], orders: list[Any], deals: list[Any]) -> list[dict[str, Any]]:
    orders.sort(key=lambda order: (int(getattr(order, "time_setup_msc", 0)), int(order.ticket)))
    deals.sort(key=lambda deal: (int(getattr(deal, "time_msc", 0)), int(deal.ticket)))
    broker_order_key = str(getattr(deals[-1], "order", orders[-1].ticket if orders else "historical")) if deals else str(orders[-1].ticket)
    payloads: list[dict[str, Any]] = [{
        "kind": "COMMAND_ACK",
        "commandId": command["commandId"],
        "idempotencyKey": command["idempotencyKey"],
        "status": "ALREADY_APPLIED",
        "brokerOrderKey": broker_order_key,
        "reason": "Recovered prior broker effect from immutable MT5 history; exposure was not resent",
    }]
    if not deals:
        return payloads
    cumulative = 0.0
    position_key = str(getattr(deals[-1], "position_id", getattr(deals[-1], "position", broker_order_key)))
    for deal in deals:
        volume = finite(deal.volume)
        cumulative += volume
        payloads.append({
            "kind": "FILL",
            "eventId": f"mt5-deal-{int(deal.ticket)}",
            "commandId": command["commandId"],
            "orderPlanId": command["orderPlanId"],
            "brokerOrderKey": str(getattr(deal, "order", broker_order_key)),
            "brokerPositionKey": str(getattr(deal, "position_id", position_key)),
            "volume": volume,
            "price": finite(deal.price),
            "cumulativeVolume": cumulative,
            "remainingVolume": max(0, finite(command["volume"]) - cumulative),
            "filledAt": utc_iso(getattr(deal, "time", time.time())),
        })
    payloads.append({
        "kind": "FLATTEN_RESULT",
        "eventId": f"mt5-recovered-flat-{position_key}",
        "commandId": command["commandId"],
        "orderPlanId": command["orderPlanId"],
        "brokerPositionKey": position_key,
        "brokerCommandId": f"mt5-recovered-flat-{position_key}",
        "idempotencyKey": f"{command['idempotencyKey']}:recovered-terminal:{position_key}",
        "targetVolume": finite(command["volume"]),
        "status": "VERIFIED",
        "closedVolume": cumulative,
        "reason": "Broker history proves the entry executed but no exposure remains; broker truth is authoritative",
        "occurredAt": utc_iso(),
    })
    return payloads


def accepted_retcode(retcode: int) -> bool:
    return retcode in {
        int(mt5.TRADE_RETCODE_DONE),
        int(mt5.TRADE_RETCODE_DONE_PARTIAL),
        int(mt5.TRADE_RETCODE_PLACED),
    }


def fill_mode(request: dict[str, Any]) -> dict[str, Any]:
    for candidate in (mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN):
        trial = {**request, "type_filling": candidate}
        checked = mt5.order_check(trial)
        if checked is not None and int(checked.retcode) == 0:
            return trial
    checked = mt5.order_check(request)
    reason = getattr(checked, "comment", None) if checked is not None else mt5.last_error()
    raise BridgeError(f"MT5 order_check rejected request: {reason}")


def stop_valid(info: Any, tick: Any, direction: str, stop: float, current_stop: float | None = None) -> bool:
    executable = finite(tick.bid if direction == "LONG" else tick.ask)
    minimum = max(int(info.trade_stops_level), int(info.trade_freeze_level)) * finite(info.point)
    correct_side = stop < executable if direction == "LONG" else stop > executable
    improves = current_stop is None or (stop >= current_stop if direction == "LONG" else stop <= current_stop)
    return correct_side and improves and abs(executable - stop) + 1e-12 >= minimum


def execution_rejection(command: dict[str, Any], reason: str) -> list[dict[str, Any]]:
    return [{
        "kind": "COMMAND_ACK",
        "commandId": command["commandId"],
        "idempotencyKey": command["idempotencyKey"],
        "status": "REJECTED",
        "brokerOrderKey": None,
        "reason": reason,
    }]


def management_rejection(command: dict[str, Any], reason: str) -> list[dict[str, Any]]:
    return [{
        "kind": "MANAGEMENT_ACK",
        "eventId": str(uuid.uuid4()),
        "commandId": command["commandId"],
        "protectionRequestId": command["protectionRequestId"],
        "idempotencyKey": command["idempotencyKey"],
        "brokerEffectId": f"rejected:{command['idempotencyKey']}",
        "brokerPositionKey": command["brokerPositionKey"],
        "sequence": int(command["sequence"]),
        "status": "REJECTED",
        "actualVolume": finite(command["expectedBrokerVolume"]),
        "actualStop": None,
        "actualTakeProfit": None,
        "closedVolume": 0,
        "reason": reason,
        "occurredAt": utc_iso(),
    }]


def replay_payloads(payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = json.loads(json.dumps(payloads))
    for payload in result:
        if payload.get("kind") == "COMMAND_ACK" and payload.get("status") == "ACCEPTED":
            payload["status"] = "ALREADY_APPLIED"
            payload["reason"] = "Durable MT5 Agent idempotency identity already applied"
        if payload.get("kind") == "MANAGEMENT_ACK" and payload.get("status") == "VERIFIED":
            payload["status"] = "ALREADY_APPLIED"
            payload["reason"] = "Durable MT5 Agent idempotency identity already applied"
    return result


def modify_stop(position: Any, stop: float, magic: int) -> tuple[bool, str | None]:
    request = {
        "action": mt5.TRADE_ACTION_SLTP,
        "position": int(position.ticket),
        "symbol": position.symbol,
        "sl": stop,
        "tp": finite(position.tp),
        "magic": magic,
    }
    checked = mt5.order_check(request)
    if checked is None or int(checked.retcode) != 0:
        return False, f"order_check: {getattr(checked, 'comment', mt5.last_error())}"
    result = mt5.order_send(request)
    if result is None or not accepted_retcode(int(result.retcode)):
        return False, f"order_send: {getattr(result, 'comment', mt5.last_error())}"
    time.sleep(0.2)
    current = broker_position(str(position.ticket))
    tick_size = finite(mt5.symbol_info(position.symbol).trade_tick_size, 1e-8)
    return current is not None and abs(finite(current.sl) - stop) <= tick_size / 2 + 1e-10, None


def close_position(position: Any, volume: float, magic: int, comment: str) -> tuple[bool, float, str | None]:
    tick = mt5.symbol_info_tick(position.symbol)
    if tick is None:
        return False, 0, "Quote unavailable for close"
    is_long = int(position.type) == int(mt5.POSITION_TYPE_BUY)
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "position": int(position.ticket),
        "symbol": position.symbol,
        "volume": volume,
        "type": mt5.ORDER_TYPE_SELL if is_long else mt5.ORDER_TYPE_BUY,
        "price": finite(tick.bid if is_long else tick.ask),
        "deviation": 20,
        "magic": magic,
        "comment": comment,
        "type_time": mt5.ORDER_TIME_GTC,
    }
    try:
        request = fill_mode(request)
    except BridgeError as error:
        return False, 0, str(error)
    result = mt5.order_send(request)
    if result is None or not accepted_retcode(int(result.retcode)):
        return False, 0, f"order_send: {getattr(result, 'comment', mt5.last_error())}"
    time.sleep(0.25)
    remaining = broker_position(str(position.ticket))
    actual = finite(remaining.volume) if remaining is not None else 0
    closed = max(0, finite(position.volume) - actual)
    return closed > 0, closed, None


def execution_fill_payloads(command: dict[str, Any], position: Any, status: str) -> list[dict[str, Any]]:
    deals = [
        deal for deal in (mt5.history_deals_get(position=int(position.ticket)) or [])
        if int(deal.entry) == int(mt5.DEAL_ENTRY_IN) and finite(deal.volume) > 0
    ]
    deals.sort(key=lambda deal: (int(getattr(deal, "time_msc", 0)), int(deal.ticket)))
    if not deals:
        deals = [position]
    payloads: list[dict[str, Any]] = [{
        "kind": "COMMAND_ACK",
        "commandId": command["commandId"],
        "idempotencyKey": command["idempotencyKey"],
        "status": status,
        "brokerOrderKey": str(getattr(deals[-1], "order", position.ticket)),
        "reason": "Recovered from authoritative MT5 deal/position marker" if status == "ALREADY_APPLIED" else None,
    }]
    cumulative = 0.0
    for deal in deals:
        part = finite(getattr(deal, "volume", position.volume))
        cumulative += part
        ticket = int(getattr(deal, "ticket", position.ticket))
        payloads.append({
            "kind": "FILL",
            "eventId": f"mt5-deal-{ticket}",
            "commandId": command["commandId"],
            "orderPlanId": command["orderPlanId"],
            "brokerOrderKey": str(getattr(deal, "order", position.ticket)),
            "brokerPositionKey": str(position.ticket),
            "volume": part,
            "price": finite(getattr(deal, "price", position.price_open)),
            "cumulativeVolume": cumulative,
            "remainingVolume": max(0, finite(command["volume"]) - cumulative),
            "filledAt": utc_iso(getattr(deal, "time", position.time)),
        })
    return payloads


def protection_payload(command: dict[str, Any], position: Any, attempt: int, verified: bool, reason: str | None = None) -> dict[str, Any]:
    volume = finite(position.volume)
    return {
        "kind": "PROTECTION_ATTEMPT",
        "eventId": f"mt5-protection-{position.ticket}-{volume:.8f}-{attempt}",
        "commandId": command["commandId"],
        "orderPlanId": command["orderPlanId"],
        "brokerPositionKey": str(position.ticket),
        "brokerCommandId": f"mt5-sltp-{position.ticket}-{attempt}",
        "idempotencyKey": f"order-plan:{command['orderPlanId']}:protect:{position.ticket}:{volume:.8f}",
        "attempt": attempt,
        "protectedVolume": volume,
        "requestedStop": finite(command["initialStop"]),
        "actualStop": finite(position.sl) if finite(position.sl) > 0 else None,
        "status": "VERIFIED" if verified else "REJECTED",
        "reason": reason,
        "occurredAt": utc_iso(),
    }


def ensure_initial_protection(command: dict[str, Any], position: Any, magic: int, payloads: list[dict[str, Any]]) -> None:
    stop = finite(command["initialStop"])
    info = mt5.symbol_info(position.symbol)
    tick_size = finite(info.trade_tick_size, finite(info.point))
    if finite(position.sl) > 0 and abs(finite(position.sl) - stop) <= tick_size / 2 + 1e-10:
        payloads.append(protection_payload(command, position, 1, True))
        return
    for attempt in (1, 2):
        current = broker_position(str(position.ticket))
        ok, reason = modify_stop(current, stop, magic) if current is not None else (False, "Position disappeared")
        refreshed = broker_position(str(position.ticket))
        payloads.append(protection_payload(command, refreshed or position, attempt, ok, reason))
        if ok:
            return
    current = broker_position(str(position.ticket))
    ok, closed, reason = close_position(current, finite(current.volume), magic, f"{marker(command['idempotencyKey'])}:flatten") if current is not None else (True, finite(position.volume), None)
    payloads.append({
        "kind": "FLATTEN_RESULT",
        "eventId": f"mt5-flatten-{position.ticket}",
        "commandId": command["commandId"],
        "orderPlanId": command["orderPlanId"],
        "brokerPositionKey": str(position.ticket),
        "brokerCommandId": f"mt5-flatten-{position.ticket}",
        "idempotencyKey": f"order-plan:{command['orderPlanId']}:flatten:{position.ticket}",
        "targetVolume": finite(position.volume),
        "status": "VERIFIED" if ok else "REJECTED",
        "closedVolume": closed,
        "reason": reason or "Bounded initial protection failed; demo exposure flattened",
        "occurredAt": utc_iso(),
    })


def perform_execution(command: dict[str, Any], magic: int) -> list[dict[str, Any]]:
    if command.get("commandType") != "CREATE_ORDER" or command.get("brokerPositionKey") is not None:
        return execution_rejection(command, "Real connector supports only frozen M10 CREATE_ORDER market entries")
    direction = command.get("direction")
    symbol = str(command.get("brokerSymbol", ""))
    volume = finite(command.get("volume"))
    stop = finite(command.get("initialStop"))
    info = mt5.symbol_info(symbol)
    tick = mt5.symbol_info_tick(symbol)
    if direction not in {"LONG", "SHORT"} or info is None or tick is None:
        return execution_rejection(command, "Direction, symbol, or quote unavailable")
    if volume < finite(info.volume_min) or volume > finite(info.volume_max) or not volume_aligned(volume, finite(info.volume_step)):
        return execution_rejection(command, "Broker volume is outside min/max/step constraints")
    spread = (finite(tick.ask) - finite(tick.bid)) / finite(next(item["pipSize"] for item in ACTIVE_MAPPINGS.values() if item["brokerSymbol"] == symbol))
    if spread > finite(command.get("maxSpreadPips")):
        return execution_rejection(command, "Current MT5 spread exceeds immutable OrderPlan limit")
    if not stop_valid(info, tick, direction, stop):
        return execution_rejection(command, "Initial stop violates MT5 side, stop-level, or freeze-level constraints")
    comment = marker(command["idempotencyKey"])
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": volume,
        "type": mt5.ORDER_TYPE_BUY if direction == "LONG" else mt5.ORDER_TYPE_SELL,
        "price": finite(tick.ask if direction == "LONG" else tick.bid),
        "sl": round(stop, int(info.digits)),
        "tp": 0.0,
        "deviation": 20,
        "magic": magic,
        "comment": comment,
        "type_time": mt5.ORDER_TIME_GTC,
    }
    try:
        request = fill_mode(request)
    except BridgeError as error:
        return execution_rejection(command, str(error))
    sent = mt5.order_send(request)
    if sent is None or not accepted_retcode(int(sent.retcode)):
        return execution_rejection(command, f"MT5 rejected order: {getattr(sent, 'comment', mt5.last_error())}")
    time.sleep(0.3)
    position = find_marker_position(symbol, comment, magic)
    if position is None:
        order = find_marker_order(symbol, comment, magic)
        detail = f"working order {order.ticket}" if order is not None else f"broker result {sent.order}"
        raise BridgeError(f"MT5 accepted the command but exposure is not yet verifiable ({detail}); keep PREPARED and reconcile")
    payloads = execution_fill_payloads(command, position, "ACCEPTED")
    ensure_initial_protection(command, position, magic, payloads)
    return payloads


def management_ack(command: dict[str, Any], position: Any | None, closed: float, status: str, reason: str | None) -> list[dict[str, Any]]:
    return [{
        "kind": "MANAGEMENT_ACK",
        "eventId": str(uuid.uuid4()),
        "commandId": command["commandId"],
        "protectionRequestId": command["protectionRequestId"],
        "idempotencyKey": command["idempotencyKey"],
        "brokerEffectId": f"mt5:{command['idempotencyKey']}",
        "brokerPositionKey": command["brokerPositionKey"],
        "sequence": int(command["sequence"]),
        "status": status,
        "actualVolume": finite(position.volume) if position is not None else 0,
        "actualStop": finite(position.sl) if position is not None and finite(position.sl) > 0 else None,
        "actualTakeProfit": finite(position.tp) if position is not None and finite(position.tp) > 0 else None,
        "closedVolume": closed,
        "reason": reason,
        "occurredAt": utc_iso(),
    }]


def perform_management(command: dict[str, Any], magic: int) -> list[dict[str, Any]]:
    position = broker_position(str(command["brokerPositionKey"]))
    if position is None:
        return management_rejection(command, "Broker position does not exist")
    if int(position.magic) != magic or not str(position.comment or "").startswith("ARISE:"):
        return management_rejection(command, "Manual/external MT5 position is outside ARISE automated ownership")
    if position.symbol != command["brokerSymbol"]:
        return management_rejection(command, "Broker symbol mismatch")
    direction = "LONG" if int(position.type) == int(mt5.POSITION_TYPE_BUY) else "SHORT"
    if direction != command["direction"] or abs(finite(position.volume) - finite(command["expectedBrokerVolume"])) > 1e-7:
        return management_rejection(command, "Broker direction/quantity conflicts with the command; reconciliation required")
    info = mt5.symbol_info(position.symbol)
    tick = mt5.symbol_info_tick(position.symbol)
    if info is None or tick is None:
        return management_rejection(command, "Broker symbol/quote unavailable")
    command_type = command["commandType"]
    if command_type == "MOVE_STOP":
        stop = finite(command["requestedStop"])
        current_stop = finite(position.sl) if finite(position.sl) > 0 else None
        if not stop_valid(info, tick, direction, stop, current_stop):
            return management_rejection(command, "Invalid or worsening protected stop rejected before order_send")
        ok, reason = modify_stop(position, round(stop, int(info.digits)), magic)
        refreshed = broker_position(str(position.ticket))
        return management_ack(command, refreshed, 0, "VERIFIED" if ok else "REJECTED", reason)
    if command_type in {"SET_TP", "REMOVE_TP"}:
        requested = 0.0 if command_type == "REMOVE_TP" else finite(command["requestedTakeProfit"])
        executable = finite(tick.ask if direction == "LONG" else tick.bid)
        minimum = max(int(info.trade_stops_level), int(info.trade_freeze_level)) * finite(info.point)
        if command_type == "SET_TP" and ((direction == "LONG" and requested <= executable) or (direction == "SHORT" and requested >= executable) or abs(requested - executable) + 1e-12 < minimum):
            return management_rejection(command, "Take-profit violates MT5 side, stop-level, or freeze-level constraints")
        request = {"action": mt5.TRADE_ACTION_SLTP, "position": int(position.ticket), "symbol": position.symbol, "sl": finite(position.sl), "tp": round(requested, int(info.digits)), "magic": magic}
        checked = mt5.order_check(request)
        sent = mt5.order_send(request) if checked is not None and int(checked.retcode) == 0 else None
        time.sleep(0.2)
        refreshed = broker_position(str(position.ticket))
        actual = finite(refreshed.tp) if refreshed is not None else 0
        ok = sent is not None and accepted_retcode(int(sent.retcode)) and (abs(actual - requested) <= finite(info.trade_tick_size, info.point) / 2 + 1e-10)
        reason = None if ok else f"MT5 TP modification rejected: {getattr(sent or checked, 'comment', mt5.last_error())}"
        return management_ack(command, refreshed, 0, "VERIFIED" if ok else "REJECTED", reason)
    if command_type not in {"PARTIAL_CLOSE", "FULL_CLOSE"}:
        return management_rejection(command, "Unsupported frozen M11 management command")
    requested = finite(command["requestedCloseVolume"])
    if requested <= 0 or requested > finite(position.volume) + 1e-7 or not volume_aligned(requested, finite(info.volume_step)):
        return management_rejection(command, "Close volume violates broker quantity/step constraints")
    remaining = finite(position.volume) - requested
    if command_type == "PARTIAL_CLOSE" and (requested >= finite(position.volume) or (remaining > 1e-7 and remaining < finite(info.volume_min))):
        return management_rejection(command, "Partial close would leave an invalid broker quantity")
    ok, closed, reason = close_position(position, requested, magic, marker(command["idempotencyKey"]))
    refreshed = broker_position(str(position.ticket))
    expected_remaining = max(0, finite(position.volume) - requested)
    actual_remaining = finite(refreshed.volume) if refreshed is not None else 0
    verified = ok and abs(actual_remaining - expected_remaining) <= 1e-7
    return management_ack(command, refreshed, closed, "VERIFIED" if verified else "REJECTED", reason if not verified else None)


def reconcile_prepared(operation: str, command: dict[str, Any], magic: int) -> list[dict[str, Any]] | None:
    if operation == "execute":
        broker_marker = marker(command["idempotencyKey"])
        position = find_marker_position(command["brokerSymbol"], broker_marker, magic)
        if position is not None:
            payloads = execution_fill_payloads(command, position, "ALREADY_APPLIED")
            ensure_initial_protection(command, position, magic, payloads)
            return payloads
        order = find_marker_order(command["brokerSymbol"], broker_marker, magic)
        if order is not None:
            raise BridgeError(f"Prepared broker effect is still a working order ({order.ticket}); resend blocked pending reconciliation")
        historical_orders, historical_deals = find_marker_history(command, broker_marker, magic)
        if historical_orders or historical_deals:
            return historical_execution_payloads(command, historical_orders, historical_deals)
        return None
    position = broker_position(str(command["brokerPositionKey"]))
    kind = command["commandType"]
    if kind == "FULL_CLOSE" and position is None:
        return management_ack(command, None, finite(command["expectedBrokerVolume"]), "ALREADY_APPLIED", "Recovered full close from broker truth")
    if position is None:
        raise BridgeError("Prepared management effect cannot be reconciled because the broker position disappeared")
    if kind == "MOVE_STOP" and abs(finite(position.sl) - finite(command["requestedStop"])) <= finite(mt5.symbol_info(position.symbol).trade_tick_size, 1e-8):
        return management_ack(command, position, 0, "ALREADY_APPLIED", "Recovered stop modification from broker truth")
    if kind == "SET_TP" and abs(finite(position.tp) - finite(command["requestedTakeProfit"])) <= finite(mt5.symbol_info(position.symbol).trade_tick_size, 1e-8):
        return management_ack(command, position, 0, "ALREADY_APPLIED", "Recovered TP modification from broker truth")
    if kind == "REMOVE_TP" and finite(position.tp) == 0:
        return management_ack(command, position, 0, "ALREADY_APPLIED", "Recovered TP removal from broker truth")
    expected_after = finite(command["expectedBrokerVolume"]) - finite(command.get("requestedCloseVolume"))
    if kind in {"PARTIAL_CLOSE", "FULL_CLOSE"} and finite(position.volume) <= expected_after + 1e-7:
        closed = max(0, finite(command["expectedBrokerVolume"]) - finite(position.volume))
        return management_ack(command, position, closed, "ALREADY_APPLIED", "Recovered close from broker truth")
    if abs(finite(position.volume) - finite(command["expectedBrokerVolume"])) > 1e-7:
        raise BridgeError("Prepared close conflicts with current broker quantity; manual reconciliation required")
    return None


def idempotent_apply(request: dict[str, Any], terminal: Any, account: Any) -> list[dict[str, Any]]:
    operation = str(request["operation"])
    command = request.get("command")
    if not isinstance(command, dict):
        raise BridgeError("Mutation command is required")
    require_demo(terminal, account, str(command.get("accountKey", "")))
    ledger_value = str(request.get("ledgerPath", "")).strip()
    if not ledger_value:
        raise BridgeError("Durable ledgerPath is required")
    ledger_path = Path(ledger_value)
    ledger = load_ledger(ledger_path)
    key = str(command.get("idempotencyKey", ""))
    fingerprint = command_fingerprint(operation, command)
    prior = ledger["commands"].get(key)
    rejection = execution_rejection if operation == "execute" else management_rejection
    if prior is not None:
        if prior.get("fingerprint") != fingerprint:
            return rejection(command, "Idempotency identity reused with a conflicting broker effect")
        if prior.get("state") == "APPLIED":
            return replay_payloads(prior["payloads"])
        recovered = reconcile_prepared(operation, command, int(request.get("magic", 260912)))
        if recovered is not None:
            prior.update({"state": "APPLIED", "payloads": recovered, "completedAt": utc_iso()})
            save_ledger(ledger_path, ledger)
            return recovered
        raise BridgeError(
            "Prepared broker effect remains uncertain after broker reconciliation; "
            "automatic resend is blocked to prevent duplicate or conflicting effects"
        )
    else:
        ledger["commands"][key] = {
            "operation": operation,
            "fingerprint": fingerprint,
            "state": "PREPARED",
            "preparedAt": utc_iso(),
        }
        save_ledger(ledger_path, ledger)
    payloads = perform_execution(command, int(request.get("magic", 260912))) if operation == "execute" else perform_management(command, int(request.get("magic", 260912)))
    ledger["commands"][key].update({"state": "APPLIED", "payloads": payloads, "completedAt": utc_iso()})
    save_ledger(ledger_path, ledger)
    return payloads


ACTIVE_MAPPINGS: dict[str, dict[str, Any]] = {}


def main() -> int:
    global ACTIVE_MAPPINGS
    request = json.loads(sys.stdin.read())
    terminal = account = None
    try:
        terminal, account = initialize_terminal(request)
        ACTIVE_MAPPINGS = mapping_by_broker(request)
        operation = request.get("operation")
        if operation == "snapshot":
            response = {
                "ok": True,
                "snapshot": make_snapshot(request, terminal, account),
                "terminalMetadata": {
                    "build": int(terminal.build),
                    "company": str(terminal.company),
                    "connected": bool(terminal.connected),
                    "tradeAllowed": bool(terminal.trade_allowed),
                    "externalApiDisabled": bool(getattr(terminal, "tradeapi_disabled", False)),
                    "accountTradeAllowed": bool(account.trade_allowed),
                    "accountTradeExpert": bool(account.trade_expert),
                    "accountTradeMode": "DEMO" if int(account.trade_mode) == int(mt5.ACCOUNT_TRADE_MODE_DEMO) else "CONTEST" if int(account.trade_mode) == int(mt5.ACCOUNT_TRADE_MODE_CONTEST) else "REAL",
                    "server": str(account.server),
                },
            }
        elif operation in {"execute", "manage"}:
            response = {"ok": True, "payloads": idempotent_apply(request, terminal, account)}
        else:
            raise BridgeError("Unsupported MT5 bridge operation")
        sys.stdout.write(json.dumps(response, separators=(",", ":")))
        return 0
    except Exception as error:
        sys.stdout.write(json.dumps({"ok": False, "error": str(error)}, separators=(",", ":")))
        return 1
    finally:
        if terminal is not None:
            mt5.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
