import type { ClaudeStatus } from '../../../main/domain/types';

const statusColors: Record<ClaudeStatus, string> = {
  new: 'bg-fg/20',
  busy: 'bg-c3',
  action: 'bg-c1',
  done: 'bg-c2',
  none: 'bg-c0',
};

export function StatusDot({ status }: { status: ClaudeStatus }) {
  return <div className={`w-2 h-2 rounded-full shrink-0 ${statusColors[status]}`} />;
}
