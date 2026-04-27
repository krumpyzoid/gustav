import { useEffect, useRef, useState } from 'react';
import { DefaultTabsList } from './DefaultTabsList';
import type { TabConfig } from '../../../main/domain/tab-config';

const SAVE_DEBOUNCE_MS = 300;

export function DefaultTabsSettings() {
  const [tabs, setTabs] = useState<TabConfig[] | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    window.api.getPreferences().then((prefs) => {
      setTabs(prefs.defaultTabs ?? []);
    });
  }, []);

  function handleChange(next: TabConfig[]) {
    setTabs(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      window.api.setDefaultTabs(next);
    }, SAVE_DEBOUNCE_MS);
  }

  if (tabs === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground mb-2">Default Tabs</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Tabs that open with every new session. <span className="font-medium">Applies to</span>{' '}
        controls which session types receive the tab — Standalone for workspace sessions,
        Repository for directory and worktree sessions, Both for everything.
      </p>

      <DefaultTabsList tabs={tabs} onChange={handleChange} />
    </div>
  );
}
