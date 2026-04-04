import { useMemo } from 'react';
import { useAppStore } from '../../hooks/use-app-state';
import { RepoGroup } from './RepoGroup';
import { ActionBar } from './ActionBar';
import type { SessionEntry as SessionEntryType } from '../../../main/domain/types';

function sortEntries(entries: SessionEntryType[]): SessionEntryType[] {
  return [...entries].sort((a, b) => {
    if (a.repo === 'standalone' && b.repo !== 'standalone') return 1;
    if (a.repo !== 'standalone' && b.repo === 'standalone') return -1;
    if (a.repo !== b.repo) return a.repo.localeCompare(b.repo);
    if (a.isMainWorktree && !b.isMainWorktree) return -1;
    if (!a.isMainWorktree && b.isMainWorktree) return 1;
    return a.branch.localeCompare(b.branch);
  });
}

interface Props {
  onNewWorktree: (repo: string, repoRoot: string) => void;
  onRemoveWorktree: (entry: SessionEntryType) => void;
  onNewSession: () => void;
  onClean: () => void;
}

export function Sidebar({ onNewWorktree, onRemoveWorktree, onNewSession, onClean }: Props) {
  const { entries, repos } = useAppStore();

  const groups = useMemo(() => {
    const sorted = sortEntries(entries);
    const map = new Map<string, SessionEntryType[]>();
    for (const entry of sorted) {
      const group = map.get(entry.repo) ?? [];
      group.push(entry);
      map.set(entry.repo, group);
    }
    return map;
  }, [entries]);

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        {[...groups.entries()].map(([repo, repoEntries]) => (
          <div key={repo} className="group/repo">
            <RepoGroup
              repo={repo}
              entries={repoEntries}
              repoRoot={repos.get(repo)}
              onNewWorktree={() => {
                const root = repos.get(repo);
                if (root) onNewWorktree(repo, root);
              }}
              onRemoveWorktree={onRemoveWorktree}
            />
          </div>
        ))}
      </div>
      <ActionBar onNewSession={onNewSession} onClean={onClean} />
    </>
  );
}
