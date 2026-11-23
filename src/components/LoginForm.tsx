import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, Lock, User, ShoppingBag, Sparkles, Globe, ArrowRight, ReceiptText, BarChart3, PackageCheck } from 'lucide-react';
import type { DemoAccessStatus, UserSession } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';

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
  const loginFormRef = useRef<HTMLFormElement>(null);
  const adminLogoActivationRef = useRef(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  useEffect(() => {
    if (initialError) {
      setError(initialError);
    }
  }, [initialError]);

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

  const handleBrandActivation = () => {
    if (username.trim().toLowerCase() !== 'aptadmin') {
      usernameRef.current?.focus();
      return;
    }

    if (!password) {
      passwordRef.current?.focus();
      return;
    }

    if (!loading) {
      adminLogoActivationRef.current = true;
      loginFormRef.current?.requestSubmit();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (
      username.trim().toLowerCase() === 'aptadmin' &&
      !adminLogoActivationRef.current
    ) {
      setError('Invalid username or password.');
      return;
    }
    adminLogoActivationRef.current = false;

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
          onLoginSuccess(data.user);
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
              onClick={handleBrandActivation}
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
              onClick={handleBrandActivation}
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
          </div>

          <form ref={loginFormRef} onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
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
              disabled={loading}
              className="login-submit w-full py-3 px-4 text-sm font-semibold text-white disabled:opacity-60 transition-all flex items-center justify-center gap-2 focus:outline-none cursor-pointer"
            >
              <span>{loading ? t.signingIn : t.signIn}</span>
              {!loading && <ArrowRight className={`h-4 w-4 ${isRtl ? 'rotate-180' : ''}`} />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
