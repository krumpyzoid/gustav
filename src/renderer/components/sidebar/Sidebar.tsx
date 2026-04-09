import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useAppStore, refreshState } from '../../hooks/use-app-state';
import { groupByCategory } from '../../lib/group-by-category';
import { RepoGroup } from './RepoGroup';
import { SessionEntry } from './SessionEntry';
import { AccordionCategory } from './AccordionCategory';
import { ActionBar } from './ActionBar';
import type { SessionEntry as SessionEntryType } from '../../../main/domain/types';

interface Props {
  onNewWorktree: (repo: string, repoRoot: string) => void;
  onRemoveWorktree: (entry: SessionEntryType) => void;
  onNewSession: () => void;
  onClean: () => void;
}

export function Sidebar({ onNewWorktree, onRemoveWorktree, onNewSession, onClean }: Props) {
  const { entries, repos } = useAppStore();

  const categories = useMemo(() => groupByCategory(entries, repos), [entries, repos]);

  async function handlePin() {
    await window.api.pinProjects();
    refreshState();
  }

  const standaloneCount = categories.standalone.length;
  const activeRepos = [...categories.active.entries()].sort(([a], [b]) => a.localeCompare(b));
  const idleRepos = categories.idle;

  return (
    <>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="text-sm font-bold tracking-wider uppercase text-foreground/60">Projects</span>
        <button
          onClick={handlePin}
          className="bg-transparent border-none text-foreground/60 hover:text-foreground cursor-pointer p-0.5 transition-colors"
          title="Pin a project"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {standaloneCount > 0 && (
          <AccordionCategory label="Standalone" count={standaloneCount}>
            {categories.standalone.map((entry) => (
              <div key={entry.tmuxSession ?? `orphan-${entry.branch}`} className="group/entry">
                <SessionEntry entry={entry} />
              </div>
            ))}
          </AccordionCategory>
        )}

        {activeRepos.length > 0 && (
          <AccordionCategory label="Active" count={activeRepos.length}>
            {activeRepos.map(([repo, repoEntries]) => (
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
          </AccordionCategory>
        )}

        {idleRepos.length > 0 && (
          <AccordionCategory label="Idle" count={idleRepos.length} defaultExpanded={false}>
            {idleRepos.map((repo) => {
              const repoEntries = entries.filter((e) => e.repo === repo);
              return (
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
              );
            })}
          </AccordionCategory>
        )}
      </div>

      <ActionBar onNewSession={onNewSession} onClean={onClean} />
    </>
  );
}
