import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, Lock, User, ShoppingBag, Sparkles, Globe, ArrowRight, ReceiptText, BarChart3, PackageCheck, BadgeCheck } from 'lucide-react';
import type { DemoAccessStatus, UserSession } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { parseDemoActivationResult } from '../utils/demoActivation';

function getDemoCredentialError(username: string, password: string, isRtl: boolean): string | null {
  if (!username || !/^[A-Za-z0-9._-]+$/.test(username) || username.toLowerCase() === 'aptadmin') {
    return isRtl
      ? 'أدخل اسم مستخدم تجريبيًا صالحًا. الاسم aptadmin محجوز.'
      : 'Enter a valid demo username. The username "aptadmin" is reserved.';
  }
  if (!password) {
    return isRtl
      ? 'أدخل كلمة مرور العرض.'
      : 'Enter a demo password.';
  }
  return null;
}

interface LoginFormProps {
  onLoginSuccess: (user: UserSession) => void;
  onDemoRegistrationRequested: (user: UserSession, status: DemoAccessStatus) => void;
  initialError?: string | null;
}

export const LoginForm: React.FC<LoginFormProps> = ({
  onLoginSuccess,
  onDemoRegistrationRequested,
  initialError = null,
}) => {
  const { t, language, toggleLanguage, isRtl } = useLanguage();
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [systemCode, setSystemCode] = useState('');
  const [systemCodeError, setSystemCodeError] = useState<string | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<DemoAccessStatus | null>(null);
  const [registrationStatusLoading, setRegistrationStatusLoading] = useState(true);
  const [registrationStatusError, setRegistrationStatusError] = useState<string | null>(null);
  const [registeredAppVersion, setRegisteredAppVersion] = useState<string | null>(null);
  const [registeredBusinessName, setRegisteredBusinessName] = useState('');
  const [startupMode, setStartupMode] = useState<'choice' | 'demo' | 'register' | null>(null);
  const [demoUsername, setDemoUsername] = useState('');
  const [demoPassword, setDemoPassword] = useState('');
  const [startupActivationKey, setStartupActivationKey] = useState('');
  const [startupRegistrationKey, setStartupRegistrationKey] = useState('');
  const [startupSubmitting, setStartupSubmitting] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupMessage, setStartupMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialError) {
      setError(initialError);
    }
  }, [initialError]);


  useEffect(() => {
    let active = true;
    void fetch('/api/registration/system-code')
      .then(async (response) => {
        const data: unknown = await response.json().catch(() => null);
        const code =
          typeof data === 'object' &&
          data !== null &&
          'systemCode' in data &&
          typeof data.systemCode === 'string'
            ? data.systemCode.trim()
            : '';
        if (!response.ok || !code) {
          const message =
            typeof data === 'object' &&
            data !== null &&
            'error' in data &&
            typeof data.error === 'string'
              ? data.error
              : "Could not load this installation's system code.";
          throw new Error(message);
        }
        if (active) setSystemCode(code);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setSystemCodeError(
            loadError instanceof Error ? loadError.message : 'Could not load the system code.'
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch('/api/registration/demo-access')
      .then(async (response) => {
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || typeof data !== 'object' || data === null || !('status' in data)) {
          throw new Error(
            typeof data === 'object' &&
            data !== null &&
            'error' in data &&
            typeof data.error === 'string'
              ? data.error
              : 'Could not check the demo status for this system.'
          );
        }
        const status = data.status;
        if (
          status === 'never' ||
          status === 'pending' ||
          status === 'awaiting-activation' ||
          status === 'deactivated' ||
          status === 'previous-request' ||
          status === 'active' ||
          status === 'expired' ||
          status === 'registered' ||
          status === 'blocked'
        ) {
          if (active) setRegistrationStatus(status);
        } else {
          throw new Error('The system returned an invalid demo status.');
        }
        if (active && 'appVersion' in data && typeof data.appVersion === 'string') {
          setRegisteredAppVersion(data.appVersion);
        }
        if (active && 'businessName' in data && typeof data.businessName === 'string') {
          setRegisteredBusinessName(data.businessName.trim());
        }
      })
      .catch((statusError: unknown) => {
        if (active) {
          setRegistrationStatusError(
            statusError instanceof Error
              ? statusError.message
              : 'Could not check the demo status for this system.'
          );
        }
      })
      .finally(() => {
        if (active) setRegistrationStatusLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Opening screen fade animation state
  const [splashState, setSplashState] = useState<'splash' | 'fading' | 'ready'>('splash');

  useEffect(() => {
    // Stage 1: Display opening screen, then start fade-out at 1.4s
    const timer1 = setTimeout(() => {
      setSplashState('fading');
    }, 1400);

    // Stage 2: Finish transition and reveal fully active login card at 2.1s
    const timer2 = setTimeout(() => {
      setSplashState('ready');
    }, 2100);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, []);

  useEffect(() => {
    if (splashState !== 'ready') return;
    usernameRef.current?.focus();
  }, [splashState]);

  const handleUsernameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      passwordRef.current?.focus();
    }
  };

  const handleStartupDemoFieldKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const dialog = event.currentTarget.closest('[role="dialog"]');
    const fields = Array.from(
      dialog?.querySelectorAll<HTMLInputElement>('[data-startup-demo-field]:not(:disabled)') || []
    );
    const nextField = fields[fields.indexOf(event.currentTarget) + 1];
    if (nextField) {
      nextField.focus();
    } else {
      const buttonSelector =
        registrationStatus === 'awaiting-activation' || registrationStatus === 'deactivated'
          ? '[data-startup-demo-activate]'
          : '[data-startup-demo-request]';
      dialog?.querySelector<HTMLButtonElement>(buttonSelector)?.focus();
    }
  };

  const handleStartupDemoRequest = async () => {
    setStartupError(null);
    setStartupMessage(null);
    const username = demoUsername.trim();
    if (!systemCode) {
      setStartupError(isRtl ? 'تعذر تحميل رمز النظام.' : 'The system code is unavailable.');
      return;
    }
    const credentialError = getDemoCredentialError(username, demoPassword, isRtl);
    if (credentialError) {
      setStartupError(credentialError);
      return;
    }
    setStartupSubmitting(true);
    try {
      const response = await fetch('/api/registration/demo-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestType: registrationStatus === 'expired' ? 'extension' : 'demo',
          systemCode,
          requestedBy: username,
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Could not submit the demo request.';
        throw new Error(message);
      }
      const requestStatus =
        typeof data === 'object' && data !== null && 'status' in data
          ? data.status
          : null;
      setRegistrationStatus(
        requestStatus === 'approved' ? 'awaiting-activation' : 'pending'
      );
      setStartupMessage(null);
    } catch (requestError) {
      setStartupError(requestError instanceof Error ? requestError.message : 'Could not submit the demo request.');
    } finally {
      setStartupSubmitting(false);
    }
  };

  const handleStartupDemoActivation = async () => {
    setStartupError(null);
    setStartupMessage(null);
    const username = demoUsername.trim();
    if (!systemCode) {
      setStartupError(isRtl ? 'تعذر تحميل رمز النظام.' : 'The system code is unavailable.');
      return;
    }
    if (!startupActivationKey.trim()) {
      setStartupError(isRtl ? 'أدخل مفتاح تفعيل العرض.' : 'Enter the demo activation key.');
      return;
    }
    const credentialError = getDemoCredentialError(username, demoPassword, isRtl);
    if (credentialError) {
      setStartupError(credentialError);
      return;
    }
    setStartupSubmitting(true);
    try {
      const response = await fetch('/api/registration/demo-activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemCode,
          activationKey: startupActivationKey.trim(),
          username,
          password: demoPassword,
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Could not activate the demo.';
        throw new Error(message);
      }
      const activation = parseDemoActivationResult(data);
      if (!activation) {
        throw new Error('The demo activation response is invalid.');
      }
      onLoginSuccess({
        username: activation.username,
        displayName: activation.username,
        role: 'custom',
        permissions: activation.permissions,
        demoMode: true,
        registeredSystem: false,
        demoExpiresAt: activation.expiresAt,
        appVersion: activation.appVersion,
        demoScreenType: activation.screenType,
      });
    } catch (activationError) {
      setStartupError(activationError instanceof Error ? activationError.message : 'Could not activate the demo.');
    } finally {
      setStartupSubmitting(false);
    }
  };

  const handleStartupRegistration = async () => {
    setStartupError(null);
    setStartupMessage(null);
    if (!systemCode || !startupRegistrationKey.trim()) {
      setStartupError(isRtl
        ? 'أدخل رمز النظام ومفتاح التسجيل.'
        : 'Enter the system code and registration key.');
      return;
    }
    setStartupSubmitting(true);
    try {
      const response = await fetch('/api/registration/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationKey: startupRegistrationKey.trim(),
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Could not activate this registration.';
        throw new Error(message);
      }
      if (
        typeof data !== 'object' ||
        data === null ||
        !('registered' in data) ||
        data.registered !== true
      ) {
        throw new Error('The POS server did not confirm the registration.');
      }
      setRegistrationStatus('registered');
      if ('appVersion' in data && typeof data.appVersion === 'string') {
        setRegisteredAppVersion(data.appVersion);
      }
      if ('businessName' in data && typeof data.businessName === 'string') {
        setRegisteredBusinessName(data.businessName.trim());
      }
      setStartupMessage(isRtl
        ? 'تم تفعيل التسجيل. أُزيلت حسابات الدخول الأخرى، مع الاحتفاظ بحساب aptadmin الأساسي. استخدم بيانات حساب الترخيص.'
        : 'Registration activated. Other local login accounts were removed; the primary aptadmin account was kept. Use the license account credentials.');
      window.setTimeout(() => setStartupMode(null), 700);
    } catch (registrationError) {
      setStartupError(registrationError instanceof Error ? registrationError.message : 'Could not activate the registration.');
    } finally {
      setStartupSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (registrationStatusLoading || registrationStatus === 'blocked') return;
    if (!username.trim() || !password) {
      setError('Please enter both username and password.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed. Please check credentials.');
      }

      if (data.user?.username?.toLowerCase() === 'demo') {
        const status = data.demoAccess?.status as DemoAccessStatus | undefined;
        if (status === 'registered') {
          setError(
            isRtl
              ? 'لا يمكن استخدام بيانات الدخول التجريبية على نظام مسجل. سجل الدخول باسم المستخدم المسجل.'
              : 'Demo credentials cannot be used on a registered system. Sign in with your registered username.'
          );
          return;
        }
        if (status === 'pending') {
          setError(
            isRtl
              ? 'طلب العرض لهذا النظام قيد المراجعة. يرجى انتظار مزود الخدمة.'
              : 'A demo request for this system is pending approval. Please wait for the service provider.'
          );
          return;
        }
        if (status === 'deactivated') {
          onDemoRegistrationRequested(data.user, status);
          return;
        }
        if (status === 'previous-request') {
          setError(
            isRtl
              ? 'يوجد طلب سابق لهذا النظام. يرجى التواصل مع مزود الخدمة.'
              : 'A previous demo request exists for this system. Please contact the service provider.'
          );
          return;
        }
        if (status === 'awaiting-activation') {
          onDemoRegistrationRequested(data.user, status);
          return;
        }
        const demoStatus: DemoAccessStatus =
          status === 'active' &&
          typeof data.demoAccess.expiresAt === 'string' &&
          Date.parse(data.demoAccess.expiresAt) > Date.now()
            ? 'active'
            : status === 'expired' || status === 'active'
              ? 'expired'
              : 'never';
        if (demoStatus === 'active') {
          onLoginSuccess(data.user);
        } else {
          onDemoRegistrationRequested(data.user, demoStatus);
        }
        return;
      }

      onLoginSuccess(data.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen min-h-screen w-screen flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Top right language switcher on login screen */}
      <div className="absolute top-4 right-4 z-20">
        <button
          type="button"
          onClick={toggleLanguage}
          className="login-language inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer"
        >
          <Globe className="w-3.5 h-3.5 text-blue-400" />
          <span>{language === 'en' ? 'العربية' : 'English'}</span>
        </button>
      </div>

      {/* Opening Splash Screen with graceful Fade Animation */}
      {splashState !== 'ready' && (
        <div
          className={`login-splash fixed inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-700 ease-in-out ${
            splashState === 'fading' ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          {/* Subtle radial glow */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/30 via-slate-950 to-slate-950 pointer-events-none" />

          <div
            className={`relative z-10 flex flex-col items-center text-center px-6 transition-all duration-700 ease-out transform ${
              splashState === 'fading' ? 'scale-105' : 'scale-100'
            }`}
          >
            {/* Animated Logo Badge */}
            <div className="relative mb-6">
              <div className="login-logo-badge flex h-20 w-20 items-center justify-center rounded-2xl">
                <ShoppingBag className="h-10 w-10 text-violet-100" />
              </div>
              <div className="absolute -top-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-fuchsia-300/30 bg-violet-500/20">
                <Sparkles className="h-4 w-4 animate-spin text-violet-200" style={{ animationDuration: '6s' }} />
              </div>
            </div>

            {/* POS Name */}
            <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tight text-white mb-2">
              apt<span className="text-blue-400">POS</span>
            </h1>
            <p className="text-sm sm:text-base font-medium text-slate-400 max-w-xs">
              {isRtl ? 'نظام نقاط البيع وإدارة المخزون والتجزئة' : 'Retail Point-of-Sale & Inventory Management'}
            </p>

            {/* Smooth animated progress line */}
            <div className="mt-8 w-44 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-500 via-sky-400 to-indigo-500 rounded-full animate-pulse" />
            </div>
            <span className="text-[11px] font-mono text-slate-500 mt-3 tracking-wider uppercase">
              {isRtl ? 'جاري بدء تشغيل النظام...' : 'Starting Terminal...'}
            </span>
          </div>
        </div>
      )}

      {startupMode && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/75 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setStartupError(null);
              setStartupMessage(null);
              setStartupMode(null);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="startup-mode-title"
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
          >
            <h2 id="startup-mode-title" className="text-xl font-bold text-white">
              {startupMode === 'choice'
                ? (isRtl ? 'اختر طريقة الاستخدام' : 'Choose how to use aptPOS')
                : startupMode === 'demo'
                  ? (isRtl ? 'تفعيل النسخة التجريبية' : 'Activate Demo')
                  : (isRtl ? 'تسجيل النظام' : 'Register System')}
            </h2>

            {startupMode === 'choice' && (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setStartupError(null);
                    setStartupMessage(null);
                    setStartupMode('demo');
                  }}
                  className="rounded-xl border border-blue-400/30 bg-blue-500/10 p-4 text-left text-white hover:bg-blue-500/20"
                >
                  <strong className="block text-sm">{isRtl ? 'نسخة تجريبية' : 'Demo Version'}</strong>
                  <span className="mt-1 block text-xs text-slate-300">
                    {isRtl ? 'اطلب تفعيلًا تجريبيًا لهذا النظام.' : 'Request a demo activation for this system.'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStartupError(null);
                    setStartupMessage(null);
                    setStartupMode('register');
                  }}
                  className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-left text-white hover:bg-emerald-500/20"
                >
                  <strong className="block text-sm">{isRtl ? 'تسجيل النظام' : 'Register'}</strong>
                  <span className="mt-1 block text-xs text-slate-300">
                    {isRtl ? 'فعّل النظام بمفتاح التسجيل.' : 'Activate the system with a registration key.'}
                  </span>
                </button>
              </div>
            )}

            {startupMode === 'demo' && (
              <div className="mt-5 space-y-3">
                {registrationStatusLoading && (
                  <p role="status" className="text-sm text-slate-300">
                    {isRtl ? 'جارٍ التحقق من حالة النظام...' : 'Checking this system’s demo status…'}
                  </p>
                )}
                {!registrationStatusLoading && registrationStatusError && (
                  <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-300">
                    {registrationStatusError}
                  </p>
                )}
                {!registrationStatusLoading && !registrationStatusError && registrationStatus === 'pending' && (
                  <p role="status" className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                    {isRtl
                      ? 'طلب العرض لهذا النظام قيد المراجعة بالفعل. يرجى انتظار مزود الخدمة.'
                      : 'A demo request for this system is already pending approval. Please wait for the service provider.'}
                  </p>
                )}
                {!registrationStatusLoading && !registrationStatusError && registrationStatus === 'deactivated' && (
                  <p role="status" className="rounded-lg border border-blue-400/30 bg-blue-500/10 p-3 text-sm text-blue-200">
                    {isRtl
                      ? 'تم إلغاء تفعيل العرض. إذا أعاد مزود الخدمة تفعيله، أدخل مفتاح التفعيل الجديد.'
                      : 'This demo is deactivated. If your provider has reactivated it, enter the new activation key.'}
                  </p>
                )}
                {!registrationStatusLoading && !registrationStatusError && registrationStatus === 'previous-request' && (
                  <p role="status" className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                    {isRtl
                      ? 'يوجد طلب سابق لهذا النظام. يرجى التواصل مع مزود الخدمة.'
                      : 'A previous demo request exists for this system. Please contact the service provider.'}
                  </p>
                )}
                {!registrationStatusLoading && !registrationStatusError && registrationStatus === 'active' && (
                  <p role="status" className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                    {isRtl
                      ? 'العرض مفعل بالفعل على هذا النظام. سجل الدخول بحساب العرض.'
                      : 'The demo is already active on this system. Sign in with the demo account.'}
                  </p>
                )}
                {!registrationStatusLoading && !registrationStatusError && registrationStatus === 'registered' && (
                  <p role="status" className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                    {isRtl
                      ? 'هذا النظام مسجل بالفعل. استخدم خيار التسجيل.'
                      : 'This system is already registered. Use the registration option instead.'}
                  </p>
                )}
                {!registrationStatusLoading &&
                  !registrationStatusError &&
                  (
                    registrationStatus === 'never' ||
                    registrationStatus === 'expired' ||
                    registrationStatus === 'awaiting-activation' ||
                    registrationStatus === 'deactivated'
                  ) && (
                    <>
                      {registrationStatus === 'awaiting-activation' && (
                        <p role="status" className="rounded-lg border border-blue-400/30 bg-blue-500/10 p-3 text-sm text-blue-200">
                          {isRtl
                            ? 'تم إصدار مفتاح لهذا النظام. أدخله لتفعيل العرض.'
                            : 'A demo key has been issued for this system. Enter it to activate the demo.'}
                        </p>
                      )}
                      <label className="block text-xs font-semibold text-slate-200">
                        {isRtl ? 'رمز النظام' : 'System Code'}
                        <input
                          readOnly
                          value={systemCode}
                          onKeyDown={handleStartupDemoFieldKeyDown}
                          data-startup-demo-field
                          className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-sm text-white"
                        />
                      </label>
                      <label className="block text-xs font-semibold text-slate-200">
                        {isRtl ? 'اسم المستخدم التجريبي' : 'Demo username'}
                        <input
                          value={demoUsername}
                          onChange={(event) => setDemoUsername(event.target.value)}
                          onKeyDown={handleStartupDemoFieldKeyDown}
                          autoComplete="username"
                          data-startup-demo-field
                          className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
                        />
                        <span className="mt-1 block text-[11px] font-normal text-slate-400">
                          {isRtl
                            ? 'يمكن أن يكون اسم المستخدم قصيرًا. الاسم aptadmin محجوز.'
                            : 'The username can be short. "aptadmin" is reserved.'}
                        </span>
                      </label>
                      <label className="block text-xs font-semibold text-slate-200">
                        {isRtl ? 'كلمة المرور التجريبية' : 'Demo password'}
                        <input
                          type="password"
                          value={demoPassword}
                          onChange={(event) => setDemoPassword(event.target.value)}
                          onKeyDown={handleStartupDemoFieldKeyDown}
                          autoComplete="new-password"
                          data-startup-demo-field
                          className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
                        />
                        <span className="mt-1 block text-[11px] font-normal text-slate-400">
                          {isRtl ? 'أدخل كلمة مرور غير فارغة.' : 'Enter any non-empty password.'}
                        </span>
                      </label>
                      {registrationStatus !== 'awaiting-activation' && registrationStatus !== 'deactivated' && (
                        <button
                          type="button"
                          data-startup-demo-request
                          onClick={() => void handleStartupDemoRequest()}
                          disabled={startupSubmitting}
                          className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {startupSubmitting
                            ? (isRtl ? 'جارٍ الإرسال...' : 'Sending...')
                            : registrationStatus === 'expired'
                              ? (isRtl ? 'طلب تمديد العرض' : 'Request Extension')
                              : (isRtl ? 'طلب النسخة التجريبية' : 'Request Demo')}
                        </button>
                      )}
                      <label className="block text-xs font-semibold text-slate-200">
                        {isRtl ? 'مفتاح تفعيل العرض' : 'Demo activation key'}
                        <input
                          value={startupActivationKey}
                          onChange={(event) => setStartupActivationKey(event.target.value.toUpperCase())}
                          onKeyDown={handleStartupDemoFieldKeyDown}
                          autoComplete="off"
                          data-startup-demo-field
                          className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-sm text-white"
                        />
                      </label>
                      <button
                        type="button"
                        data-startup-demo-activate
                        onClick={() => void handleStartupDemoActivation()}
                        disabled={startupSubmitting || !startupActivationKey.trim()}
                        className="w-full rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-300 disabled:opacity-50"
                      >
                        {registrationStatus === 'deactivated'
                          ? (isRtl ? 'إعادة تفعيل العرض' : 'Reactivate Demo')
                          : (isRtl ? 'تفعيل العرض' : 'Activate Demo')}
                      </button>
                    </>
                  )}
              </div>
            )}

            {startupMode === 'register' && (
              <div className="mt-5 space-y-3">
                <label className="block text-xs font-semibold text-slate-200">
                  {isRtl ? 'رمز النظام' : 'System Code'}
                  <input
                    readOnly
                    value={systemCode}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-sm text-white"
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-200">
                  {isRtl ? 'مفتاح التسجيل' : 'Registration Key'}
                  <input
                    value={startupRegistrationKey}
                    onChange={(event) => setStartupRegistrationKey(event.target.value)}
                    autoComplete="off"
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-sm text-white"
                  />
                </label>
                <p className="text-[11px] leading-5 text-amber-200" role="note">
                  {isRtl
                    ? 'عند التفعيل، ستُستبدل حسابات الدخول الأخرى بحساب الترخيص، مع الاحتفاظ بحساب aptadmin الأساسي.'
                    : 'Activation replaces other POS login accounts with the license account. The primary aptadmin account is kept.'}
                </p>
                <button
                  type="button"
                  onClick={() => void handleStartupRegistration()}
                  disabled={startupSubmitting || !startupRegistrationKey.trim()}
                  className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {startupSubmitting
                    ? (isRtl ? 'جارٍ التفعيل...' : 'Activating...')
                    : (isRtl ? 'تفعيل التسجيل' : 'Activate Registration')}
                </button>
              </div>
            )}

            {startupError && (
              <p role="alert" className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-300">
                {startupError}
              </p>
            )}
            {startupMessage && (
              <p role="status" className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
                {startupMessage}
              </p>
            )}

            {startupMode !== 'choice' && (
              <button
                type="button"
                onClick={() => {
                  setStartupError(null);
                  setStartupMessage(null);
                  setStartupMode('choice');
                }}
                className="mt-4 w-full rounded-lg border border-slate-600 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                {isRtl ? 'رجوع' : 'Back'}
              </button>
            )}
          </section>
        </div>
      )}

      <div
        className={`login-shell relative z-10 transition-all duration-700 ease-out transform ${
          splashState === 'splash'
            ? 'opacity-0 translate-y-6 scale-95 pointer-events-none'
            : 'opacity-100 translate-y-0 scale-100'
        }`}
      >
        <aside className="login-brand-panel" aria-label="aptPOS">
          <div className="login-brand-glow" />
          <div className="relative z-10">
            <button
              type="button"
              onClick={() => {
                setStartupError(null);
                setStartupMessage(null);
                setStartupMode('choice');
              }}
              aria-label={language === 'ar' ? 'تسجيل الدخول إلى aptPOS' : 'Sign in to aptPOS'}
              className="login-brand-mark cursor-pointer transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              <ShoppingBag className="h-7 w-7 text-violet-100" />
            </button>
            <p className="login-eyebrow">
              {isRtl ? 'منصة البيع الذكية' : 'SMART RETAIL PLATFORM'}
            </p>
            <h1 className="font-display text-4xl font-extrabold tracking-tight text-white">
              apt<span className="text-violet-300">POS</span>
            </h1>
            <p className="mt-3 max-w-xs text-sm leading-6 text-slate-300">
              {t.loginSubtitle}
            </p>
          </div>

          <div className="login-feature-list relative z-10">
            <div className="login-feature">
              <ReceiptText className="h-4 w-4" />
              <span>{isRtl ? 'فواتير سريعة' : 'Fast billing'}</span>
            </div>
            <div className="login-feature">
              <PackageCheck className="h-4 w-4" />
              <span>{isRtl ? 'تحكم بالمخزون' : 'Stock control'}</span>
            </div>
            <div className="login-feature">
              <BarChart3 className="h-4 w-4" />
              <span>{isRtl ? 'تقارير واضحة' : 'Clear reports'}</span>
            </div>
          </div>
        </aside>

        <div className="login-panel login-form-panel">
          <div className="login-mobile-brand">
            <button
              type="button"
              onClick={() => {
                setStartupError(null);
                setStartupMessage(null);
                setStartupMode('choice');
              }}
              aria-label={language === 'ar' ? 'تسجيل الدخول إلى aptPOS' : 'Sign in to aptPOS'}
              className="login-logo-badge flex h-12 w-12 cursor-pointer items-center justify-center rounded-xl transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              <ShoppingBag className="h-6 w-6 text-violet-100" />
            </button>
            <span className="font-display text-xl font-extrabold text-white">
              apt<span className="text-violet-300">POS</span>
            </span>
          </div>

          <div className="mb-6">
            <p className="login-form-kicker">
              {isRtl ? 'الوصول الآمن' : 'SECURE TERMINAL'}
            </p>
            <h2 className="mt-1 text-2xl font-bold text-white">
              {isRtl ? 'مرحباً بعودتك' : 'Welcome back'}
            </h2>
            {registrationStatus === 'registered' && registeredBusinessName && (
              <p className="mt-1 break-words text-sm font-semibold text-slate-200">
                {registeredBusinessName}
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            {error && (
              <div className="login-error p-3 border rounded-lg text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-300 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="username"
                className="block text-xs font-semibold text-slate-200 mb-1"
              >
                {t.username}
              </label>
              <div className="relative">
                <User className={`w-4 h-4 text-slate-400 absolute ${isRtl ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 pointer-events-none`} />
                <input
                  ref={usernameRef}
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="off"
                  required
                  value={username}
                  onKeyDown={handleUsernameKeyDown}
                  onChange={(e) => setUsername(e.target.value)}
                  className={`login-input w-full ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'} py-2 text-sm rounded-lg focus:outline-none`}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold text-slate-200 mb-1"
              >
                {t.password}
              </label>
              <div className="relative">
                <Lock className={`w-4 h-4 text-slate-400 absolute ${isRtl ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 pointer-events-none`} />
                <input
                  ref={passwordRef}
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`login-input w-full ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'} py-2 text-sm rounded-lg focus:outline-none`}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || registrationStatusLoading || registrationStatus === 'blocked'}
              className="login-submit w-full py-3 px-4 text-sm font-semibold text-white disabled:opacity-60 transition-all flex items-center justify-center gap-2 focus:outline-none cursor-pointer"
            >
              <span>{loading ? t.signingIn : t.signIn}</span>
              {!loading && <ArrowRight className={`h-4 w-4 ${isRtl ? 'rotate-180' : ''}`} />}
            </button>
          </form>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[9px]">
            {systemCode ? (
              <p className="font-mono text-slate-400">
                {isRtl ? 'رمز النظام' : 'System Code'}: <code dir="ltr">{systemCode}</code>
              </p>
            ) : systemCodeError ? (
              <p className="text-amber-400">
                {isRtl ? 'تعذر تحميل رمز النظام.' : systemCodeError}
              </p>
            ) : <span />}
            {registrationStatus === 'registered' && (
              <span
                className="inline-flex items-center gap-1 font-bold text-emerald-400"
                role="status"
              >
                <BadgeCheck className="h-3 w-3" />
                {isRtl ? 'مسجل' : 'Registered'}
                {registeredAppVersion ? ` · ${registeredAppVersion}` : ''}
              </span>
            )}
          </div>
        </div>
        </div>
        {registrationStatus === 'blocked' && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="system-code-blocked-title"
            aria-describedby="system-code-blocked-message"
          >
            <section className="w-full max-w-md rounded-2xl border border-red-400/40 bg-slate-900 p-7 text-center shadow-2xl shadow-red-950/40">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-red-300">
                <AlertCircle className="h-7 w-7" />
              </div>
              <h2 id="system-code-blocked-title" className="text-xl font-bold text-white">
                {isRtl ? 'تم حظر رمز النظام' : 'System Code Blocked'}
              </h2>
              <p id="system-code-blocked-message" className="mt-2 text-sm text-slate-300">
                {isRtl ? 'تواصل مع مزود الخدمة.' : 'Contact Service Provider.'}
              </p>
              <p className="mt-5 rounded-lg border border-slate-700 bg-slate-950/70 px-4 py-3 font-mono text-sm text-red-200">
                {isRtl ? 'رمز النظام' : 'System Code'}: {systemCode || (isRtl ? 'جارٍ التحميل...' : 'Loading...')}
              </p>
            </section>
          </div>
        )}
    </div>
  );
};
