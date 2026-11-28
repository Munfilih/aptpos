import fs from 'fs';
import path from 'path';
import { generate } from 'selfsigned';
import { getLocalLanAddresses } from './systemIdentity';

export interface TlsMaterial {
  key: string;
  cert: string;
  ips: string[];
  certPath: string;
}

/**
 * Creates (or reuses) a local HTTPS certificate valid for localhost and every LAN IPv4 of this PC.
 * The same certificate is served at /aptpos-ca.crt so phones/tablets can install it as a trusted
 * certificate once, which lets Chrome install aptPOS as a real full-screen app.
 * The certificate is regenerated automatically when this PC's LAN IP changes.
 */
export async function ensureLocalTls(dataDir: string): Promise<TlsMaterial> {
  const tlsDir = path.join(dataDir, 'tls');
  fs.mkdirSync(tlsDir, { recursive: true });
  const keyPath = path.join(tlsDir, 'server-key.pem');
  const certPath = path.join(tlsDir, 'aptpos-ca.crt');
  const metaPath = path.join(tlsDir, 'meta.json');

  const ips = getLocalLanAddresses().map((nic) => nic.address).sort();

  try {
    if (fs.existsSync(keyPath) && fs.existsSync(certPath) && fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { ips?: string[]; expiresAt?: number };
      const sameIps = JSON.stringify(meta.ips || []) === JSON.stringify(ips);
      if (sameIps && (meta.expiresAt || 0) > Date.now() + 30 * 86_400_000) {
        return {
          key: fs.readFileSync(keyPath, 'utf8'),
          cert: fs.readFileSync(certPath, 'utf8'),
          ips,
          certPath,
        };
      }
    }
  } catch {
    // Fall through and regenerate
  }

  // Chrome & iOS enforce a 398-day maximum lifetime for server TLS certificates
  const days = 365;
  const expiresAt = Date.now() + days * 86_400_000;
  const pems = await generate([{ name: 'commonName', value: 'aptPOS Local Server' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate: new Date(expiresAt),
    extensions: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          ...ips.map((ip) => ({ type: 7 as const, ip })),
        ],
      },
    ],
  });

  fs.writeFileSync(keyPath, pems.private, { mode: 0o600 });
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(
    metaPath,
    JSON.stringify({ ips, expiresAt: Date.now() + days * 86_400_000 }, null, 2)
  );
  return { key: pems.private, cert: pems.cert, ips, certPath };
}
