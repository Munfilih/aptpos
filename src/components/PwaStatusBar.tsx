import React, { useEffect, useState } from 'react';
import { Download, MoreVertical, RefreshCw, Share, WifiOff, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import {
  applyPwaUpdate,
  getDeferredInstallPrompt,
  isRunningInElectron,
  isRunningInStandalonePwa,
  onInstallPromptChange,
  onPwaUpdateAvailable,
  triggerPwaInstall,
} from '../utils/pwaClient';

const DISMISS_SESSION_KEY = 'aptpos_pwa_install_banner_dismissed_session';

export const PwaStatusBar: React.FC = () => {
  const { isRtl } = useLanguage();
  const [isOffline, setIsOffline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false
  );
  const [canPrompt, setCanPrompt] = useState(() => Boolean(getDeferredInstallPrompt()));
  const [updateReady, setUpdateReady] = useState(false);
  const [showManualHelp, setShowManualHelp] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_SESSION_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const isElectron = isRunningInElectron();
  const isStandalone = isRunningInStandalonePwa();
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIosSafari = /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const secure = typeof window !== 'undefined' && window.isSecureContext;

  useEffect(() => {
    if (isElectron) return;
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    const unsubscribeInstall = onInstallPromptChange(() =>
      setCanPrompt(Boolean(getDeferredInstallPrompt()))
    );
    const unsubscribeUpdate = onPwaUpdateAvailable(() => setUpdateReady(true));
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribeInstall();
      unsubscribeUpdate();
    };
  }, [isElectron]);

  if (isElectron || isStandalone) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    setShowManualHelp(false);
    try {
      sessionStorage.setItem(DISMISS_SESSION_KEY, 'true');
    } catch {
      // Ignore
    }
  };

  const handleInstallClick = async () => {
    const accepted = await triggerPwaInstall();
    if (!accepted && !getDeferredInstallPrompt()) {
      setShowManualHelp(true);
    }
  };

  // Small always-available install chip (re-appears on every page load until installed)
  const showChip = dismissed && !showManualHelp;
  const showBanner = !dismissed || showManualHelp;

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="pointer-events-none fixed right-3 bottom-3 left-3 z-[240] flex flex-col items-end gap-2 print:hidden sm:left-auto sm:max-w-md"
    >
      {isOffline && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900 shadow-lg">
          <WifiOff className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            {isRtl
              ? 'غير متصل بالشبكة — يتم عرض البيانات المخزنة مؤقتاً.'
              : 'Offline — showing cached app & catalog until store Wi-Fi reconnects.'}
          </span>
        </div>
      )}

      {updateReady && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-blue-200 bg-slate-900 px-4 py-2.5 text-xs font-medium text-white shadow-xl">
          <RefreshCw className="h-4 w-4 shrink-0 text-sky-400" />
          <span>{isRtl ? 'يتوفر تحديث جديد للتطبيق.' : 'A newer version of aptPOS is ready.'}</span>
          <button
            type="button"
            onClick={applyPwaUpdate}
            className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500"
          >
            {isRtl ? 'تحديث الآن' : 'Reload'}
          </button>
        </div>
      )}

      {showChip && (
        <button
          type="button"
          onClick={() => {
            setDismissed(false);
            if (canPrompt) void handleInstallClick();
            else setShowManualHelp(true);
          }}
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-lg"
        >
          <Download className="h-3.5 w-3.5" />
          {isRtl ? 'تثبيت التطبيق' : 'Install App'}
        </button>
      )}

      {showBanner && !isIosSafari && (
        <div className="pointer-events-auto w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-800 shadow-xl">
          <div className="flex items-center gap-3">
            <Download className="h-4 w-4 shrink-0 text-blue-600" />
            <div className="min-w-0 flex-1">
              <div className="font-bold">{isRtl ? 'تثبيت تطبيق aptPOS' : 'Install aptPOS App'}</div>
              <div className="text-[11px] text-slate-500">
                {isRtl
                  ? 'افتح النظام بملء الشاشة بدون شريط المتصفح.'
                  : 'Open full-screen without the browser address bar.'}
              </div>
            </div>
            {canPrompt && (
              <button
                type="button"
                onClick={() => void handleInstallClick()}
                className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
              >
                {isRtl ? 'تثبيت' : 'Install'}
              </button>
            )}
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss"
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {!canPrompt && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-900">
              {!secure ? (
                <>
                  {isRtl
                    ? 'المتصفح لا يعتبر هذا العنوان آمناً. فعّل chrome://flags/#unsafely-treat-insecure-origin-as-secure لهذا العنوان ثم أعد تشغيل Chrome.'
                    : 'Chrome does not treat this address as secure yet. Enable chrome://flags/#unsafely-treat-insecure-origin-as-secure for this exact address, then relaunch Chrome.'}
                </>
              ) : (
                <span className="inline-flex flex-wrap items-center gap-1">
                  {isAndroid
                    ? isRtl
                      ? 'من قائمة Chrome'
                      : 'In Chrome tap'
                    : isRtl
                      ? 'من قائمة المتصفح'
                      : 'In the browser menu choose'}
                  <MoreVertical className="inline h-3.5 w-3.5" />
                  <strong>{isRtl ? '← تثبيت التطبيق' : '→ Install app'}</strong>
                  {isRtl ? '(أو "إضافة إلى الشاشة الرئيسية").' : '(or "Add to Home screen").'}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {showBanner && isIosSafari && (
        <div className="pointer-events-auto flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-800 shadow-xl">
          <Share className="h-4 w-4 shrink-0 text-blue-600" />
          <div className="min-w-0 flex-1">
            {isRtl
              ? 'لتثبيت aptPOS على iPad/iPhone: اضغط زر المشاركة ثم "إضافة إلى الشاشة الرئيسية".'
              : 'Install aptPOS on iPad/iPhone: tap Share, then "Add to Home Screen".'}
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
