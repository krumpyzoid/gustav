import type { SessionEntry as SessionEntryType } from '../../../main/domain/types';
import { SessionEntry } from './SessionEntry';
import { refreshState } from '../../hooks/use-app-state';

interface Props {
  repo: string;
  entries: SessionEntryType[];
  repoRoot?: string;
  onNewWorktree?: () => void;
  onRemoveWorktree?: (entry: SessionEntryType) => void;
}

export function RepoGroup({ repo, entries, repoRoot, onNewWorktree, onRemoveWorktree }: Props) {
  const hasActive = entries.some((e) => e.tmuxSession !== null);

  async function handleRemoveRepo(e: React.MouseEvent) {
    e.stopPropagation();
    await window.api.removeRepo(repo);
    refreshState();
  }

  return (
    <div className="mb-1">
      <div className={`flex items-center justify-between px-3 pt-1.5 pb-0.5
        text-[11px] font-bold tracking-wider uppercase
        ${repo === 'standalone' ? 'text-c5' : 'text-accent'}`}
      >
        {repo}
        {repo !== 'standalone' && !hasActive && (
          <button
            onClick={handleRemoveRepo}
            className="bg-transparent border-none text-c0 hover:text-c1 cursor-pointer text-[10px] px-1 opacity-0 group-hover/repo:opacity-100 transition-opacity"
            title="Remove repo from sidebar"
          >✕</button>
        )}
      </div>

      {entries.map((entry) => (
        <div key={entry.tmuxSession ?? `orphan-${entry.branch}`} className="group/entry">
          <SessionEntry
            entry={entry}
            repoRoot={repoRoot}
            onRequestRemove={
              entry.repo !== 'standalone' && !entry.isMainWorktree
                ? () => onRemoveWorktree?.(entry)
                : undefined
            }
          />
        </div>
      ))}

      {repo !== 'standalone' && (
        <div
          onClick={onNewWorktree}
          className="px-3 py-0.5 pl-[26px] opacity-35 hover:opacity-70 cursor-pointer"
        >
          <span className="text-accent text-xs">+ new worktree</span>
        </div>
      )}
    </div>
  );
}
