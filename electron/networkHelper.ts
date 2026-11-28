import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import dgram from 'node:dgram';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export type TerminalMode = 'standalone' | 'primary-server' | 'client';

export interface TerminalConfig {
  mode: TerminalMode;
  terminalName: string;
  serverHost: string;
  serverPort: number;
}

export interface LanDiscoveredServer {
  host: string;
  port: number;
  storeName: string;
  primarySystemCode: string;
  serverVersion: string;
  hostname: string;
}

export interface ServerConnectionTestResult {
  ok: boolean;
  storeName?: string;
  primarySystemCode?: string;
  serverVersion?: string;
  minClientShellVersion?: string;
  dbEngine?: string;
  error?: string;
}

export const DEFAULT_SERVER_PORT = 43187;
export const LAN_DISCOVERY_PORT = 43188;
const DISCOVERY_MAGIC_REQ = 'APTPOS_DISCOVER_V1';
const DISCOVERY_MAGIC_RES = 'APTPOS_SERVER_V1';

let cachedSystemCode: string | null = null;

export function getLocalHardwareSystemCode(): string {
  if (cachedSystemCode) return cachedSystemCode;
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

  cachedSystemCode = (
    BigInt(`0x${fingerprint.slice(0, 16)}`) % 10_000_000_000n
  )
    .toString()
    .padStart(10, '0');

  return cachedSystemCode;
}

export function defaultTerminalConfig(): TerminalConfig {
  return {
    mode: 'standalone',
    terminalName: os.hostname() || 'Main Counter',
    serverHost: '',
    serverPort: DEFAULT_SERVER_PORT,
  };
}

export function sanitizeTerminalConfig(raw: unknown): TerminalConfig {
  const defaults = defaultTerminalConfig();
  if (!raw || typeof raw !== 'object') return defaults;
  const obj = raw as Record<string, unknown>;
  const mode: TerminalMode =
    obj.mode === 'primary-server' || obj.mode === 'client' ? obj.mode : 'standalone';
  const terminalName =
    typeof obj.terminalName === 'string' && obj.terminalName.trim()
      ? obj.terminalName.trim().slice(0, 80)
      : defaults.terminalName;
  const serverHost =
    typeof obj.serverHost === 'string'
      ? obj.serverHost.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').slice(0, 255)
      : '';
  const parsedPort = Number(obj.serverPort);
  const serverPort =
    Number.isInteger(parsedPort) && parsedPort >= 1024 && parsedPort <= 65535
      ? parsedPort
      : DEFAULT_SERVER_PORT;

  return { mode, terminalName, serverHost, serverPort };
}

export async function readTerminalConfig(userDataDir: string): Promise<TerminalConfig> {
  const filePath = path.join(userDataDir, 'terminal-config.json');
  try {
    const raw = await readFile(filePath, 'utf8');
    return sanitizeTerminalConfig(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultTerminalConfig();
    }
    console.error('Could not parse terminal-config.json; falling back to standalone:', error);
    return defaultTerminalConfig();
  }
}

export async function writeTerminalConfig(
  userDataDir: string,
  config: TerminalConfig
): Promise<TerminalConfig> {
  const clean = sanitizeTerminalConfig(config);
  const filePath = path.join(userDataDir, 'terminal-config.json');
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}

export function startLanDiscoveryResponder(
  getServerDetails: () => Promise<{
    port: number;
    storeName: string;
    primarySystemCode: string;
    serverVersion: string;
  }>
): dgram.Socket | null {
  try {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('error', (err) => {
      console.error('LAN discovery responder error:', err.message);
    });
    socket.on('message', (msg, rinfo) => {
      if (msg.toString('utf8').trim() !== DISCOVERY_MAGIC_REQ) return;
      void getServerDetails()
        .then((details) => {
          const payload = Buffer.from(
            JSON.stringify({
              type: DISCOVERY_MAGIC_RES,
              port: details.port,
              storeName: details.storeName,
              primarySystemCode: details.primarySystemCode,
              serverVersion: details.serverVersion,
              hostname: os.hostname(),
            }),
            'utf8'
          );
          socket.send(payload, rinfo.port, rinfo.address);
        })
        .catch(() => {
          // Ignore discovery errors
        });
    });
    socket.bind(LAN_DISCOVERY_PORT, '0.0.0.0', () => {
      try {
        socket.setBroadcast(true);
      } catch {
        // Ignore broadcast option errors
      }
      console.log(`aptPOS LAN discovery responder listening on UDP :${LAN_DISCOVERY_PORT}`);
    });
    return socket;
  } catch (error) {
    console.error('Could not start LAN discovery responder:', error);
    return null;
  }
}

