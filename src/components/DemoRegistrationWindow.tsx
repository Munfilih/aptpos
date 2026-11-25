import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, KeyRound, X } from 'lucide-react';
import type { DemoAccessStatus, DemoActivationResult } from '../types/pos';
import { parseDemoActivationResult } from '../utils/demoActivation';

interface DemoRegistrationWindowProps {
  requestedBy: string;
  demoAccessStatus: DemoAccessStatus;
  onClose: () => void;
  onDemoActivated: (activation: DemoActivationResult) => void | Promise<void>;
}

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
  const [systemCode, setSystemCode] = useState('');
  const [systemCodeError, setSystemCodeError] = useState('');
  const [systemCodeCopied, setSystemCodeCopied] = useState(false);
  const [activationKey, setActivationKey] = useState('');
  const [demoPassword, setDemoPassword] = useState('');
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

  const handleCopySystemCode = async () => {
    if (!systemCode) return;
    try {
      await navigator.clipboard.writeText(systemCode);
      setSystemCodeCopied(true);
      setTimeout(() => setSystemCodeCopied(false), 2000);
    } catch {
      // ignore
    }
  };

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

  const handleActivateDemo = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    setActivationError('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/registration/demo-activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemCode,
          activationKey: activationKey.trim(),
          username: requestedBy,
          password: demoPassword,
        }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        const message = isRecord(data) && typeof data.error === 'string'
          ? data.error
          : 'Could not activate this demo.';
        throw new Error(message);
      }
      const activation = parseDemoActivationResult(data);
      if (!activation) {
        throw new Error('The activation service returned invalid demo access details.');
      }
      await onDemoActivated(activation);
    } catch (error) {
      setActivationError(
        error instanceof Error ? error.message : 'Could not activate this demo.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const title = demoAccessStatus === 'deactivated'
    ? 'Reactivate Demo'
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
              <KeyRound className="h-5 w-5" />
            </span>
            <div>
              <h2 id="registration-window-title" className="text-base font-bold text-slate-900">
                {title}
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {demoAccessStatus === 'deactivated'
                  ? 'This demo is deactivated. If your provider has reactivated it, enter the new activation key.'
                  : demoAccessStatus === 'expired'
                    ? 'Your demo period has ended. Request an extension or enter a demo key.'
                    : demoAccessStatus === 'awaiting-activation'
                      ? 'A demo key has been issued for this system. Enter it to activate the demo.'
                      : 'Request a demo key, then activate it on this system.'}
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
            <strong>Demo expired.</strong> Request a demo key extension to continue using aptPOS.
          </div>
        )}

        <form
          onSubmit={(event) => void handleActivateDemo(event)}
          className="space-y-4 p-5"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-700">
              System Code
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                value={loadingCode ? 'Loading system code…' : systemCode}
                readOnly
                aria-label="System Code"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-800 select-all focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={() => void handleCopySystemCode()}
                disabled={!systemCode || loadingCode}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Copy System Code"
              >
                {systemCodeCopied ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-600" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 text-slate-500" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            {systemCodeError && (
              <p role="alert" className="mt-1 text-xs text-rose-700">
                {systemCodeError}
              </p>
            )}
          </div>

          <label className="block text-xs font-semibold text-slate-700">
            Demo Key
            <input
              required
              autoComplete="off"
              value={activationKey}
              onChange={(event) => setActivationKey(event.target.value)}
              aria-label="Demo Key"
              placeholder="Enter demo activation key"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <label className="block text-xs font-semibold text-slate-700">
            Demo Account Password
            <input
              required
              type="password"
              autoComplete="new-password"
              value={demoPassword}
              onChange={(event) => setDemoPassword(event.target.value)}
              aria-label="Demo Account Password"
              placeholder="Enter demo password"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>

          {requestMessage && (
            <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">
              {requestMessage}
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
            {demoAccessStatus === 'deactivated'
              ? 'Enter the new activation key provided by aptadmin to restore demo access.'
              : 'An internet connection is required to send this request to aptPOS User Management. After approval, aptadmin will generate a key for this system code and share it with you.'}
          </p>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            {demoAccessStatus !== 'awaiting-activation' && demoAccessStatus !== 'deactivated' && (
              <button
                type="button"
                onClick={() => void handleRequestDemo()}
                disabled={submitting || loadingCode || !systemCode || Boolean(systemCodeError)}
                className="rounded-lg border border-blue-200 px-4 py-2.5 text-sm font-semibold text-blue-800 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Please wait…' : demoAccessStatus === 'expired' ? 'Request Extension' : 'Request Demo Key'}
              </button>
            )}
            <button
              type="submit"
              disabled={submitting || loadingCode || !systemCode || Boolean(systemCodeError) || !activationKey.trim()}
              className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting
                ? 'Activating…'
                : demoAccessStatus === 'deactivated'
                  ? 'Reactivate Demo'
                  : 'Activate Demo'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
