import { useState } from 'react';
import { ExternalLink, Play, Square } from 'lucide-react';
import { useAppStore, type ForwardedPort } from '../../hooks/use-app-state';

type DetectedPort = {
  port: number;
  session?: string;
  source: 'output' | 'ss';
};

export function PortsPanel({ detectedPorts }: { detectedPorts: DetectedPort[] }) {
  const { forwardedPorts, setForwardedPorts } = useAppStore();
  const [customPort, setCustomPort] = useState<Record<number, string>>({});

  async function handleForward(remotePort: number) {
    const localPort = parseInt(customPort[remotePort] || String(remotePort), 10);
    if (!localPort || localPort < 1 || localPort > 65535) return;

    const result = await window.api.forwardPort(remotePort, localPort);
    if (result.success) {
      const updated = [...forwardedPorts, { remotePort, localPort, channelId: remotePort }];
      setForwardedPorts(updated);
    }
  }

  async function handleStop(remotePort: number) {
    const entry = forwardedPorts.find((p) => p.remotePort === remotePort);
    if (!entry) return;

    await window.api.stopForward(entry.channelId);
    setForwardedPorts(forwardedPorts.filter((p) => p.remotePort !== remotePort));
  }

  function isForwarded(port: number): ForwardedPort | undefined {
    return forwardedPorts.find((p) => p.remotePort === port);
  }

  if (detectedPorts.length === 0 && forwardedPorts.length === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-border/50">
      <div className="px-3 py-1 text-xs text-muted-foreground font-medium uppercase tracking-wide">
        Ports
      </div>

      {detectedPorts.map((dp) => {
        const forwarded = isForwarded(dp.port);
        return (
          <div key={dp.port} className="flex items-center gap-2 px-3 py-1 text-xs">
            <span className="font-mono text-foreground">{dp.port}</span>
            <span className="text-muted-foreground">{dp.source}</span>

            {forwarded ? (
              <>
                <span className="text-c2 ml-auto">
                  :{forwarded.localPort}
                </span>
                <button
                  onClick={() => window.open(`http://localhost:${forwarded.localPort}`, '_blank')}
                  className="bg-transparent border-none text-muted-foreground hover:text-foreground cursor-pointer p-0"
                  title="Open in browser"
                >
                  <ExternalLink size={12} />
                </button>
                <button
                  onClick={() => handleStop(dp.port)}
                  className="bg-transparent border-none text-muted-foreground hover:text-destructive cursor-pointer p-0"
                  title="Stop forward"
                >
                  <Square size={12} />
                </button>
              </>
            ) : (
              <>
                <input
                  className="ml-auto w-16 bg-muted text-foreground px-1 py-0.5 rounded text-xs border border-input"
                  placeholder={String(dp.port)}
                  value={customPort[dp.port] || ''}
                  onChange={(e) => setCustomPort((p) => ({ ...p, [dp.port]: e.target.value }))}
                />
                <button
                  onClick={() => handleForward(dp.port)}
                  className="bg-transparent border-none text-muted-foreground hover:text-foreground cursor-pointer p-0"
                  title="Forward port"
                >
                  <Play size={12} />
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
