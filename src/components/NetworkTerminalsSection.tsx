import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  Copy,
  Database,
  Laptop,
  Monitor,
  Network,
  Radio,
  RefreshCw,
  Server,
  Shield,
  ShieldCheck,
  Smartphone,
  Trash2,
  Wifi,
  Ban,
  Play,
} from 'lucide-react';
import type {
  LanDiscoveredServer,
  LinkedTerminal,
  NetworkServerInfo,
  TerminalConfig,
  TerminalMode,
} from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';

const DEFAULT_PORT = 43187;

export const NetworkTerminalsSection: React.FC = () => {
  const { isRtl } = useLanguage();
  const isElectron = Boolean(window.electronAPI?.isElectron);

  const [config, setConfig] = useState<TerminalConfig>({
    mode: 'standalone',
    terminalName: 'Main Counter',
    serverHost: '',
    serverPort: DEFAULT_PORT,
  });
  const [draftMode, setDraftMode] = useState<TerminalMode>('standalone');
  const [draftTerminalName, setDraftTerminalName] = useState('Main Counter');
  const [draftServerHost, setDraftServerHost] = useState('');
  const [draftServerPort, setDraftServerPort] = useState(String(DEFAULT_PORT));

  const [localSystemCode, setLocalSystemCode] = useState('');
  const [networkInfo, setNetworkInfo] = useState<NetworkServerInfo | null>(null);
  const [linkedTerminals, setLinkedTerminals] = useState<LinkedTerminal[]>([]);
  const [discoveredServers, setDiscoveredServers] = useState<LanDiscoveredServer[]>([]);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [firewallBusy, setFirewallBusy] = useState(false);
  const [copiedValue, setCopiedValue] = useState('');
  const [pwaQrDataUrl, setPwaQrDataUrl] = useState('');
  const [pwaQrUrl, setPwaQrUrl] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(
    null
  );

  const loadData = useCallback(async () => {
    try {
      const [infoRes, terminalsRes] = await Promise.all([
        fetch('/api/network/info').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/terminals').then((r) => (r.ok ? r.json() : [])).catch(() => []),
      ]);
      if (infoRes) setNetworkInfo(infoRes as NetworkServerInfo);
      if (Array.isArray(terminalsRes)) setLinkedTerminals(terminalsRes as LinkedTerminal[]);

      if (window.electronAPI?.getTerminalConfig) {
        const loadedCfg = await window.electronAPI.getTerminalConfig();
        setConfig(loadedCfg);
        setDraftMode(loadedCfg.mode);
        setDraftTerminalName(loadedCfg.terminalName || 'Main Counter');
        setDraftServerHost(loadedCfg.serverHost || '');
        setDraftServerPort(String(loadedCfg.serverPort || DEFAULT_PORT));
      } else if (infoRes) {
        const srv = infoRes as NetworkServerInfo;
        setConfig((prev) => ({ ...prev, mode: srv.mode, serverPort: srv.port }));
        setDraftMode(srv.mode);
        setDraftServerPort(String(srv.port || DEFAULT_PORT));
      }

      if (window.electronAPI?.getLocalSystemCode) {
        const code = await window.electronAPI.getLocalSystemCode().catch(() => '');
        setLocalSystemCode(code);
      } else if (infoRes && (infoRes as NetworkServerInfo).primarySystemCode) {
        setLocalSystemCode((infoRes as NetworkServerInfo).primarySystemCode);
      }
    } catch {
      // Ignore transient errors
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const primaryNic = networkInfo?.lanAddresses?.[0];
    if (!primaryNic || !networkInfo) {
      setPwaQrDataUrl('');
      setPwaQrUrl('');
      return;
    }
    const url = `http://${primaryNic.address}:${networkInfo.port}`;
    setPwaQrUrl(url);
    let active = true;
    void QRCode.toDataURL(url, { width: 176, margin: 1 })
      .then((dataUrl) => {
        if (active) setPwaQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (active) setPwaQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [networkInfo]);

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      setTimeout(() => setCopiedValue(''), 1600);
    } catch {
      // Ignore
    }
  };

  const handleScanLan = async () => {
    if (!window.electronAPI?.discoverLanServers) {
      setFeedback({
        type: 'info',
        text: isRtl
          ? 'البحث التلقائي في الشبكة متاح داخل تطبيق سطح المكتب aptPOS.'
          : 'Automatic LAN scan is available inside the installed aptPOS desktop app.',
      });
      return;
    }
    setScanning(true);
    setFeedback(null);
    try {
      const servers = await window.electronAPI.discoverLanServers();
      setDiscoveredServers(servers);
      if (servers.length === 0) {
        setFeedback({
          type: 'info',
          text: isRtl
            ? 'لم يتم العثور على خادم رئيسي في الشبكة المحلية. تأكد من تشغيل الجهاز الرئيسي في وضع الخادم الرئيسي.'
            : 'No aptPOS Primary Server responded on this LAN. Ensure the Primary PC is set to Primary Server Mode and Windows Firewall allows port 43187/43188.',
        });
      } else {
        setFeedback({
          type: 'success',
          text: isRtl
            ? `تم العثور على ${servers.length} خادم رئيسي في الشبكة المحلية.`
            : `Found ${servers.length} Primary Server(s) on your LAN. Click Select to fill in the IP.`,
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'LAN discovery failed.',
      });
    } finally {
      setScanning(false);
    }
  };

  const handleTestConnection = async () => {
    const host = draftServerHost.trim();
    const port = Number(draftServerPort) || DEFAULT_PORT;
    if (!host) {
      setFeedback({
        type: 'error',
        text: isRtl ? 'أدخل عنوان IP الخاص بالخادم الرئيسي.' : 'Enter the Primary Server IP address first.',
      });
      return;
    }
    setTesting(true);
    setFeedback(null);
    try {
      if (window.electronAPI?.testServerConnection) {
        const result = await window.electronAPI.testServerConnection(host, port);
        if (!result.ok) {
          throw new Error(result.error || 'Could not reach Primary Server.');
        }
        setFeedback({
          type: 'success',
          text: isRtl
            ? `تم الاتصال بنجاح بـ ${result.storeName || host} (الإصدار ${result.serverVersion || ''})`
            : `Connected to ${result.storeName || host} (v${result.serverVersion || ''}, Engine: ${result.dbEngine || 'sqlite'})`,
        });
      } else {
        const res = await fetch(`http://${host}:${port}/api/health`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setFeedback({ type: 'success', text: `Server at ${host}:${port} is reachable.` });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Connection test failed.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveTerminalMode = async () => {
    if (!window.electronAPI?.saveTerminalConfig) {
      setFeedback({
        type: 'info',
        text: isRtl
          ? 'تبديل وضع الجهاز متاح داخل تطبيق سطح المكتب aptPOS المثبت.'
          : 'Switching between Standalone, Primary Server, and Client Mode is available in the installed aptPOS desktop app.',
      });
      return;
    }
    const port = Number(draftServerPort) || DEFAULT_PORT;
    if (draftMode === 'client' && !draftServerHost.trim()) {
      setFeedback({
        type: 'error',
        text: isRtl ? 'أدخل عنوان IP للخادم الرئيسي.' : 'Enter the Primary Server IP address for Client Mode.',
      });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await window.electronAPI.saveTerminalConfig({
        mode: draftMode,
        terminalName: draftTerminalName.trim() || 'Counter',
        serverHost: draftMode === 'client' ? draftServerHost.trim() : '',
        serverPort: port,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not save network mode.',
      });
      setSaving(false);
    }
  };

  const handleConfigureFirewall = async () => {
    if (!window.electronAPI?.configureWindowsFirewall) return;
    setFirewallBusy(true);
    setFeedback(null);
    try {
      const result = await window.electronAPI.configureWindowsFirewall(
        Number(draftServerPort) || DEFAULT_PORT
      );
      setFeedback({
        type: result.ok ? 'success' : 'error',
        text: result.message,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not update Windows Firewall.',
      });
    } finally {
      setFirewallBusy(false);
    }
  };

  const handleTerminalStatusChange = async (code: string, status: 'active' | 'blocked') => {
    try {
      const res = await fetch(`/api/terminals/${encodeURIComponent(code)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update terminal status.');
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update terminal.',
      });
    }
  };

  const handleRemoveTerminal = async (code: string) => {
    try {
      const res = await fetch(`/api/terminals/${encodeURIComponent(code)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove terminal.');
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to remove terminal.',
      });
    }
  };

  const modeCards: Array<{
    id: TerminalMode;
    title: string;
    titleAr: string;
    desc: string;
    descAr: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'standalone',
      title: 'Standalone PC',
      titleAr: 'جهاز مستقل',
      desc: 'Single computer with local SQLite WAL database (127.0.0.1 only).',
      descAr: 'جهاز واحد مع قاعدة بيانات SQLite محلية فقط.',
      icon: <Laptop className="h-5 w-5" />,
    },
    {
      id: 'primary-server',
      title: 'Primary Server (Host LAN)',
      titleAr: 'الخادم الرئيسي (مشاركة الشبكة)',
      desc: 'Hosts the shared SQLite WAL database for all store counters on LAN (0.0.0.0:43187).',
      descAr: 'يستضيف قاعدة البيانات المشتركة لجميع أجهزة الكاشير عبر الشبكة المحلية.',
      icon: <Server className="h-5 w-5" />,
    },
    {
      id: 'client',
      title: 'Additional PC (Client Mode)',
      titleAr: 'جهاز إضافي (عميل شبكة)',
      desc: 'Connects to the store Primary Server over LAN using its registered System Code.',
      descAr: 'يتصل بالخادم الرئيسي عبر الشبكة باستخدام رمز النظام المسجل.',
      icon: <Monitor className="h-5 w-5" />,
    },
  ];

  const hasModeChanges =
    draftMode !== config.mode ||
    draftTerminalName.trim() !== config.terminalName ||
    (draftMode === 'client' && draftServerHost.trim() !== config.serverHost) ||
    Number(draftServerPort) !== config.serverPort;

  return (
    <div className="space-y-6">
      {/* Live Status Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Network className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isRtl ? 'الشبكة المحلية والأجهزة المتصلة (Multi-Terminal LAN)' : 'Network & Multi-Terminal LAN Setup'}
              </h3>
              <p className="mt-0.5 text-sm text-slate-600">
                {isRtl
                  ? 'اربط عدة أجهزة كاشير أو مكاتب بقاعدة بيانات SQLite WAL واحدة عالية الأداء (تدعم 5,000+ فاتورة يومياً).'
                  : 'Connect multiple counters or back-office PCs to one high-volume SQLite WAL Primary Server (5,000+ invoices/day).'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <Database className="h-3.5 w-3.5" />
              {networkInfo?.dbEngine === 'node-sqlite-wal'
                ? 'Native SQLite WAL'
                : networkInfo?.dbEngine || 'SQLite'}
            </span>
            {localSystemCode && (
              <button
                type="button"
                onClick={() => void copyText(localSystemCode)}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-xs font-bold text-slate-700 hover:bg-slate-100"
                title={isRtl ? 'انقر لنسخ رمز النظام لهذا الجهاز' : 'Click to copy this PC’s System Code'}
              >
                {copiedValue === localSystemCode ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-slate-400" />
                )}
                {isRtl ? 'رمز الجهاز:' : 'PC Code:'} {localSystemCode}
              </button>
            )}
          </div>
        </div>

        {/* Mode Selector Cards */}
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          {modeCards.map((card) => {
            const active = draftMode === card.id;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => setDraftMode(card.id)}
                className={`flex flex-col items-start rounded-xl border p-4 text-start transition-all ${
                  active
                    ? 'border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                      active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {card.icon}
                  </div>
                  {config.mode === card.id && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      {isRtl ? 'نشط الآن' : 'Current'}
                    </span>
                  )}
                </div>
                <div className="mt-3 text-sm font-bold text-slate-900">
                  {isRtl ? card.titleAr : card.title}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  {isRtl ? card.descAr : card.desc}
                </p>
              </button>
            );
          })}
        </div>

        {/* Mode Configuration Inputs */}
        <div className="mt-5 grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              {isRtl ? 'اسم هذا الجهاز / الكاونتر' : 'This Terminal / Counter Name'}
            </label>
            <input
              type="text"
              value={draftTerminalName}
              onChange={(e) => setDraftTerminalName(e.target.value)}
              placeholder="Counter 1"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {draftMode === 'client' && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                {isRtl ? 'عنوان IP للخادم الرئيسي' : 'Primary Server IP Address'}
              </label>
              <input
                type="text"
                value={draftServerHost}
                onChange={(e) => setDraftServerHost(e.target.value)}
                placeholder="192.168.1.50"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              {isRtl ? 'منفذ الشبكة (Port)' : 'LAN Port'}
            </label>
            <input
              type="number"
              value={draftServerPort}
              onChange={(e) => setDraftServerPort(e.target.value)}
              min={1024}
              max={65535}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Client Mode Auto-Discover & Test */}
        {draftMode === 'client' && (
          <div className="mt-4 space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-700">
                <strong>{isRtl ? 'تذكير مهم:' : 'Important:'}</strong>{' '}
                {isRtl
                  ? 'بعد الاتصال بالخادم الرئيسي، يمكنك تسجيل رمز هذا الجهاز (10 أرقام) تحت الرقم التسلسلي للنشاط التجاري أو استخدام التفعيل التجريبي (نفس الإجراء العادي) بدون قاعدة بيانات محلية.'
                  : 'After connecting, register this device’s 10-digit System Code under your business Serial Key or use Demo Activation (same as normal setup) — no local database required.'}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleScanLan()}
                  disabled={scanning}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                >
                  <Radio className={`h-3.5 w-3.5 ${scanning ? 'animate-pulse' : ''}`} />
                  {scanning
                    ? isRtl
                      ? 'جارٍ البحث...'
                      : 'Scanning LAN...'
                    : isRtl
                      ? 'بحث تلقائي عن الخادم'
                      : 'Scan LAN for Primary PC'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleTestConnection()}
                  disabled={testing || !draftServerHost.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Wifi className="h-3.5 w-3.5" />
                  {testing ? (isRtl ? 'جارٍ الفحص...' : 'Testing...') : isRtl ? 'اختبار الاتصال' : 'Test Connection'}
                </button>
              </div>
            </div>

            {discoveredServers.length > 0 && (
              <div className="space-y-2">
                {discoveredServers.map((srv) => (
                  <div
                    key={`${srv.host}:${srv.port}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2"
                  >
                    <div>
                      <div className="text-sm font-bold text-slate-900">{srv.storeName}</div>
                      <div className="font-mono text-xs text-slate-500">
                        {srv.host}:{srv.port} · {srv.hostname} · v{srv.serverVersion}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setDraftServerHost(srv.host);
                        setDraftServerPort(String(srv.port));
                      }}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      {isRtl ? 'اختيار هذا الخادم' : 'Select Server'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Save & Restart Bar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {isRtl
              ? 'ملاحظة: تبقى إعدادات الطابعات، وضع الشاشة، المظهر واللغة محفوظة بشكل مستقل على كل جهاز.'
              : 'Note: Printers, Screen Mode (POS/RPOS/ERP/FlyERP), Theme, and Language remain independent per PC.'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isElectron && draftMode === 'primary-server' && (
              <button
                type="button"
                disabled={firewallBusy}
                onClick={() => void handleConfigureFirewall()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Shield className="h-4 w-4 text-amber-600" />
                {firewallBusy
                  ? isRtl
                    ? 'جارٍ التهيئة...'
                    : 'Configuring Firewall...'
                  : isRtl
                    ? 'فتح جدار حماية ويندوز (Port 43187)'
                    : 'Allow in Windows Firewall'}
              </button>
            )}
            <button
              type="button"
              disabled={saving || (!hasModeChanges && isElectron)}
              onClick={() => void handleSaveTerminalMode()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" />
              {saving
                ? isRtl
                  ? 'جارٍ الحفظ وإعادة التشغيل...'
                  : 'Saving & Restarting...'
                : isRtl
                  ? 'حفظ وإعادة تشغيل التطبيق'
                  : 'Save Mode & Restart App'}
            </button>
          </div>
        </div>

        {feedback && (
          <div
            className={`mt-4 rounded-lg border p-3 text-sm ${
              feedback.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : feedback.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-blue-200 bg-blue-50 text-blue-700'
            }`}
          >
            {feedback.text}
          </div>
        )}
      </div>

      {/* Primary Server LAN Addresses */}
      {config.mode !== 'client' && networkInfo && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-slate-900">
                {isRtl ? 'عناوين الشبكة المحلية لهذا الخادم' : 'Primary Server LAN Addresses'}
              </h4>
              <p className="text-xs text-slate-500">
                {isRtl
                  ? 'استخدم أحد العناوين التالية على الأجهزة الإضافية للاتصال بهذا الخادم (يفضل تثبيت IP ثابت من الراوتر).'
                  : 'Use one of these IP addresses on additional counter PCs (assigning a static DHCP reservation in your router is recommended).'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadData()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {isRtl ? 'تحديث' : 'Refresh'}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {networkInfo.lanAddresses.length === 0 ? (
              <div className="col-span-full rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">
                {isRtl ? 'لم يتم اكتشاف اتصال شبكة LAN نشط.' : 'No active LAN IPv4 adapters detected.'}
              </div>
            ) : (
              networkInfo.lanAddresses.map((nic) => {
                const endpoint = `${nic.address}:${networkInfo.port}`;
                return (
                  <div
                    key={`${nic.interfaceName}-${nic.address}`}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        {nic.interfaceName}
                      </div>
                      <div className="font-mono text-sm font-bold text-slate-900">{endpoint}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyText(nic.address)}
                      className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
                      title={isRtl ? 'نسخ عنوان IP' : 'Copy IP'}
                    >
                      {copiedValue === nic.address ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {pwaQrDataUrl && pwaQrUrl && (
            <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
              <img
                src={pwaQrDataUrl}
                alt="Mobile / Tablet PWA QR Code"
                className="h-28 w-28 shrink-0 rounded-lg border border-blue-200 bg-white p-1.5 shadow-sm"
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Smartphone className="h-4 w-4 text-blue-600" />
                  {isRtl
                    ? 'اتصال الهاتف أو التابلت (تطبيق ويب PWA)'
                    : 'Connect Phone or Tablet (Installable PWA)'}
                </div>
                <p className="text-xs leading-relaxed text-slate-600">
                  {isRtl
                    ? 'امسح رمز QR بكاميرا الهاتف أو التابلت على نفس شبكة Wi-Fi لفتح aptPOS وتثبيته على الشاشة الرئيسية. سيحصل الجهاز تلقائياً على رمز نظام من 10 أرقام لتسجيله في بوابة الإدارة.'
                    : 'Scan this QR code with a phone or tablet on the same store Wi-Fi to open aptPOS and add it to the Home Screen. The device automatically gets its own 10-digit System Code for Admin Portal approval.'}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded-md border border-blue-200 bg-white px-2.5 py-1 font-mono text-xs font-semibold text-blue-700">
                    {pwaQrUrl}
                  </code>
                  {networkInfo.httpsPort && networkInfo.lanAddresses[0] && (
                    <code className="rounded-md border border-emerald-200 bg-white px-2.5 py-1 font-mono text-xs font-semibold text-emerald-700">
                      {`https://${networkInfo.lanAddresses[0].address}:${networkInfo.httpsPort}`}
                    </code>
                  )}
                  <button
                    type="button"
                    onClick={() => void copyText(pwaQrUrl)}
                    className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    {copiedValue === pwaQrUrl ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {isRtl ? 'نسخ الرابط' : 'Copy URL'}
                  </button>
                  <a
                    href="/aptpos-ca.crt"
                    download="aptpos-ca.crt"
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                  >
                    {isRtl ? 'تنزيل شهادة HTTPS' : 'Download HTTPS Cert'}
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Linked Additional Systems Table */}
      {config.mode !== 'client' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-slate-900">
                {isRtl
                  ? `الأجهزة الإضافية المرتبطة (${linkedTerminals.length})`
                  : `Linked Additional Systems (${linkedTerminals.length})`}
              </h4>
              <p className="text-xs text-slate-500">
                {isRtl
                  ? 'الأجهزة المعتمدة عبر بوابة الإدارة للاتصال بقاعدة البيانات المحلية.'
                  : 'Additional PCs approved via the Admin Portal and authorized to access this Primary Server.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadData()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {isRtl ? 'تحديث القائمة' : 'Refresh List'}
            </button>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-start text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-start">{isRtl ? 'اسم الكاونتر' : 'Terminal Name'}</th>
                  <th className="px-4 py-2.5 text-start">{isRtl ? 'رمز النظام' : 'System Code'}</th>
                  <th className="px-4 py-2.5 text-start">{isRtl ? 'الحالة' : 'Status'}</th>
                  <th className="px-4 py-2.5 text-start">{isRtl ? 'آخر IP' : 'Last IP'}</th>
                  <th className="px-4 py-2.5 text-start">{isRtl ? 'آخر نشاط' : 'Last Seen'}</th>
                  <th className="px-4 py-2.5 text-end">{isRtl ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {linkedTerminals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                      {isRtl
                        ? 'لا توجد أجهزة إضافية مرتبطة بعد. قم بتثبيت aptPOS على جهاز إضافي واختر "جهاز إضافي (عميل شبكة)".'
                        : 'No additional terminals linked yet. Install aptPOS on another PC and choose Additional PC (Client Mode).'}
                    </td>
                  </tr>
                ) : (
                  linkedTerminals.map((term) => {
                    const lastSeenMs = term.lastSeenAt ? Date.parse(term.lastSeenAt) : 0;
                    const isOnline =
                      term.status === 'active' && lastSeenMs > 0 && Date.now() - lastSeenMs < 120_000;
                    return (
                      <tr key={term.clientSystemCode} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 font-semibold text-slate-900">
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                isOnline ? 'bg-emerald-500' : 'bg-slate-300'
                              }`}
                            />
                            {term.terminalName || '—'}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs font-bold text-blue-700">
                          {term.clientSystemCode}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                term.status === 'active'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : term.status === 'blocked'
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-amber-100 text-amber-700'
                              }`}
                            >
                              {term.status === 'active'
                                ? isRtl
                                  ? 'نشط'
                                  : 'Active'
                                : term.status === 'blocked'
                                  ? isRtl
                                    ? 'محظور'
                                    : 'Blocked'
                                  : isRtl
                                    ? 'قيد الانتظار'
                                    : 'Pending'}
                            </span>
                            {term.status === 'active' && term.licenseType && (
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  term.licenseType === 'demo'
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-purple-100 text-purple-700'
                                }`}
                              >
                                {term.licenseType === 'demo'
                                  ? isRtl
                                    ? 'تجريبي'
                                    : 'Demo'
                                  : isRtl
                                    ? 'مسجل'
                                    : 'Serial'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                          {term.lastIp || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">
                          {term.lastSeenAt ? new Date(term.lastSeenAt).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-end">
                          <div className="inline-flex items-center gap-1.5">
                            {term.status === 'blocked' ? (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleTerminalStatusChange(term.clientSystemCode, 'active')
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                              >
                                <Play className="h-3 w-3" />
                                {isRtl ? 'تفعيل' : 'Unblock'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleTerminalStatusChange(term.clientSystemCode, 'blocked')
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                              >
                                <Ban className="h-3 w-3" />
                                {isRtl ? 'حظر' : 'Block'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleRemoveTerminal(term.clientSystemCode)}
                              className="inline-flex items-center rounded-md border border-red-200 bg-red-50 p-1.5 text-red-600 hover:bg-red-100"
                              title={isRtl ? 'حذف' : 'Remove'}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
