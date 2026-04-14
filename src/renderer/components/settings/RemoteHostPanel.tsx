import { useState, useEffect, useRef } from 'react';
import { Copy, RefreshCw, Unplug } from 'lucide-react';
import type { HostInfo } from '../../../main/remote/remote.service';

export function RemoteHostPanel() {
  const [enabled, setEnabled] = useState(false);
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [port, setPort] = useState('7777');
  const [error, setError] = useState('');
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  async function refreshHostInfo() {
    const result = await window.api.getHostInfo();
    if (result.success) {
      setHostInfo(result.data);
      setEnabled(result.data.enabled);
    }
  }

  useEffect(() => {
    refreshHostInfo();
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, []);

  // Countdown timer for pairing code expiry
  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (!hostInfo?.pairingExpiresAt) {
      setTimeLeft(null);
      return;
    }
    function tick() {
      const left = Math.max(0, Math.floor((hostInfo!.pairingExpiresAt! - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) {
        if (countdownRef.current) clearInterval(countdownRef.current);
        refreshHostInfo(); // Auto-refresh when expired
      }
    }
    tick();
    countdownRef.current = setInterval(tick, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [hostInfo?.pairingExpiresAt]);

  async function handleEnable() {
    setError('');
    const p = parseInt(port, 10);
    if (!p || p < 1 || p > 65535) {
      setError('Invalid port');
      return;
    }
    const result = await window.api.enableRemote(p);
    if (result.success) {
      setHostInfo(result.data);
      setEnabled(true);
    } else {
      setError(result.error);
    }
  }

  async function handleDisable() {
    await window.api.disableRemote();
    setEnabled(false);
    setHostInfo(null);
  }

  async function handleRegenerate() {
    const result = await window.api.regeneratePairingCode();
    if (result.success) setHostInfo(result.data);
  }

  async function handleDisconnectClient() {
    await window.api.disconnectRemoteClient();
    refreshHostInfo();
  }

  function getConnectionString(): string {
    if (!hostInfo?.pairingCode || !hostInfo.port) return '';
    // Use a placeholder for the IP — the user should replace with their Tailscale IP
    return `<your-ip>:${hostInfo.port}:${hostInfo.pairingCode}`;
  }

  function handleCopy() {
    const str = getConnectionString();
    if (str) navigator.clipboard.writeText(str);
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div>
      <h2 className="text-lg font-bold mb-4">Remote Host</h2>

      {!enabled ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Enable remote access to let another Gustav instance connect to this machine.
          </p>
          <div>
            <label className="block text-sm mb-1 text-muted-foreground">Port</label>
            <input
              className="w-32 bg-muted text-foreground px-3 py-2 rounded-md border border-input text-sm"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            onClick={handleEnable}
            className="w-fit px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md cursor-pointer"
          >
            Enable Remote Access
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {hostInfo?.clientConnected ? (
            <div className="bg-muted rounded-md p-4">
              <p className="text-sm font-medium">Client connected</p>
              {hostInfo.clientAddress && (
                <p className="text-xs text-muted-foreground mt-1">{hostInfo.clientAddress}</p>
              )}
              <button
                onClick={handleDisconnectClient}
                className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-md cursor-pointer"
              >
                <Unplug size={14} />
                Disconnect Client
              </button>
            </div>
          ) : (
            <div className="bg-muted rounded-md p-4">
              <p className="text-sm font-medium mb-3">Share this with the client:</p>

              <div className="flex items-center gap-2 bg-background rounded px-3 py-2 font-mono text-sm">
                <span className="flex-1 select-all">{getConnectionString()}</span>
                <button
                  onClick={handleCopy}
                  className="bg-transparent border-none text-muted-foreground hover:text-foreground cursor-pointer p-1"
                  title="Copy"
                >
                  <Copy size={14} />
                </button>
              </div>

              <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                {timeLeft !== null && (
                  <span>Expires in {formatTime(timeLeft)}</span>
                )}
                <button
                  onClick={handleRegenerate}
                  className="flex items-center gap-1 bg-transparent border-none text-muted-foreground hover:text-foreground cursor-pointer p-0"
                >
                  <RefreshCw size={12} />
                  Regenerate
                </button>
              </div>

              <p className="text-xs text-muted-foreground mt-3">
                Replace &lt;your-ip&gt; with your Tailscale IP (run <code className="bg-background px-1 rounded">tailscale ip</code>).
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Port: {hostInfo?.port}</span>
          </div>

          <button
            onClick={handleDisable}
            className="w-fit px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded-md cursor-pointer"
          >
            Disable Remote Access
          </button>
        </div>
      )}
    </div>
  );
}
