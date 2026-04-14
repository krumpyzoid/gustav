import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAppStore } from '../../hooks/use-app-state';

interface Props {
  open: boolean;
  onClose: () => void;
}

function parseConnectionString(input: string): { host: string; port: string; code: string } | null {
  // Format: host:port:CODE or host:port CODE
  const trimmed = input.trim();
  const parts = trimmed.split(/[:\s]+/);
  if (parts.length >= 3) {
    const code = parts[parts.length - 1]!;
    const port = parts[parts.length - 2]!;
    const host = parts.slice(0, parts.length - 2).join(':');
    if (/^\d+$/.test(port) && /^[A-Z0-9]{6}$/.test(code)) {
      return { host, port, code };
    }
  }
  return null;
}

export function ConnectRemoteDialog({ open, onClose }: Props) {
  const [connectionString, setConnectionString] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('7777');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const { remoteConnectionStatus } = useAppStore();

  function handlePaste(value: string) {
    setConnectionString(value);
    const parsed = parseConnectionString(value);
    if (parsed) {
      setHost(parsed.host);
      setPort(parsed.port);
      setCode(parsed.code);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const h = host.trim();
    const p = parseInt(port.trim(), 10);
    const c = code.trim().toUpperCase();

    if (!h || !p || !c) {
      setError('All fields are required');
      return;
    }

    if (!/^[A-Z0-9]{6}$/.test(c)) {
      setError('Code must be 6 alphanumeric characters');
      return;
    }

    try {
      const result = await window.api.connectRemote(h, p, c);
      if (result.success) {
        setConnectionString('');
        setHost('');
        setPort('7777');
        setCode('');
        onClose();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function handleDisconnect() {
    window.api.disconnectRemote();
  }

  const isConnected = remoteConnectionStatus === 'connected';

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-background/80" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card text-card-foreground border border-border rounded-lg p-6 w-[24rem] shadow-lg">
          <Dialog.Title className="text-lg font-bold mb-4">
            {isConnected ? 'Remote Connection' : 'Connect to Remote'}
          </Dialog.Title>

          {isConnected ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">Connected to remote Gustav.</p>
              <button
                onClick={handleDisconnect}
                className="w-full py-2 text-sm bg-destructive text-destructive-foreground rounded-md cursor-pointer"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              {!manualMode ? (
                <div>
                  <label className="block text-sm mb-1 text-muted-foreground">
                    Paste connection info
                  </label>
                  <input
                    className="w-full bg-muted text-foreground px-3 py-2 rounded-md border border-input text-sm font-mono"
                    placeholder="100.64.0.1:7777:ABC123"
                    value={connectionString}
                    onChange={(e) => handlePaste(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setManualMode(true)}
                    className="text-xs text-muted-foreground mt-1 underline cursor-pointer bg-transparent border-none p-0"
                  >
                    Enter manually
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm mb-1 text-muted-foreground">Host</label>
                    <input
                      className="w-full bg-muted text-foreground px-3 py-2 rounded-md border border-input text-sm"
                      placeholder="100.64.0.1"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1 text-muted-foreground">Port</label>
                    <input
                      className="w-full bg-muted text-foreground px-3 py-2 rounded-md border border-input text-sm"
                      placeholder="7777"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1 text-muted-foreground">Pairing Code</label>
                    <input
                      className="w-full bg-muted text-foreground px-3 py-2 rounded-md border border-input text-sm font-mono tracking-widest"
                      placeholder="ABC123"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      maxLength={6}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setManualMode(false)}
                    className="text-xs text-muted-foreground underline cursor-pointer bg-transparent border-none p-0"
                  >
                    Paste connection string
                  </button>
                </>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <button
                type="submit"
                disabled={!host || !code}
                className="w-full py-2 text-sm bg-primary text-primary-foreground rounded-md cursor-pointer disabled:opacity-50"
              >
                Connect
              </button>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
