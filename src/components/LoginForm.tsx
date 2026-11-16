import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, Lock, User, ShoppingBag, Sparkles, Globe } from 'lucide-react';
import type { UserSession } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';

interface LoginFormProps {
  onLoginSuccess: (user: UserSession) => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onLoginSuccess }) => {
  const { t, language, toggleLanguage, isRtl } = useLanguage();
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening screen fade animation state
  const [splashState, setSplashState] = useState<'splash' | 'fading' | 'ready'>('splash');

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

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

  const handleUsernameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      passwordRef.current?.focus();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
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

      onLoginSuccess(data.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-slate-900 px-4 py-12 relative overflow-hidden" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Top right language switcher on login screen */}
      <div className="absolute top-4 right-4 z-20">
        <button
          type="button"
          onClick={toggleLanguage}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer backdrop-blur-xs"
        >
          <Globe className="w-3.5 h-3.5 text-blue-400" />
          <span>{language === 'en' ? 'العربية' : 'English'}</span>
        </button>
      </div>

      {/* Opening Splash Screen with graceful Fade Animation */}
      {splashState !== 'ready' && (
        <div
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 transition-opacity duration-700 ease-in-out ${
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
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-2xl shadow-blue-500/30 animate-pulse">
                <ShoppingBag className="w-10 h-10 text-white" />
              </div>
              <div className="absolute -top-1.5 -right-1.5 w-7 h-7 rounded-full bg-blue-500/20 border border-blue-400/40 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-blue-300 animate-spin" style={{ animationDuration: '6s' }} />
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

      {/* Subtle background grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />

      <div
        className={`w-full max-w-sm relative z-10 transition-all duration-700 ease-out transform ${
          splashState === 'splash'
            ? 'opacity-0 translate-y-6 scale-95 pointer-events-none'
            : 'opacity-100 translate-y-0 scale-100'
        }`}
      >
        {/* Logo & Brand Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/25 mx-auto mb-3">
            <ShoppingBag className="w-8 h-8 text-white" />
          </div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-white">
            apt<span className="text-blue-400">POS</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {t.loginSubtitle}
          </p>
        </div>

        {/* Login Card - Clean: only Username, Password, Sign In */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden p-6">
          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="username"
                className="block text-xs font-semibold text-slate-700 mb-1"
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
                  autoFocus
                  value={username}
                  onKeyDown={handleUsernameKeyDown}
                  onChange={(e) => setUsername(e.target.value)}
                  className={`w-full ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'} py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700`}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold text-slate-700 mb-1"
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
                  className={`w-full ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'} py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700`}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 cursor-pointer"
            >
              <span>{loading ? t.signingIn : t.signIn}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
