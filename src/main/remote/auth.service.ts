import crypto from 'node:crypto';
import {
  generateEd25519KeyPair,
  generatePairingCode as genCode,
  isPairingCodeValid,
  signChallenge as signChallengeUtil,
  verifyChallenge,
  type KeyPair,
  type PairingCode,
} from './crypto';

export type AuthStorage = {
  read: (path: string) => string | null;
  write: (path: string, data: string) => void;
};

const KNOWN_HOSTS_FILE = 'known_hosts.json';

export class AuthService {
  private serverKeys: KeyPair;
  private currentPairingCode: PairingCode | null = null;
  private currentChallenge: string | null = null;
  private knownClients: Map<string, string>; // clientId → publicKey

  constructor(private storage: AuthStorage) {
    this.serverKeys = this.loadOrGenerateServerKeys();
    this.knownClients = this.loadKnownHosts();
  }

  // ── Pairing code ──────────────────────────────────────────────────
  generatePairingCode(): PairingCode {
    this.currentPairingCode = genCode();
    return this.currentPairingCode;
  }

  getCurrentPairingCode(): PairingCode | null {
    if (!this.currentPairingCode) return null;
    if (!isPairingCodeValid(this.currentPairingCode)) {
      this.currentPairingCode = null;
      return null;
    }
    return this.currentPairingCode;
  }

  verifyPairingCode(code: string): boolean {
    if (!this.currentPairingCode) return false;
    if (!isPairingCodeValid(this.currentPairingCode)) {
      this.currentPairingCode = null;
      return false;
    }
    if (this.currentPairingCode.code.length !== code.length) return false;
    return crypto.timingSafeEqual(Buffer.from(this.currentPairingCode.code), Buffer.from(code));
  }

  // ── Key exchange ──────────────────────────────────────────────────
  getServerPublicKey(): string {
    return this.serverKeys.publicKey;
  }

  completePairing(clientPublicKey: string): string {
    // Invalidate the pairing code
    this.currentPairingCode = null;

    // Generate a unique client ID
    const clientId = crypto.randomBytes(16).toString('hex');

    // Store the client's public key
    this.knownClients.set(clientId, clientPublicKey);
    this.saveKnownHosts();

    return clientId;
  }

  // ── Challenge-response ────────────────────────────────────────────
  generateChallenge(): string {
    this.currentChallenge = crypto.randomBytes(32).toString('hex');
    return this.currentChallenge;
  }

  verifyChallengeResponse(clientPublicKey: string, signature: string): boolean {
    if (!this.currentChallenge) return false;

    // Check if this client is known
    const isKnown = Array.from(this.knownClients.values()).includes(clientPublicKey);
    if (!isKnown) {
      this.currentChallenge = null;
      return false;
    }

    const valid = verifyChallenge(this.currentChallenge, signature, clientPublicKey);
    this.currentChallenge = null; // Invalidate after use (prevent replay)
    return valid;
  }

  /** Sign the current challenge for mutual auth. Only signs the server's own challenge, not arbitrary nonces. */
  signCurrentChallenge(): string | null {
    if (!this.currentChallenge) return null;
    return signChallengeUtil(this.currentChallenge, this.serverKeys.privateKey);
  }


  // ── Known hosts persistence ───────────────────────────────────────
  private loadKnownHosts(): Map<string, string> {
    try {
      const raw = this.storage.read(KNOWN_HOSTS_FILE);
      if (!raw) return new Map();
      const obj = JSON.parse(raw) as Record<string, string>;
      return new Map(Object.entries(obj));
    } catch {
      return new Map();
    }
  }

  private saveKnownHosts(): void {
    const obj = Object.fromEntries(this.knownClients.entries());
    this.storage.write(KNOWN_HOSTS_FILE, JSON.stringify(obj, null, 2));
  }

  private loadOrGenerateServerKeys(): KeyPair {
    try {
      const raw = this.storage.read('server_identity.json');
      if (raw) {
        const parsed = JSON.parse(raw) as KeyPair;
        if (parsed.publicKey && parsed.privateKey) return parsed;
      }
    } catch {}
    const keys = generateEd25519KeyPair();
    this.storage.write('server_identity.json', JSON.stringify(keys, null, 2));
    return keys;
  }
}
