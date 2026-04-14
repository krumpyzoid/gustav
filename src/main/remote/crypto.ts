import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Constants ────────────────────────────────────────────────────────
export const PAIRING_CODE_LENGTH = 6;
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// ── Ed25519 key pair ─────────────────────────────────────────────────
export type KeyPair = {
  publicKey: string;   // PEM-encoded
  privateKey: string;  // PEM-encoded
};

export function generateEd25519KeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

// ── Challenge-response ───────────────────────────────────────────────
export function signChallenge(challenge: string, privateKeyPem: string): string {
  const signature = crypto.sign(null, Buffer.from(challenge), privateKeyPem);
  return signature.toString('base64');
}

export function verifyChallenge(challenge: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    return crypto.verify(null, Buffer.from(challenge), publicKeyPem, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

// ── Pairing code ─────────────────────────────────────────────────────
export type PairingCode = {
  code: string;
  expiresAt: number;
};

export function generatePairingCode(): PairingCode {
  const bytes = crypto.randomBytes(PAIRING_CODE_LENGTH);
  const code = Array.from(bytes, (b) => ALPHANUMERIC[b % ALPHANUMERIC.length]).join('');
  return {
    code,
    expiresAt: Date.now() + PAIRING_CODE_TTL_MS,
  };
}

export function isPairingCodeValid(pairing: PairingCode): boolean {
  return Date.now() < pairing.expiresAt;
}

// ── Self-signed TLS certificate ──────────────────────────────────────
export type TlsCert = {
  cert: string; // PEM
  key: string;  // PEM
};

export function generateSelfSignedCert(): TlsCert {
  const dir = join(tmpdir(), `gustav-cert-${crypto.randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');

  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
      `-days 365 -nodes -subj "/CN=Gustav Remote" 2>/dev/null`,
      { timeout: 10_000 },
    );
    const key = readFileSync(keyPath, 'utf-8');
    const cert = readFileSync(certPath, 'utf-8');
    return { cert, key };
  } finally {
    try { unlinkSync(keyPath); } catch {}
    try { unlinkSync(certPath); } catch {}
    try { require('node:fs').rmdirSync(dir); } catch {}
  }
}
