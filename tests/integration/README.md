# Integration Tests

Milestone 0 integration target:

1. open an in-memory SQLite database,
2. construct a domain Idea,
3. persist through `IdeaRepository`,
4. read it back,
5. verify domain identity and LONG/SHORT terminology.

Database package tests currently exercise this path directly.

Later milestones add:
- typed IPC integration
- fake MT5 Agent
- broker failure injection
- restart/reconciliation
- evidence capture
