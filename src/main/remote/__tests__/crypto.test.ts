import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateEd25519KeyPair,
  signChallenge,
  verifyChallenge,
  generatePairingCode,
  isPairingCodeValid,
  generateSelfSignedCert,
  type KeyPair,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
} from '../crypto';

describe('Ed25519 key pair', () => {
  it('generates a key pair with public and private keys', () => {
    const kp = generateEd25519KeyPair();
    expect(kp.publicKey).toBeDefined();
    expect(kp.privateKey).toBeDefined();
    expect(typeof kp.publicKey).toBe('string');
    expect(typeof kp.privateKey).toBe('string');
  });

  it('generates unique key pairs each time', () => {
    const kp1 = generateEd25519KeyPair();
    const kp2 = generateEd25519KeyPair();
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
  });
});

describe('Challenge-response signing', () => {
  let keyPair: KeyPair;

  beforeEach(() => {
    keyPair = generateEd25519KeyPair();
  });

  it('signs a challenge and verifies it with the correct public key', () => {
    const challenge = 'random-nonce-12345';
    const signature = signChallenge(challenge, keyPair.privateKey);
    expect(typeof signature).toBe('string');

    const valid = verifyChallenge(challenge, signature, keyPair.publicKey);
    expect(valid).toBe(true);
  });

  it('rejects a signature from a different key', () => {
    const otherKeyPair = generateEd25519KeyPair();
    const challenge = 'nonce-abc';
    const signature = signChallenge(challenge, otherKeyPair.privateKey);

    const valid = verifyChallenge(challenge, signature, keyPair.publicKey);
    expect(valid).toBe(false);
  });

  it('rejects a tampered challenge', () => {
    const challenge = 'original-nonce';
    const signature = signChallenge(challenge, keyPair.privateKey);

    const valid = verifyChallenge('tampered-nonce', signature, keyPair.publicKey);
    expect(valid).toBe(false);
  });
});

describe('Pairing code', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('generates a code of the correct length', () => {
    const { code } = generatePairingCode();
    expect(code.length).toBe(PAIRING_CODE_LENGTH);
  });

  it('generates alphanumeric codes', () => {
    const { code } = generatePairingCode();
    expect(code).toMatch(/^[A-Z0-9]+$/);
  });

  it('generates unique codes', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generatePairingCode().code));
    expect(codes.size).toBe(20);
  });

  it('is valid immediately after generation', () => {
    const pairing = generatePairingCode();
    expect(isPairingCodeValid(pairing)).toBe(true);
  });

  it('expires after TTL', () => {
    const pairing = generatePairingCode();
    vi.advanceTimersByTime(PAIRING_CODE_TTL_MS + 1);
    expect(isPairingCodeValid(pairing)).toBe(false);
  });

  it('is valid just before TTL', () => {
    const pairing = generatePairingCode();
    vi.advanceTimersByTime(PAIRING_CODE_TTL_MS - 100);
    expect(isPairingCodeValid(pairing)).toBe(true);
  });

  it('returns expiresAt timestamp', () => {
    const now = Date.now();
    const pairing = generatePairingCode();
    expect(pairing.expiresAt).toBeGreaterThanOrEqual(now + PAIRING_CODE_TTL_MS - 10);
    expect(pairing.expiresAt).toBeLessThanOrEqual(now + PAIRING_CODE_TTL_MS + 10);
  });
});

describe('Self-signed TLS certificate', () => {
  it('generates cert and key as PEM strings', () => {
    const { cert, key } = generateSelfSignedCert();
    expect(cert).toContain('-----BEGIN CERTIFICATE-----');
    expect(key).toContain('-----BEGIN');
  });

  it('generates unique certs each time', () => {
    const c1 = generateSelfSignedCert();
    const c2 = generateSelfSignedCert();
    expect(c1.cert).not.toBe(c2.cert);
  });
});
