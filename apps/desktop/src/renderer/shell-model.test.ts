import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TABS,
  closeWorkspace,
  openWorkspace,
  restoreWorkspaceTabs,
} from './shell-model';

describe('workspace shell model', () => {
  it('opens a workspace once and preserves existing tab order', () => {
    const withIdeas = openWorkspace(DEFAULT_TABS, 'ideas');
    expect(withIdeas.map((tab) => tab.id)).toEqual(['overview', 'ideas']);
    expect(openWorkspace(withIdeas, 'ideas')).toBe(withIdeas);
  });

  it('never closes the non-closeable Overview workspace', () => {
    const result = closeWorkspace(DEFAULT_TABS, 'overview', 'overview');
    expect(result.tabs).toBe(DEFAULT_TABS);
    expect(result.activeId).toBe('overview');
  });

  it('moves focus to a neighboring tab when the active workspace closes', () => {
    const tabs = openWorkspace(openWorkspace(DEFAULT_TABS, 'ideas'), 'trading');
    const result = closeWorkspace(tabs, 'ideas', 'ideas');
    expect(result.tabs.map((tab) => tab.id)).toEqual(['overview', 'trading']);
    expect(result.activeId).toBe('trading');
  });

  it('restores only canonical workspaces and always restores Overview', () => {
    const restored = restoreWorkspaceTabs(JSON.stringify(['trading', 'bogus', 'trading']));
    expect(restored.map((tab) => tab.id)).toEqual(['overview', 'trading']);
  });

  it('falls back safely when persisted state is malformed', () => {
    expect(restoreWorkspaceTabs('{not-json')).toBe(DEFAULT_TABS);
  });
});
