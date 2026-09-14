export type WorkspaceId =
  | 'overview'
  | 'ideas'
  | 'knowledge'
  | 'trading'
  | 'positions'
  | 'strategy'
  | 'database'
  | 'review'
  | 'analytics'
  | 'system-health'
  | 'settings';

export type NavGroup = 'PRIMARY' | 'PLAN' | 'EXECUTE' | 'BUILD' | 'STUDY' | 'UTILITY';

export interface WorkspaceDefinition {
  readonly id: WorkspaceId;
  readonly label: string;
  readonly group: NavGroup;
  readonly description: string;
  readonly closeable: boolean;
}

export interface WorkspaceTab {
  readonly id: WorkspaceId;
  readonly label: string;
  readonly closeable: boolean;
}

export const WORKSPACES: readonly WorkspaceDefinition[] = Object.freeze([
  { id: 'overview', label: 'Overview', group: 'PRIMARY', description: 'Operational command center', closeable: false },
  { id: 'ideas', label: 'Ideas', group: 'PLAN', description: 'Thesis and Colony planning', closeable: true },
  { id: 'knowledge', label: 'Knowledge', group: 'PLAN', description: 'Research, notes and playbooks', closeable: true },
  { id: 'trading', label: 'Trading', group: 'EXECUTE', description: 'Live market workspace', closeable: true },
  { id: 'positions', label: 'Positions', group: 'EXECUTE', description: 'Scout-to-runner position board', closeable: true },
  { id: 'strategy', label: 'Strategy', group: 'BUILD', description: 'Strategy Encyclopedia and Graph', closeable: true },
  { id: 'database', label: 'Database', group: 'STUDY', description: 'Canonical history browser', closeable: true },
  { id: 'review', label: 'Review', group: 'STUDY', description: 'Review Lab and lessons', closeable: true },
  { id: 'analytics', label: 'Analytics', group: 'STUDY', description: 'Pip-first performance research', closeable: true },
  { id: 'system-health', label: 'System Health', group: 'UTILITY', description: 'Runtime and integration health', closeable: true },
  { id: 'settings', label: 'Settings', group: 'UTILITY', description: 'Appearance and operating preferences', closeable: true },
] as const);

export const DEFAULT_TABS: readonly WorkspaceTab[] = Object.freeze([
  { id: 'overview', label: 'Overview', closeable: false },
]);

export function getWorkspace(id: WorkspaceId): WorkspaceDefinition {
  const workspace = WORKSPACES.find((entry) => entry.id === id);
  if (!workspace) throw new Error(`Unknown workspace: ${id}`);
  return workspace;
}

export function openWorkspace(
  tabs: readonly WorkspaceTab[],
  id: WorkspaceId,
): readonly WorkspaceTab[] {
  if (tabs.some((tab) => tab.id === id)) return tabs;
  const workspace = getWorkspace(id);
  return Object.freeze([
    ...tabs,
    Object.freeze({ id: workspace.id, label: workspace.label, closeable: workspace.closeable }),
  ]);
}

export function closeWorkspace(
  tabs: readonly WorkspaceTab[],
  id: WorkspaceId,
  activeId: WorkspaceId,
): { readonly tabs: readonly WorkspaceTab[]; readonly activeId: WorkspaceId } {
  const tab = tabs.find((entry) => entry.id === id);
  if (!tab || !tab.closeable) return { tabs, activeId };

  const index = tabs.findIndex((entry) => entry.id === id);
  const nextTabs = Object.freeze(tabs.filter((entry) => entry.id !== id));
  if (activeId !== id) return { tabs: nextTabs, activeId };

  const fallback = nextTabs[Math.min(index, nextTabs.length - 1)] ?? DEFAULT_TABS[0];
  return { tabs: nextTabs, activeId: fallback?.id ?? 'overview' };
}

export function isWorkspaceId(value: string): value is WorkspaceId {
  return WORKSPACES.some((workspace) => workspace.id === value);
}

export function restoreWorkspaceTabs(raw: string | null): readonly WorkspaceTab[] {
  if (!raw) return DEFAULT_TABS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_TABS;
    const restored: WorkspaceTab[] = [];
    for (const value of parsed) {
      if (typeof value !== 'string' || !isWorkspaceId(value)) continue;
      const workspace = getWorkspace(value);
      if (!restored.some((tab) => tab.id === workspace.id)) {
        restored.push({ id: workspace.id, label: workspace.label, closeable: workspace.closeable });
      }
    }
    if (!restored.some((tab) => tab.id === 'overview')) {
      restored.unshift({ id: 'overview', label: 'Overview', closeable: false });
    }
    return Object.freeze(restored);
  } catch {
    return DEFAULT_TABS;
  }
}

export const COMMANDS = Object.freeze(
  WORKSPACES.map((workspace) => Object.freeze({
    id: `go-${workspace.id}`,
    label: `Go to ${workspace.label}`,
    hint: workspace.description,
    workspaceId: workspace.id,
  })),
);
