import type { SessionEntry as SessionEntryType } from '../../../main/domain/types';
import { SessionEntry } from './SessionEntry';
import { refreshState } from '../../hooks/use-app-state';
import { PinOff } from 'lucide-react';

interface Props {
  repo: string;
  entries: SessionEntryType[];
  repoRoot?: string;
  onNewWorktree?: () => void;
  onRemoveWorktree?: (entry: SessionEntryType) => void;
}

export function RepoGroup({ repo, entries, repoRoot, onNewWorktree, onRemoveWorktree }: Props) {
  async function handleUnpin(e: React.MouseEvent) {
    e.stopPropagation();
    await window.api.unpinProject(repo);
    refreshState();
  }

  return (
    <div className="mb-1">
      <div className={`flex items-center justify-between px-3 pt-1.5 pb-0.5
        font-bold tracking-wider uppercase
        ${repo === 'standalone' ? 'text-c5' : 'text-accent'}`}
      >
        {repo}
        {repo !== 'standalone' && (
          <button
            onClick={handleUnpin}
            className="bg-transparent border-none text-c0 hover:text-c1 cursor-pointer px-1 opacity-0 group-hover/repo:opacity-100 transition-opacity"
            title="Unpin project"
          >
            <PinOff size={12} />
          </button>
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
          className="px-3 py-0.5 pl-[26px] opacity-65 hover:opacity-100 cursor-pointer"
        >
          <span className="text-accent text-xs">+ new worktree</span>
        </div>
      )}
    </div>
  );
}
