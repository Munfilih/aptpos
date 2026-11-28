import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';

export interface HardwareSystemIdentity {
  fingerprint: string;
  systemCode: string;
}

let cachedIdentity: HardwareSystemIdentity | null = null;

/**
 * Computes this computer's deterministic 10-digit hardware System Code from the
 * Windows motherboard/BIOS UUID (`Win32_ComputerSystemProduct.UUID`).
 *
 * Used identically by both the backend (`server/db.ts`) and the Electron main
 * process (`electron/main.ts`) so Client Mode PCs can compute their own
 * System Code without opening a local SQLite database.
 */
export function getHardwareSystemIdentity(): HardwareSystemIdentity {
  if (cachedIdentity) return cachedIdentity;

  if (process.platform !== 'win32') {
    throw new Error('Hardware-based system codes are supported on Windows only.');
  }

  let hardwareUuid = '';
  try {
    hardwareUuid = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000, windowsHide: true }
    )
      .trim()
      .toUpperCase();
  } catch {
    throw new Error("Could not read this computer's hardware UUID to create a system code.");
  }

  if (
    !/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(hardwareUuid) ||
    hardwareUuid === '00000000-0000-0000-0000-000000000000' ||
    hardwareUuid === 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'
  ) {
    throw new Error('This computer did not provide a valid hardware UUID for its system code.');
  }

  const fingerprint = createHash('sha256')
    .update('aptPOS-registration-system-v1:')
    .update(hardwareUuid)
    .digest('hex');

  const systemCode = (
    BigInt(`0x${fingerprint.slice(0, 16)}`) % 10_000_000_000n
  )
    .toString()
    .padStart(10, '0');

  cachedIdentity = { fingerprint, systemCode };
  return cachedIdentity;
}

export interface LocalLanAddress {
  interfaceName: string;
  address: string;
  cidr: string | null;
  mac: string;
}

/**
 * Returns all non-internal IPv4 addresses on this computer, prioritized with
 * typical private LAN subnets (192.168.x.x, 10.x.x.x, 172.16-31.x.x) first.
 */
export function getLocalLanAddresses(): LocalLanAddress[] {
  const interfaces = os.networkInterfaces();
  const addresses: LocalLanAddress[] = [];

  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue; // link-local APIPA
      addresses.push({
        interfaceName,
        address: entry.address,
        cidr: entry.cidr ?? null,
        mac: entry.mac,
      });
    }
  }

  const rank = (ip: string): number => {
    if (ip.startsWith('192.168.')) return 0;
    if (ip.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    return 3;
  };

  return addresses.sort(
    (a, b) => rank(a.address) - rank(b.address) || a.interfaceName.localeCompare(b.interfaceName)
  );
}