function getBroadcastTargets(): string[] {
  const targets = new Set<string>(['255.255.255.255']);
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (!entry.netmask) continue;
      const ipParts = entry.address.split('.').map(Number);
      const maskParts = entry.netmask.split('.').map(Number);
      if (ipParts.length === 4 && maskParts.length === 4) {
        const broadcast = ipParts.map((part, idx) => (part | (~maskParts[idx] & 255))).join('.');
        targets.add(broadcast);
      }
    }
  }
  return [...targets];
}

export function discoverLanServers(timeoutMs = 1800): Promise<LanDiscoveredServer[]> {
  return new Promise((resolve) => {
    const found = new Map<string, LanDiscoveredServer>();
    let closed = false;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const finish = () => {
      if (closed) return;
      closed = true;
      try {
        socket.close();
      } catch {
        // Ignore close errors
      }
      resolve([...found.values()]);
    };

    socket.on('error', () => finish());
    socket.on('message', (msg, rinfo) => {
      try {
        const parsed = JSON.parse(msg.toString('utf8')) as Record<string, unknown>;
        if (parsed.type !== DISCOVERY_MAGIC_RES) return;
        const port = Number(parsed.port) || DEFAULT_SERVER_PORT;
        const key = `${rinfo.address}:${port}`;
        found.set(key, {
          host: rinfo.address,
          port,
          storeName: typeof parsed.storeName === 'string' ? parsed.storeName : 'aptPOS Primary Server',
          primarySystemCode: typeof parsed.primarySystemCode === 'string' ? parsed.primarySystemCode : '',
          serverVersion: typeof parsed.serverVersion === 'string' ? parsed.serverVersion : '',
          hostname: typeof parsed.hostname === 'string' ? parsed.hostname : rinfo.address,
        });
      } catch {
        // Ignore non-aptPOS UDP responses
      }
    });

    socket.bind(0, '0.0.0.0', () => {
      try {
        socket.setBroadcast(true);
      } catch {
        // Ignore
      }
      const probe = Buffer.from(DISCOVERY_MAGIC_REQ, 'utf8');
      const targets = getBroadcastTargets();
      const sendAll = () => {
        for (const target of targets) {
          try {
            socket.send(probe, LAN_DISCOVERY_PORT, target);
          } catch {
            // Ignore per-interface errors
          }
        }
      };
      sendAll();
      setTimeout(() => {
        if (!closed) sendAll();
      }, 450);
    });

    setTimeout(finish, timeoutMs);
  });
}

export function testServerConnection(
  host: string,
  port: number,
  timeoutMs = 3500
): Promise<ServerConnectionTestResult> {
  const cleanHost = host.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!cleanHost) {
    return Promise.resolve({ ok: false, error: 'Enter the Primary Server IP address or hostname.' });
  }
  const safePort = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_SERVER_PORT;
  const url = `http://${cleanHost}:${safePort}/api/health`;

  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(text) as Record<string, unknown>;
          if (res.statusCode === 200 && payload.ok === true) {
            resolve({
              ok: true,
              storeName: typeof payload.storeName === 'string' ? payload.storeName : undefined,
              primarySystemCode:
                typeof payload.primarySystemCode === 'string' ? payload.primarySystemCode : undefined,
              serverVersion:
                typeof payload.serverVersion === 'string' ? payload.serverVersion : undefined,
              minClientShellVersion:
                typeof payload.minClientShellVersion === 'string'
                  ? payload.minClientShellVersion
                  : undefined,
              dbEngine: typeof payload.dbEngine === 'string' ? payload.dbEngine : undefined,
            });
            return;
          }
          resolve({ ok: false, error: `Server responded with HTTP ${res.statusCode}.` });
        } catch {
          resolve({ ok: false, error: 'Server returned an unexpected response.' });
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ ok: false, error: `Timed out connecting to ${cleanHost}:${safePort}. Check that the Primary PC is on and Windows Firewall allows port ${safePort}.` });
    });

    req.on('error', (err) => {
      resolve({ ok: false, error: `Could not reach ${cleanHost}:${safePort}: ${err.message}` });
    });
  });
}

