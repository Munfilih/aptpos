import React, { useState } from 'react';
import {
  Copy,
  Check,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  Send,
  RefreshCw,
  Monitor,
  ArrowLeftRight,
  Clock,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { setPwaTerminalName } from '../utils/pwaClient';

export interface TerminalRegistrationBlockInfo {
  code: 'TERMINAL_NOT_REGISTERED' | 'TERMINAL_BLOCKED';
  clientSystemCode: string;
  primarySystemCode: string;
  storeName: string;
  terminalName?: string;
  demoStatus?:
    | 'registered'
    | 'active'
    | 'blocked'
    | 'pending'
    | 'awaiting-activation'
    | 'expired'
    | 'deactivated'
    | 'previous-request'
    | 'never';
  expiresAt?: string | null;
  message?: string;
}

interface AdditionalSystemRegistrationModalProps {
  info: TerminalRegistrationBlockInfo;
  onActivated: () => void;
  onRetryCheck: () => Promise<void>;
}

export const AdditionalSystemRegistrationModal: React.FC<AdditionalSystemRegistrationModalProps> = ({
  info,
  onActivated,
  onRetryCheck,
}) => {
  const { isRtl } = useLanguage();
  const [activeTab, setActiveTab] = useState<'register' | 'demo'>(
    info.demoStatus === 'pending' ||
      info.demoStatus === 'awaiting-activation' ||
      info.demoStatus === 'expired'
      ? 'demo'
      : 'register'
  );
  const [terminalName, setTerminalName] = useState(
    info.terminalName || `Counter ${info.clientSystemCode.slice(-4) || '2'}`
  );
  const [registrationKey, setRegistrationKey] = useState('');
  const [demoKey, setDemoKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);

  const isBlocked = info.code === 'TERMINAL_BLOCKED';
  const isDemoExpired = info.demoStatus === 'expired';

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(info.clientSystemCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  // Path 1: Register under Business Serial / License Key (same as normal registration)
  const handleSerialRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanedKey = registrationKey.replace(/\s+/g, '').trim();
    if (!cleanedKey) {
      setStatusMessage({
        type: 'error',
        text: isRtl
          ? 'أدخل مفتاح التسجيل (الرقم التسلسلي) المكون من 16 رقماً.'
          : 'Enter the 16-digit Serial / Registration Key.',
      });
      return;
    }

    setBusy(true);
    setStatusMessage(null);
    if (terminalName.trim()) setPwaTerminalName(terminalName.trim());
    try {
      const response = await fetch('/api/terminals/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientSystemCode: info.clientSystemCode,
          registrationKey: cleanedKey,
          terminalName: terminalName.trim(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        activated?: boolean;
      };
      if (!response.ok || !data.activated) {
        throw new Error(data.error || 'Could not register this device under the serial key.');
      }
      setStatusMessage({
        type: 'success',
        text: isRtl
          ? 'تم تسجيل الجهاز وتفعيله بنجاح! جارٍ الاتصال بالخادم الرئيسي...'
          : 'Device registered & activated! Connecting to Primary Server...',
      });
      onActivated();
    } catch (error) {
      setStatusMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Registration failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  // Path 2A: Request normal Demo Key (or Extension if expired)
  const handleDemoRequest = async () => {
    setBusy(true);
    setStatusMessage(null);
    if (terminalName.trim()) setPwaTerminalName(terminalName.trim());
    try {
      const response = await fetch('/api/terminals/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientSystemCode: info.clientSystemCode,
          terminalName: terminalName.trim(),
          requestType: isDemoExpired ? 'extension' : 'demo',
          requestedBy: terminalName.trim() || `Counter_${info.clientSystemCode.slice(-4)}`,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || 'Could not submit the demo key request.');
      }
      setStatusMessage({
        type: 'success',
        text:
          data.message ||
          (isRtl
            ? 'تم إرسال طلب المفتاح التجريبي إلى بوابة الإدارة. أدخل المفتاح أدناه بعد الموافقة.'
            : 'Demo key request sent to aptPOS Admin Portal. Enter the Demo Key below once approved.'),
      });
    } catch (error) {
      setStatusMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to send demo request.',
      });
    } finally {
      setBusy(false);
    }
  };

  // Path 2B: Activate normal Demo Key
  const handleDemoActivate = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanedKey = demoKey.trim();
    if (!cleanedKey) {
      setStatusMessage({
        type: 'error',
        text: isRtl ? 'أدخل مفتاح التفعيل التجريبي.' : 'Enter the Demo Activation Key.',
      });
      return;
    }

    setBusy(true);
    setStatusMessage(null);
    if (terminalName.trim()) setPwaTerminalName(terminalName.trim());
    try {
      const response = await fetch('/api/terminals/demo-activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientSystemCode: info.clientSystemCode,
          activationKey: cleanedKey,
          terminalName: terminalName.trim(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        activated?: boolean;
      };
      if (!response.ok || !data.activated) {
        throw new Error(data.error || 'Could not activate demo access for this device.');
      }
      setStatusMessage({
        type: 'success',
        text: isRtl
          ? 'تم تفعيل النسخة التجريبية بنجاح! جارٍ الاتصال بالخادم الرئيسي...'
          : 'Demo activated! Connecting to Primary Server...',
      });
      onActivated();
    } catch (error) {
      setStatusMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Demo activation failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchStandalone = async () => {
    if (!window.electronAPI?.saveTerminalConfig) return;
    setBusy(true);
    try {
      await window.electronAPI.saveTerminalConfig({
        mode: 'standalone',
        terminalName: terminalName.trim() || 'Main Counter',
        serverHost: '',
        serverPort: 43187,
      });
    } catch (error) {
      setStatusMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Could not switch mode.',
      });
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center overflow-y-auto bg-slate-950/80 p-3 sm:p-4"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="additional-system-reg-title"
        className="my-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
              isBlocked ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
            }`}
          >
            {isBlocked ? <ShieldAlert className="h-6 w-6" /> : <Monitor className="h-6 w-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="additional-system-reg-title" className="text-lg font-bold text-slate-900">
              {isBlocked
                ? isRtl
                  ? 'تم حظر هذا الجهاز الإضافي'
                  : 'Additional System Blocked'
                : isRtl
                  ? 'تفعيل جهاز إضافي للاتصال بالخادم الرئيسي'
                  : 'Activate Additional System'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {isBlocked
                ? isRtl
                  ? 'تم إيقاف اتصال هذا الجهاز بالخادم الرئيسي. يرجى التواصل مع مزود الخدمة أو مدير المتجر.'
                  : 'This device has been blocked from connecting to the Primary Server. Contact your service provider or store administrator.'
                : isRtl
                  ? 'سجّل رمز هذا الجهاز تحت الرقم التسلسلي للنشاط التجاري أو استخدم التفعيل التجريبي للاتصال مباشرة بالخادم الرئيسي بدون قاعدة بيانات محلية.'
                  : 'Register this device under your business Serial Key or use Demo Activation to connect directly to the Primary Server (no local database required).'}
            </p>
          </div>
        </div>

        {/* Store + System Code Cards */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {isRtl ? 'الخادم الرئيسي المتصل به' : 'Primary Server Store'}
            </div>
            <div className="mt-1 truncate text-sm font-bold text-slate-900">
              {info.storeName || 'aptPOS Primary Server'}
            </div>
            {info.primarySystemCode && (
              <div className="mt-0.5 font-mono text-xs text-slate-500">
                {isRtl ? 'رمز الخادم:' : 'Primary Code:'} {info.primarySystemCode}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                {isRtl ? 'رمز النظام لهذا الجهاز' : 'This Device System Code'}
              </span>
              <button
                type="button"
                onClick={() => void handleCopyCode()}
                className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-0.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? (isRtl ? 'تم النسخ' : 'Copied') : isRtl ? 'نسخ' : 'Copy'}
              </button>
            </div>
            <div className="mt-1 font-mono text-lg font-extrabold tracking-widest text-blue-800">
              {info.clientSystemCode || '—'}
            </div>
          </div>
        </div>

        {!isBlocked && (
          <div className="mt-4 space-y-4">
            {/* Terminal Name */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                {isRtl ? 'اسم نقطة البيع / الجهاز' : 'Counter / Device Name'}
              </label>
              <input
                type="text"
                value={terminalName}
                onChange={(e) => setTerminalName(e.target.value)}
                placeholder={isRtl ? 'مثال: كاونتر 2 أو تابلت المبيعات' : 'e.g. Counter 2, Android Tablet'}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Mode Switcher Tabs: Register (Serial) vs Demo Activation */}
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('register');
                  setStatusMessage(null);
                }}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-all sm:text-sm ${
                  activeTab === 'register'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ShieldCheck className="h-4 w-4" />
                {isRtl ? 'تسجيل (الرقم التسلسلي)' : 'Register (Serial)'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('demo');
                  setStatusMessage(null);
                }}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-all sm:text-sm ${
                  activeTab === 'demo'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Clock className="h-4 w-4" />
                {isRtl ? 'التفعيل التجريبي (Demo)' : 'Demo Activation'}
              </button>
            </div>

            {/* Tab 1: Register under Business Serial */}
            {activeTab === 'register' ? (
              <form onSubmit={handleSerialRegister} className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                  {isRtl
                    ? '1. أضف رمز النظام لهذا الجهاز ضمن الرقم التسلسلي (التراخيص) في بوابة الإدارة.\n2. أدخل مفتاح التسجيل (الرقم التسلسلي) المكون من 16 رقماً أدناه واضغط تسجيل.'
                    : '1. Add this device’s System Code under your business Serial in Admin Portal (Business Detail → Add System Code).\n2. Enter the 16-digit Serial / Registration Key below and click Register.'}
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    {isRtl ? 'مفتاح التسجيل (الرقم التسلسلي)' : 'Serial / Registration Key'}
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative flex-1">
                      <KeyRound className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={registrationKey}
                        onChange={(e) => setRegistrationKey(e.target.value)}
                        placeholder="1234567890123456"
                        className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pr-3 pl-9 font-mono text-sm tracking-wider text-slate-900 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={busy || !registrationKey.trim()}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      {isRtl ? 'تسجيل والاتصال' : 'Register'}
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              /* Tab 2: Normal Demo Activation */
              <form onSubmit={handleDemoActivate} className="space-y-3">
                {(info.demoStatus === 'expired' ||
                  info.demoStatus === 'pending' ||
                  info.demoStatus === 'awaiting-activation' ||
                  info.demoStatus === 'deactivated') && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {info.demoStatus === 'expired'
                      ? isRtl
                        ? 'انتهت صلاحية النسخة التجريبية لهذا الجهاز. يمكنك طلب تمديد أو التسجيل بالرقم التسلسلي.'
                        : 'Demo access for this device has expired. Request a demo extension below or register under your Serial.'
                      : info.demoStatus === 'pending'
                        ? isRtl
                          ? 'يوجد طلب تجريبي قيد الانتظار في بوابة الإدارة لهذا الجهاز.'
                          : 'A demo key request is currently pending approval in the Admin Portal.'
                        : info.demoStatus === 'awaiting-activation'
                          ? isRtl
                            ? 'تمت الموافقة على الطلب التجريبي. أدخل المفتاح أدناه للتفعيل.'
                            : 'Your demo request was approved. Enter the Demo Key below to activate.'
                          : isRtl
                            ? 'تم إيقاف النسخة التجريبية لهذا الجهاز. يرجى التواصل مع مزود الخدمة.'
                            : 'Demo access was deactivated for this device. Contact your service provider.'}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="min-w-0 flex-1 text-xs text-slate-600">
                    {isDemoExpired
                      ? isRtl
                        ? 'الخطوة 1: اطلب تمديداً للمفتاح التجريبي من بوابة الإدارة.'
                        : 'Step 1: Request a Demo Extension for this device in Admin Portal.'
                      : isRtl
                        ? 'الخطوة 1: اطلب مفتاحاً تجريبياً لهذا الجهاز من بوابة الإدارة (نفس الإجراء العادي).'
                        : 'Step 1: Request a Demo Key for this device in Admin Portal (same as normal demo).'}
                  </div>
                  <button
                    type="button"
                    disabled={busy || !info.clientSystemCode}
                    onClick={() => void handleDemoRequest()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {isDemoExpired
                      ? isRtl
                        ? 'طلب تمديد تجريبي'
                        : 'Request Extension'
                      : isRtl
                        ? 'طلب مفتاح تجريبي'
                        : 'Request Demo Key'}
                  </button>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    {isRtl
                      ? 'الخطوة 2: أدخل مفتاح التفعيل التجريبي'
                      : 'Step 2: Enter Demo Activation Key'}
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative flex-1">
                      <KeyRound className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={demoKey}
                        onChange={(e) => setDemoKey(e.target.value)}
                        placeholder="DEMO-XXXX-XXXX-XXXX"
                        className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pr-3 pl-9 font-mono text-sm tracking-wider text-slate-900 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={busy || !demoKey.trim()}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                    >
                      {isRtl ? 'تفعيل تجريبي' : 'Activate Demo'}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        )}

        {statusMessage && (
          <div
            role="alert"
            className={`mt-4 rounded-lg border p-3 text-sm ${
              statusMessage.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : statusMessage.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-blue-200 bg-blue-50 text-blue-700'
            }`}
          >
            {statusMessage.text}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onRetryCheck()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {isRtl ? 'إعادة فحص الحالة' : 'Re-check Status'}
          </button>

          {window.electronAPI?.saveTerminalConfig && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSwitchStandalone()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              {isRtl ? 'العودة للوضع المستقل (Standalone)' : 'Switch Back to Standalone'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
