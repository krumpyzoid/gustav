import { Wifi, WifiOff, Loader2, Plus } from 'lucide-react';
import { useAppStore } from '../../hooks/use-app-state';
import { WorkspaceAccordion } from './WorkspaceAccordion';
import type { SessionTab as SessionTabType } from '../../../main/domain/types';
import type { RemoteConnectionStatus } from '../../hooks/use-app-state';

function StatusBadge({ status }: { status: RemoteConnectionStatus }) {
  switch (status) {
    case 'connected':
      return <Wifi size={12} className="text-c2" />;
    case 'connecting':
    case 'reconnecting':
      return <Loader2 size={12} className="text-c3 animate-spin" />;
    case 'disconnected':
      return <WifiOff size={12} className="text-muted-foreground" />;
  }
}

function statusLabel(status: RemoteConnectionStatus): string {
  switch (status) {
    case 'connected': return 'Connected';
    case 'connecting': return 'Connecting...';
    case 'reconnecting': return 'Reconnecting...';
    case 'disconnected': return 'Disconnected';
  }
}

interface Props {
  /** Called with `(workspaceName, workspaceDir)` when the user picks
   * "Create new session" inside a remote workspace's "+" dropdown. */
  onNewSession?: (workspaceName: string, workspaceDir: string) => void;
  /** Called with `(label, dir)` when the user wants to add a remote
   * standalone session. */
  onNewStandalone?: () => void;
  /** Called when the user opens the worktree dialog from a remote repo. */
  onAddWorktree?: (repoName: string, repoRoot: string, workspaceName: string) => void;
  /** Called when the user removes a worktree session in the remote tree. */
  onRemoveWorktree?: (tab: SessionTabType, repoRoot: string) => void;
}

export function RemoteSection({ onNewSession, onNewStandalone, onAddWorktree, onRemoveWorktree }: Props = {}) {
  const { remoteState, remoteConnectionStatus } = useAppStore();

  if (remoteConnectionStatus === 'disconnected' && !remoteState) {
    return null;
  }

  return (
    <div className="mt-2 pt-2 border-t border-border/50">
      <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground">
        <StatusBadge status={remoteConnectionStatus} />
        <span className="font-medium uppercase tracking-wide">Remote</span>
        <span className="ml-auto flex items-center gap-1">
          {statusLabel(remoteConnectionStatus)}
          {remoteConnectionStatus === 'connected' && onNewStandalone && (
            <button
              onClick={onNewStandalone}
              className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer ml-1"
              title="New remote standalone session"
            >
              <Plus size={12} />
            </button>
          )}
        </span>
      </div>

      {remoteConnectionStatus !== 'connected' && remoteConnectionStatus !== 'disconnected' && (
        <div className="px-3 py-2 text-xs text-muted-foreground italic">
          {statusLabel(remoteConnectionStatus)}
        </div>
      )}

      {remoteState && remoteConnectionStatus === 'connected' && (
        <div className="mt-1">
          {/* Default workspace sessions */}
          {remoteState.defaultWorkspace.sessions.length > 0 && (
            <WorkspaceAccordion
              state={remoteState.defaultWorkspace}
              isRemote
              onRemoveWorktree={onRemoveWorktree}
            />
          )}

          {/* Named workspaces */}
          {remoteState.workspaces.map((ws) => (
            <WorkspaceAccordion
              key={ws.workspace?.id ?? 'default'}
              state={ws}
              isRemote
              onAddSession={
                onNewSession && ws.workspace
                  ? () => onNewSession(ws.workspace!.name, ws.workspace!.directory)
                  : undefined
              }
              onAddWorktree={onAddWorktree}
              onRemoveWorktree={onRemoveWorktree}
            />
          ))}
        </div>
      )}
    </div>
  );
}
