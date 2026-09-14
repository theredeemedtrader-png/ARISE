from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import mt5_bridge as bridge


def execution_command(**overrides):
    value = {
        "commandId": "command-1",
        "idempotencyKey": "plan:1:create",
        "orderPlanId": "plan-1",
        "commandType": "CREATE_ORDER",
        "accountKey": "account-key",
        "brokerSymbol": "EURUSD.i",
        "direction": "LONG",
        "volume": 0.01,
        "initialStop": 1.09,
        "createdAt": "2026-09-12T12:00:00.000Z",
    }
    value.update(overrides)
    return value


def management_command(**overrides):
    value = {
        "commandId": "management-1",
        "idempotencyKey": "management:1",
        "protectionRequestId": "protection-1",
        "commandType": "PARTIAL_CLOSE",
        "accountKey": "account-key",
        "brokerSymbol": "EURUSD.i",
        "brokerPositionKey": "601",
        "direction": "LONG",
        "expectedBrokerVolume": 0.1,
        "requestedStop": None,
        "requestedTakeProfit": None,
        "requestedCloseVolume": 0.04,
        "sequence": 1,
        "createdAt": "2026-09-12T12:00:00.000Z",
    }
    value.update(overrides)
    return value


class BridgeHardeningTests(unittest.TestCase):
    def demo_context(self):
        terminal = SimpleNamespace(
            connected=True,
            trade_allowed=True,
            tradeapi_disabled=False,
        )
        account = SimpleNamespace(
            trade_mode=bridge.mt5.ACCOUNT_TRADE_MODE_DEMO,
            server="Eightcap-Demo",
            login=123,
            trade_allowed=True,
            trade_expert=True,
            margin_mode=bridge.mt5.ACCOUNT_MARGIN_MODE_RETAIL_HEDGING,
        )
        return terminal, account

    def test_demo_guard_rejects_real_before_ledger_or_send(self):
        terminal, account = self.demo_context()
        account.trade_mode = bridge.mt5.ACCOUNT_TRADE_MODE_REAL
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "ledger.json"
            with self.assertRaisesRegex(bridge.BridgeError, "demo-only"):
                bridge.idempotent_apply(
                    {
                        "operation": "execute",
                        "ledgerPath": str(ledger),
                        "command": execution_command(accountKey=bridge.account_key(account)),
                    },
                    terminal,
                    account,
                )
            self.assertFalse(ledger.exists())

    def test_empty_ledger_path_is_rejected(self):
        terminal, account = self.demo_context()
        command = execution_command(accountKey=bridge.account_key(account))
        with self.assertRaisesRegex(bridge.BridgeError, "ledgerPath"):
            bridge.idempotent_apply(
                {"operation": "execute", "ledgerPath": " ", "command": command},
                terminal,
                account,
            )

    def test_old_broker_tick_is_not_relabelled_as_fresh(self):
        old = int(time.time()) - 3600
        info = SimpleNamespace(
            digits=5,
            trade_tick_size=0.00001,
            point=0.00001,
            trade_contract_size=100000,
            volume_min=0.01,
            volume_step=0.01,
            volume_max=100,
            trade_stops_level=0,
            trade_freeze_level=0,
        )
        tick = SimpleNamespace(bid=1.1, ask=1.1001, time=old, time_msc=old * 1000)
        with (
            patch.object(bridge.mt5, "symbol_select", return_value=True),
            patch.object(bridge.mt5, "symbol_info", return_value=info),
            patch.object(bridge.mt5, "symbol_info_tick", return_value=tick),
        ):
            _, quote = bridge.symbol_snapshot(
                "EURUSD.i",
                {"canonicalSymbol": "EURUSD", "pipSize": 0.0001},
            )
        self.assertEqual(quote["receivedAt"], quote["brokerTime"])
        self.assertLess(
            bridge.datetime.fromisoformat(quote["receivedAt"].replace("Z", "+00:00")).timestamp(),
            time.time() - 3500,
        )

    def test_prepared_working_order_blocks_resend(self):
        terminal, account = self.demo_context()
        command = execution_command(accountKey=bridge.account_key(account))
        working = SimpleNamespace(ticket=901)
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "ledger.json"
            bridge.save_ledger(
                ledger,
                {
                    "version": 1,
                    "commands": {
                        command["idempotencyKey"]: {
                            "operation": "execute",
                            "fingerprint": bridge.command_fingerprint("execute", command),
                            "state": "PREPARED",
                        }
                    },
                },
            )
            with (
                patch.object(bridge, "find_marker_position", return_value=None),
                patch.object(bridge, "find_marker_order", return_value=working),
                patch.object(bridge, "perform_execution", side_effect=AssertionError("must not resend")),
            ):
                with self.assertRaisesRegex(bridge.BridgeError, "resend blocked"):
                    bridge.idempotent_apply(
                        {"operation": "execute", "ledgerPath": str(ledger), "command": command},
                        terminal,
                        account,
                    )
            self.assertEqual(bridge.load_ledger(ledger)["commands"][command["idempotencyKey"]]["state"], "PREPARED")

    def test_prepared_command_without_broker_evidence_fails_closed(self):
        terminal, account = self.demo_context()
        command = execution_command(accountKey=bridge.account_key(account))
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "ledger.json"
            bridge.save_ledger(
                ledger,
                {
                    "version": 1,
                    "commands": {
                        command["idempotencyKey"]: {
                            "operation": "execute",
                            "fingerprint": bridge.command_fingerprint("execute", command),
                            "state": "PREPARED",
                        }
                    },
                },
            )
            with (
                patch.object(bridge, "find_marker_position", return_value=None),
                patch.object(bridge, "find_marker_order", return_value=None),
                patch.object(bridge, "find_marker_history", return_value=([], [])),
                patch.object(bridge, "perform_execution", side_effect=AssertionError("must not resend")),
            ):
                with self.assertRaisesRegex(bridge.BridgeError, "automatic resend is blocked"):
                    bridge.idempotent_apply(
                        {"operation": "execute", "ledgerPath": str(ledger), "command": command},
                        terminal,
                        account,
                    )
            self.assertEqual(bridge.load_ledger(ledger)["commands"][command["idempotencyKey"]]["state"], "PREPARED")

    def test_closed_historical_entry_is_recovered_without_resend(self):
        terminal, account = self.demo_context()
        command = execution_command(accountKey=bridge.account_key(account))
        order = SimpleNamespace(ticket=701, time_setup_msc=1)
        deal = SimpleNamespace(
            ticket=801,
            order=701,
            position_id=601,
            volume=0.01,
            price=1.1002,
            time=1_757_678_400,
            time_msc=1,
        )
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "ledger.json"
            bridge.save_ledger(
                ledger,
                {
                    "version": 1,
                    "commands": {
                        command["idempotencyKey"]: {
                            "operation": "execute",
                            "fingerprint": bridge.command_fingerprint("execute", command),
                            "state": "PREPARED",
                        }
                    },
                },
            )
            with (
                patch.object(bridge, "find_marker_position", return_value=None),
                patch.object(bridge, "find_marker_order", return_value=None),
                patch.object(bridge, "find_marker_history", return_value=([order], [deal])),
                patch.object(bridge, "perform_execution", side_effect=AssertionError("must not resend")),
            ):
                payloads = bridge.idempotent_apply(
                    {"operation": "execute", "ledgerPath": str(ledger), "command": command},
                    terminal,
                    account,
                )
            self.assertEqual([item["kind"] for item in payloads], ["COMMAND_ACK", "FILL", "FLATTEN_RESULT"])
            self.assertEqual(payloads[0]["status"], "ALREADY_APPLIED")
            self.assertEqual(payloads[-1]["status"], "VERIFIED")
            self.assertEqual(bridge.load_ledger(ledger)["commands"][command["idempotencyKey"]]["state"], "APPLIED")

    def test_atomic_ledger_rejects_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "ledger.json"
            bridge.save_ledger(ledger, {"version": 1, "commands": {}})
            self.assertEqual(json.loads(ledger.read_text(encoding="utf-8"))["version"], 1)
            ledger.write_text('{"version":2}', encoding="utf-8")
            with self.assertRaisesRegex(bridge.BridgeError, "corrupt"):
                bridge.load_ledger(ledger)

    def test_ledger_prepare_failure_happens_before_broker_send(self):
        terminal, account = self.demo_context()
        command = execution_command(accountKey=bridge.account_key(account))
        with (
            patch.object(bridge, "save_ledger", side_effect=OSError("disk full")),
            patch.object(bridge, "perform_execution", side_effect=AssertionError("must not send")),
        ):
            with self.assertRaisesRegex(OSError, "disk full"):
                bridge.idempotent_apply(
                    {"operation": "execute", "ledgerPath": "ledger.json", "command": command},
                    terminal,
                    account,
                )

    def test_prepared_partial_fill_recovers_actual_quantity_and_protection(self):
        terminal, account = self.demo_context()
        command = execution_command(accountKey=bridge.account_key(account))
        position = SimpleNamespace(
            ticket=601,
            symbol="EURUSD.i",
            type=bridge.mt5.POSITION_TYPE_BUY,
            volume=0.004,
            price_open=1.1002,
            sl=1.09,
            tp=0,
            time=1_757_678_400,
        )
        deal = SimpleNamespace(
            ticket=801,
            order=701,
            position_id=601,
            entry=bridge.mt5.DEAL_ENTRY_IN,
            volume=0.004,
            price=1.1002,
            time=1_757_678_400,
            time_msc=1,
        )
        info = SimpleNamespace(trade_tick_size=0.00001, point=0.00001)
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "ledger.json"
            bridge.save_ledger(
                ledger,
                {
                    "version": 1,
                    "commands": {
                        command["idempotencyKey"]: {
                            "operation": "execute",
                            "fingerprint": bridge.command_fingerprint("execute", command),
                            "state": "PREPARED",
                        }
                    },
                },
            )
            with (
                patch.object(bridge, "find_marker_position", return_value=position),
                patch.object(bridge.mt5, "history_deals_get", return_value=[deal]),
                patch.object(bridge.mt5, "symbol_info", return_value=info),
                patch.object(bridge, "perform_execution", side_effect=AssertionError("must not resend")),
            ):
                payloads = bridge.idempotent_apply(
                    {"operation": "execute", "ledgerPath": str(ledger), "command": command},
                    terminal,
                    account,
                )
        self.assertEqual(payloads[1]["volume"], 0.004)
        self.assertEqual(payloads[1]["remainingVolume"], 0.006)
        self.assertEqual(payloads[2]["protectedVolume"], 0.004)
        self.assertEqual(payloads[2]["status"], "VERIFIED")
        self.assertEqual(
            payloads[2]["idempotencyKey"],
            "order-plan:plan-1:protect:601:0.00400000",
        )

    def test_initial_protection_failure_uses_canonical_flatten_identity(self):
        command = execution_command()
        position = SimpleNamespace(
            ticket=601,
            symbol="EURUSD.i",
            volume=0.01,
            sl=0,
        )
        info = SimpleNamespace(trade_tick_size=0.00001, point=0.00001)
        payloads = []
        with (
            patch.object(bridge.mt5, "symbol_info", return_value=info),
            patch.object(bridge, "broker_position", return_value=position),
            patch.object(bridge, "modify_stop", return_value=(False, "rejected")),
            patch.object(bridge, "close_position", return_value=(True, 0.01, None)),
        ):
            bridge.ensure_initial_protection(command, position, 260912, payloads)
        self.assertEqual(len(payloads), 3)
        self.assertEqual(
            payloads[-1]["idempotencyKey"],
            "order-plan:plan-1:flatten:601",
        )

    def test_prepared_partial_close_recovers_remaining_broker_quantity(self):
        terminal, account = self.demo_context()
        command = management_command(accountKey=bridge.account_key(account))
        position = SimpleNamespace(ticket=601, volume=0.06, sl=1.09, tp=0)
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "ledger.json"
            bridge.save_ledger(
                ledger,
                {
                    "version": 1,
                    "commands": {
                        command["idempotencyKey"]: {
                            "operation": "manage",
                            "fingerprint": bridge.command_fingerprint("manage", command),
                            "state": "PREPARED",
                        }
                    },
                },
            )
            with (
                patch.object(bridge, "broker_position", return_value=position),
                patch.object(bridge, "perform_management", side_effect=AssertionError("must not resend")),
            ):
                payloads = bridge.idempotent_apply(
                    {"operation": "manage", "ledgerPath": str(ledger), "command": command},
                    terminal,
                    account,
                )
        self.assertEqual(payloads[0]["status"], "ALREADY_APPLIED")
        self.assertAlmostEqual(payloads[0]["actualVolume"], 0.06)
        self.assertAlmostEqual(payloads[0]["closedVolume"], 0.04)

    def test_python_stop_policy_rejects_worsening_in_both_directions(self):
        info = SimpleNamespace(trade_stops_level=0, trade_freeze_level=0, point=0.00001)
        tick = SimpleNamespace(bid=1.11, ask=1.1102)
        self.assertFalse(bridge.stop_valid(info, tick, "LONG", 1.08, 1.09))
        self.assertFalse(bridge.stop_valid(info, tick, "SHORT", 1.13, 1.12))
        self.assertTrue(bridge.stop_valid(info, tick, "LONG", 1.10, 1.09))
        self.assertTrue(bridge.stop_valid(info, tick, "SHORT", 1.115, 1.12))


if __name__ == "__main__":
    unittest.main()
