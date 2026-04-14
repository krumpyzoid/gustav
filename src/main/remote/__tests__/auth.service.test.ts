import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthService } from '../auth.service';
import {
  generateEd25519KeyPair,
  signChallenge,
} from '../crypto';

describe('AuthService', () => {
  let auth: AuthService;
  let storageData: Record<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    storageData = {};
    auth = new AuthService({
      read: (path: string) => storageData[path] ?? null,
      write: (path: string, data: string) => { storageData[path] = data; },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Pairing code management', () => {
    it('generates a pairing code', () => {
      const info = auth.generatePairingCode();
      expect(info.code.length).toBe(6);
      expect(info.code).toMatch(/^[A-Z0-9]+$/);
      expect(info.expiresAt).toBeGreaterThan(Date.now());
    });

    it('regenerating invalidates the previous code', () => {
      const first = auth.generatePairingCode();
      const second = auth.generatePairingCode();
      expect(first.code).not.toBe(second.code);
      expect(auth.verifyPairingCode(first.code)).toBe(false);
      expect(auth.verifyPairingCode(second.code)).toBe(true);
    });

    it('rejects expired pairing code', () => {
      const info = auth.generatePairingCode();
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      expect(auth.verifyPairingCode(info.code)).toBe(false);
    });

    it('accepts valid pairing code', () => {
      const info = auth.generatePairingCode();
      expect(auth.verifyPairingCode(info.code)).toBe(true);
    });

    it('rejects wrong pairing code', () => {
      auth.generatePairingCode();
      expect(auth.verifyPairingCode('XXXXXX')).toBe(false);
    });

    it('invalidates code after successful use', () => {
      const info = auth.generatePairingCode();
      auth.completePairing('client-pub-key');
      expect(auth.verifyPairingCode(info.code)).toBe(false);
    });
  });

  describe('Key exchange (pairing)', () => {
    it('returns server public key on successful pairing', () => {
      auth.generatePairingCode();
      const serverPubKey = auth.getServerPublicKey();
      expect(serverPubKey).toContain('-----BEGIN PUBLIC KEY-----');
    });

    it('stores client public key after pairing', () => {
      auth.generatePairingCode();
      auth.completePairing('client-pub-key-data');

      // The key should be persisted
      const knownHosts = JSON.parse(storageData['known_hosts.json'] ?? '{}');
      expect(Object.values(knownHosts)).toContain('client-pub-key-data');
    });

    it('generates a unique client ID for each pairing', () => {
      auth.generatePairingCode();
      const id1 = auth.completePairing('key-1');

      // Re-generate for second pair
      auth.generatePairingCode();
      const id2 = auth.completePairing('key-2');

      expect(id1).not.toBe(id2);
    });
  });

  describe('Challenge-response (reconnection)', () => {
    it('generates a challenge nonce', () => {
      const nonce = auth.generateChallenge();
      expect(typeof nonce).toBe('string');
      expect(nonce.length).toBeGreaterThan(0);
    });

    it('verifies a valid challenge response from a known client', () => {
      // Pair first
      const clientKeys = generateEd25519KeyPair();
      auth.generatePairingCode();
      auth.completePairing(clientKeys.publicKey);

      // Now do challenge-response
      const nonce = auth.generateChallenge();
      const signature = signChallenge(nonce, clientKeys.privateKey);
      const valid = auth.verifyChallengeResponse(clientKeys.publicKey, signature);
      expect(valid).toBe(true);
    });

    it('rejects a challenge response from an unknown client', () => {
      const unknownKeys = generateEd25519KeyPair();
      const nonce = auth.generateChallenge();
      const signature = signChallenge(nonce, unknownKeys.privateKey);
      const valid = auth.verifyChallengeResponse(unknownKeys.publicKey, signature);
      expect(valid).toBe(false);
    });

    it('rejects a challenge response with wrong signature', () => {
      const clientKeys = generateEd25519KeyPair();
      auth.generatePairingCode();
      auth.completePairing(clientKeys.publicKey);

      auth.generateChallenge();
      const valid = auth.verifyChallengeResponse(clientKeys.publicKey, 'bad-signature');
      expect(valid).toBe(false);
    });

    it('provides server signature for mutual auth', () => {
      auth.generateChallenge();
      const serverSig = auth.signCurrentChallenge();
      expect(typeof serverSig).toBe('string');
      expect(serverSig!.length).toBeGreaterThan(0);
    });
  });

  describe('Known hosts persistence', () => {
    it('loads previously paired clients from storage', () => {
      const clientKeys = generateEd25519KeyPair();

      // Pair
      auth.generatePairingCode();
      auth.completePairing(clientKeys.publicKey);

      // Create a new AuthService with the same storage — should load known hosts
      const auth2 = new AuthService({
        read: (path: string) => storageData[path] ?? null,
        write: (path: string, data: string) => { storageData[path] = data; },
      });

      const nonce = auth2.generateChallenge();
      const signature = signChallenge(nonce, clientKeys.privateKey);
      const valid = auth2.verifyChallengeResponse(clientKeys.publicKey, signature);
      expect(valid).toBe(true);
    });
  });
});
