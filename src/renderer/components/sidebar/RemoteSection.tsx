import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useAppStore } from '../../hooks/use-app-state';
import { WorkspaceAccordion } from './WorkspaceAccordion';
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

export function RemoteSection() {
  const { remoteState, remoteConnectionStatus } = useAppStore();

  if (remoteConnectionStatus === 'disconnected' && !remoteState) {
    return null;
  }

  return (
    <div className="mt-2 pt-2 border-t border-border/50">
      <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground">
        <StatusBadge status={remoteConnectionStatus} />
        <span className="font-medium uppercase tracking-wide">Remote</span>
        <span className="ml-auto">{statusLabel(remoteConnectionStatus)}</span>
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
            />
          )}

          {/* Named workspaces */}
          {remoteState.workspaces.map((ws) => (
            <WorkspaceAccordion
              key={ws.workspace?.id ?? 'default'}
              state={ws}
              isRemote
            />
          ))}
        </div>
      )}
    </div>
  );
}