export function configureWindowsFirewall(port = DEFAULT_SERVER_PORT): Promise<{ ok: boolean; message: string }> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, message: 'Windows Firewall configuration is only available on Windows.' });
  }
  const safePort = Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_SERVER_PORT;
  const psCommand = [
    `netsh advfirewall firewall delete rule name="aptPOS LAN Server TCP ${safePort}" | Out-Null;`,
    `netsh advfirewall firewall delete rule name="aptPOS LAN Discovery UDP ${LAN_DISCOVERY_PORT}" | Out-Null;`,
    `netsh advfirewall firewall add rule name="aptPOS LAN Server TCP ${safePort}" dir=in action=allow protocol=TCP localport=${safePort} profile=private,domain | Out-Null;`,
    `netsh advfirewall firewall add rule name="aptPOS LAN Discovery UDP ${LAN_DISCOVERY_PORT}" dir=in action=allow protocol=UDP localport=${LAN_DISCOVERY_PORT} profile=private,domain | Out-Null;`,
  ].join(' ');

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-Command','${psCommand.replace(/'/g, "''")}'`,
      ],
      { timeout: 45000, windowsHide: true },
      (error) => {
        if (error) {
          resolve({
            ok: false,
            message: 'Windows Firewall rule could not be added (UAC may have been cancelled).',
          });
          return;
        }
        resolve({
          ok: true,
          message: `Windows Firewall opened for TCP ${safePort} and UDP ${LAN_DISCOVERY_PORT} (Private/Domain networks).`,
        });
      }
    );
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildClientRecoveryHtml(
  config: TerminalConfig,
  clientSystemCode: string,
  reason: string
): string {
  const safeHost = escapeHtml(config.serverHost || '');
  const safePort = String(config.serverPort || DEFAULT_SERVER_PORT);
  const safeName = escapeHtml(config.terminalName || '');
  const safeCode = escapeHtml(clientSystemCode || 'Unavailable');
  const safeReason = escapeHtml(reason || 'Could not reach the Primary Server.');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>aptPOS — Connect to Primary Server</title>
<style>
  *{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#f8fafc;padding:24px}
  .card{width:100%;max-width:560px;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.45)}
  h1{margin:0 0 6px;font-size:20px;font-weight:700}
  p.sub{margin:0 0 18px;font-size:13px;color:#94a3b8;line-height:1.5}
  .err{background:#450a0a;border:1px solid #991b1b;color:#fecaca;border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:18px}
  .code-box{background:#0f172a;border:1px solid #334155;border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
  .code-val{font-family:monospace;font-size:16px;font-weight:700;color:#38bdf8;letter-spacing:.08em}
  label{display:block;font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:6px}
  input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#f8fafc;font-size:14px;margin-bottom:12px}
  .row{display:grid;grid-template-columns:2fr 1fr;gap:10px}
  .btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
  button{cursor:pointer;border:none;border-radius:8px;padding:10px 14px;font-size:13px;font-weight:600}
  .primary{background:#2563eb;color:#fff}
  .secondary{background:#334155;color:#f8fafc}
  .warn{background:#475569;color:#e2e8f0}
  .list{margin-top:14px;display:flex;flex-direction:column;gap:8px}
  .srv{background:#0f172a;border:1px solid #334155;border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center}
  .status{margin-top:12px;font-size:12px;color:#93c5fd;min-height:18px}
</style>
</head>
<body>
  <div class="card">
    <h1>Primary Server Unreachable</h1>
    <p class="sub">This PC is configured as an Additional LAN Terminal (Client Mode). Start aptPOS on the Primary Server PC, or update the connection below.</p>
    <div class="err">${safeReason}</div>
    <div class="code-box">
      <div>
        <div style="font-size:11px;color:#94a3b8;text-transform:uppercase">This PC's System Code</div>
        <div class="code-val">${safeCode}</div>
      </div>
      <button class="secondary" id="copyBtn" type="button">Copy Code</button>
    </div>
    <div class="row">
      <div>
        <label>Primary Server IP / Hostname</label>
        <input id="hostInput" value="${safeHost}" placeholder="192.168.1.50" />
      </div>
      <div>
        <label>Port</label>
        <input id="portInput" type="number" value="${safePort}" />
      </div>
    </div>
    <div>
      <label>Counter / Terminal Name</label>
      <input id="nameInput" value="${safeName}" placeholder="Counter 2" />
    </div>
    <div class="btns">
      <button class="primary" id="connectBtn" type="button">Test &amp; Connect</button>
      <button class="secondary" id="scanBtn" type="button">Scan LAN for Primary PC</button>
      <button class="warn" id="standaloneBtn" type="button">Switch Back to Standalone</button>
    </div>
    <div class="status" id="statusText"></div>
    <div class="list" id="serversList"></div>
  </div>
<script>
  const statusEl = document.getElementById('statusText');
  const listEl = document.getElementById('serversList');
  document.getElementById('copyBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(${JSON.stringify(clientSystemCode)}); statusEl.textContent = 'System Code copied.'; } catch {}
  };
  document.getElementById('scanBtn').onclick = async () => {
    statusEl.textContent = 'Scanning local network for aptPOS Primary Servers...';
    listEl.innerHTML = '';
    try {
      const servers = await window.electronAPI.discoverLanServers();
      if (!servers.length) { statusEl.textContent = 'No Primary Servers answered on this LAN. Make sure the Primary PC is running in Primary Server Mode.'; return; }
      statusEl.textContent = 'Found ' + servers.length + ' Primary Server(s). Click Select to connect.';
      servers.forEach((s) => {
        const div = document.createElement('div');
        div.className = 'srv';
        div.innerHTML = '<div><strong>' + s.storeName + '</strong><div style="font-size:12px;color:#94a3b8">' + s.host + ':' + s.port + ' · ' + s.hostname + '</div></div>';
        const btn = document.createElement('button');
        btn.className = 'primary';
        btn.textContent = 'Select';
        btn.onclick = () => {
          document.getElementById('hostInput').value = s.host;
          document.getElementById('portInput').value = String(s.port);
        };
        div.appendChild(btn);
        listEl.appendChild(div);
      });
    } catch (e) { statusEl.textContent = e.message || 'LAN scan failed.'; }
  };
  document.getElementById('connectBtn').onclick = async () => {
    const serverHost = document.getElementById('hostInput').value.trim();
    const serverPort = Number(document.getElementById('portInput').value) || 43187;
    const terminalName = document.getElementById('nameInput').value.trim() || 'Counter';
    statusEl.textContent = 'Testing connection to ' + serverHost + ':' + serverPort + '...';
    const res = await window.electronAPI.testServerConnection(serverHost, serverPort);
    if (!res.ok) { statusEl.textContent = res.error || 'Connection failed.'; return; }
    statusEl.textContent = 'Connected to ' + (res.storeName || serverHost) + '. Restarting...';
    await window.electronAPI.saveTerminalConfig({ mode: 'client', serverHost, serverPort, terminalName });
  };
  document.getElementById('standaloneBtn').onclick = async () => {
    statusEl.textContent = 'Switching to Standalone mode and restarting...';
    await window.electronAPI.saveTerminalConfig({ mode: 'standalone', serverHost: '', serverPort: 43187, terminalName: document.getElementById('nameInput').value.trim() || 'Main Counter' });
  };
</script>
</body>
</html>`;
}
