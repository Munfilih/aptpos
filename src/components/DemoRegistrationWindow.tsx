import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, KeyRound, LockKeyhole, X } from 'lucide-react';
import type { DemoAccessStatus } from '../types/pos';

interface DemoRegistrationWindowProps {
  requestedBy: string;
  demoAccessStatus: DemoAccessStatus;
  onClose: () => void;
  onDemoActivated: (expiresAt: string) => void;
}

type RegistrationMode = 'options' | 'demo' | 'license';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body.trim()) return null;

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`The registration service returned an invalid response (HTTP ${response.status}).`);
  }
}

export const DemoRegistrationWindow: React.FC<DemoRegistrationWindowProps> = ({
  requestedBy,
  demoAccessStatus,
  onClose,
  onDemoActivated,
}) => {
  const dialogRef = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<RegistrationMode>('options');
  const [systemCode, setSystemCode] = useState('');
  const [systemCodeError, setSystemCodeError] = useState('');
  const [activationKey, setActivationKey] = useState('');
  const [requestError, setRequestError] = useState('');
  const [requestMessage, setRequestMessage] = useState('');
  const [activationError, setActivationError] = useState('');
  const [loadingCode, setLoadingCode] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const getFocusableElements = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
      ));

    getFocusableElements()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    let active = true;
    void fetch('/api/registration/system-code')
      .then(async (response) => {
        const data = await readJsonResponse(response);
        const code = isRecord(data) && typeof data.systemCode === 'string'
          ? data.systemCode
          : '';
        if (!response.ok || !code) {
          const message = isRecord(data) && typeof data.error === 'string'
            ? data.error
            : "Could not load this installation's system code.";
          throw new Error(message);
        }
        if (active) setSystemCode(code);
      })
      .catch((error: unknown) => {
        if (active) {
          setSystemCodeError(
            error instanceof Error ? error.message : 'Could not load the system code.'
          );
        }
      })
      .finally(() => {
        if (active) setLoadingCode(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleRequestDemo = async () => {
    setRequestError('');
    setRequestMessage('');
    setSubmitting(true);
    try {
      const requestType = demoAccessStatus === 'expired' ? 'extension' : 'demo';
      const response = await fetch('/api/registration/demo-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestType,
          systemCode,
          requestedBy,
        }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        const message = isRecord(data) && typeof data.error === 'string'
          ? data.error
          : response.status === 404
            ? 'The POS demo-request service is unavailable. Restart or update aptPOS, then try again.'
            : `Could not submit the demo request (HTTP ${response.status}).`;
        throw new Error(message);
      }
      if (!isRecord(data) ||
        (typeof data.requestId !== 'string' && typeof data.requestId !== 'number')) {
        throw new Error(
          'The demo request returned an empty or invalid response. Check Demo Key Requests before retrying.'
        );
      }
      setRequestMessage('Demo Key Request Sent. Contact Service Provider');
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : 'Could not submit the demo request.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivateDemo = async () => {
    setActivationError('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/registration/demo-activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemCode, activationKey }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        const message = isRecord(data) && typeof data.error === 'string'
          ? data.error
          : 'Could not activate this demo.';
        throw new Error(message);
      }
      if (!isRecord(data) || typeof data.expiresAt !== 'string') {
        throw new Error('The activation service returned an invalid expiration date.');
      }
      onDemoActivated(data.expiresAt);
    } catch (error) {
      setActivationError(
        error instanceof Error ? error.message : 'Could not activate this demo.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitLicenseRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mode !== 'license') return;
    setRequestError('');
    setRequestMessage('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/registration/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestType: 'license',
          systemCode,
          submittedKey: activationKey,
          requestedBy,
        }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        const message = isRecord(data) && typeof data.error === 'string'
          ? data.error
          : `Could not submit the license request (HTTP ${response.status}).`;
        throw new Error(message);
      }
      if (!isRecord(data) ||
        (typeof data.requestId !== 'string' && typeof data.requestId !== 'number')) {
        throw new Error('The registration service returned an empty or invalid response.');
      }
      setRequestMessage('License registration request received. It is waiting for approval.');
      setActivationKey('');
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : 'Could not submit the license request.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const isLicense = mode === 'license';
  const title = mode === 'options'
    ? 'Register aptPOS'
    : isLicense
      ? 'Register With License Key'
      : demoAccessStatus === 'expired'
        ? 'Demo Expired'
        : 'Activate Demo';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 p-4">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="registration-window-title"
        tabIndex={-1}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-blue-50 p-2.5 text-blue-700">
              <LockKeyhole className="h-5 w-5" />
            </span>
            <div>
              <h2 id="registration-window-title" className="text-base font-bold text-slate-900">
                {title}
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {mode === 'options'
                  ? 'Choose how you want to register this aptPOS installation.'
                  : 'Your request will be sent to aptadmin for approval.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close registration"
            className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {demoAccessStatus === 'expired' && (
          <div
            role="alert"
            className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"
          >
            <strong>Demo expired.</strong> Register to continue using aptPOS.
          </div>
        )}

        {mode === 'options' ? (
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setRequestError('');
                setRequestMessage('');
                setActivationError('');
                setMode('demo');
              }}
              className="flex min-h-36 flex-col items-start rounded-xl border border-slate-200 p-4 text-left transition hover:border-blue-400 hover:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <span className="rounded-lg bg-blue-50 p-2 text-blue-700">
                <KeyRound className="h-5 w-5" />
              </span>
              <span className="mt-3 text-sm font-bold text-slate-900">Activate Demo</span>
              <span className="mt-1 text-xs leading-5 text-slate-500">
                Request a generated demo key, then activate it on this system.
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setRequestError('');
                setRequestMessage('');
                setActivationError('');
                setMode('license');
              }}
              className="flex min-h-36 flex-col items-start rounded-xl border border-slate-200 p-4 text-left transition hover:border-blue-400 hover:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <span className="rounded-lg bg-violet-50 p-2 text-violet-700">
                <LockKeyhole className="h-5 w-5" />
              </span>
              <span className="mt-3 text-sm font-bold text-slate-900">Register With License Key</span>
              <span className="mt-1 text-xs leading-5 text-slate-500">
                Submit a license key and system code for approval.
              </span>
            </button>
            {systemCodeError && (
              <p role="alert" className="sm:col-span-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
                {systemCodeError}
              </p>
            )}
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              if (isLicense) {
                void handleSubmitLicenseRequest(event);
              } else {
                event.preventDefault();
                void handleActivateDemo();
              }
            }}
            className="space-y-4 p-5"
          >
            <button
              type="button"
              onClick={() => {
                setMode('options');
                setActivationKey('');
                setRequestError('');
                setRequestMessage('');
                setActivationError('');
              }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-blue-700"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to registration options
            </button>
            <label className="block text-xs font-semibold text-slate-700">
              System Code
              <input
                value={loadingCode ? 'Loading system code…' : systemCode}
                readOnly
                aria-label="System Code"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-800"
              />
            </label>
            {(isLicense || demoAccessStatus !== 'expired') && (
              <label className="block text-xs font-semibold text-slate-700">
                {isLicense ? 'License Key' : 'Demo Key'}
                <input
                  required
                  autoComplete="off"
                  value={activationKey}
                  onChange={(event) => setActivationKey(event.target.value)}
                  aria-label={isLicense ? 'License Key' : 'Demo Key'}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </label>
            )}
            {requestMessage && (
              <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">
                {requestMessage}
              </p>
            )}
            {systemCodeError && (
              <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
                {systemCodeError}
              </p>
            )}
            {requestError && (
              <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
                {requestError}
              </p>
            )}
            {activationError && (
              <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
                {activationError}
              </p>
            )}
            <p className="text-xs leading-5 text-slate-500">
              {isLicense
                ? 'Your license request will be sent to aptadmin for review.'
                : demoAccessStatus === 'expired'
                  ? 'Your demo has expired. Register with a license key to continue using aptPOS.'
                  : 'An internet connection is required to send this request to aptPOS User Management. After approval, aptadmin will generate a key for this system code and share it with you.'}
            </p>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              {isLicense ? (
                <button
                  type="submit"
                  disabled={submitting || loadingCode || !systemCode || Boolean(systemCodeError) || !activationKey}
                  className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? 'Submitting…' : 'Request Approval'}
                </button>
              ) : demoAccessStatus === 'expired' ? (
                <button
                  type="button"
                  onClick={() => {
                    setActivationKey('');
                    setRequestError('');
                    setRequestMessage('');
                    setActivationError('');
                    setMode('license');
                  }}
                  className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
                >
                  Register to Continue
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void handleRequestDemo()}
                    disabled={submitting || loadingCode || !systemCode || Boolean(systemCodeError)}
                    className="rounded-lg border border-blue-200 px-4 py-2.5 text-sm font-semibold text-blue-800 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? 'Please wait…' : 'Request Demo Key'}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || loadingCode || !systemCode || Boolean(systemCodeError) || !activationKey}
                    className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? 'Activating…' : 'Activate Demo'}
                  </button>
                </>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
};
