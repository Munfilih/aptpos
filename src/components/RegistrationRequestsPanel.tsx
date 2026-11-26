import React, { useState } from 'react';
import { Check, RefreshCw, X } from 'lucide-react';
import type {
  RegistrationRequest,
  RegistrationRequestStatus,
  RegistrationRequestType,
} from '../types/pos';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRegistrationRequest(value: unknown): value is RegistrationRequest {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    (value.requestType === 'demo' || value.requestType === 'license') &&
    typeof value.systemCode === 'string' &&
    typeof value.submittedKey === 'string' &&
    typeof value.requestedBy === 'string' &&
    (value.status === 'pending' || value.status === 'approved' || value.status === 'rejected') &&
    typeof value.createdAt === 'string' &&
    (typeof value.reviewedAt === 'string' || value.reviewedAt === null) &&
    (typeof value.reviewedBy === 'string' || value.reviewedBy === null)
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error('The registration service returned an invalid response.');
  }
}

function responseError(data: unknown, fallback: string): string {
  return isRecord(data) && typeof data.error === 'string' ? data.error : fallback;
}

export const RegistrationRequestsPanel: React.FC = () => {
  const [adminPassword, setAdminPassword] = useState('');
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState<number | null>(null);

  const loadRequests = async () => {
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/registration/admin/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(responseError(data, 'Could not load registration requests.'));
      if (!Array.isArray(data) || !data.every(isRegistrationRequest)) {
        throw new Error('The registration service returned an invalid request list.');
      }
      setRequests(data);
      setLoaded(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not load registration requests.'
      );
    } finally {
      setLoading(false);
    }
  };

  const reviewRequest = async (
    id: number,
    status: Exclude<RegistrationRequestStatus, 'pending'>
  ) => {
    setError('');
    setReviewingId(id);
    try {
      const response = await fetch(`/api/registration/admin/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword, status }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(responseError(data, 'Could not review this request.'));
      await loadRequests();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Could not review this request.'
      );
    } finally {
      setReviewingId(null);
    }
  };

  const requestTypeLabel = (type: RegistrationRequestType) =>
    type === 'demo' ? 'Demo activation' : 'License registration';

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Registration Requests</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Review requests stored on this POS installation. New demo activations and extensions are managed in User Management.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="min-w-0 flex-1 text-xs font-semibold text-slate-700">
          aptadmin password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={adminPassword}
            onChange={(event) => setAdminPassword(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <button
          type="button"
          onClick={() => void loadRequests()}
          disabled={loading || !adminPassword}
          className="mt-auto inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loaded ? 'Refresh Requests' : 'Load Requests'}
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
          {error}
        </p>
      )}

      {loaded && (
        <div className="space-y-3">
          {requests.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">
              No registration requests have been received.
            </p>
          ) : requests.map((request) => (
            <article key={request.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {requestTypeLabel(request.requestType)}
                  </h3>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Request #{request.id} · {request.requestedBy} · {new Date(request.createdAt).toLocaleString('en-GB')}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${
                  request.status === 'pending'
                    ? 'bg-amber-100 text-amber-800'
                    : request.status === 'approved'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-rose-100 text-rose-800'
                }`}>
                  {request.status}
                </span>
              </div>

              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="font-semibold text-slate-500">System Code</dt>
                  <dd className="mt-1 break-all font-mono text-slate-800">{request.systemCode}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-semibold text-slate-500">
                    {request.requestType === 'demo' ? 'Demo Key' : 'License Key'}
                  </dt>
                  <dd className="mt-1 break-all font-mono text-slate-800">{request.submittedKey}</dd>
                </div>
              </dl>

              {request.status === 'pending' && (
                <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => void reviewRequest(request.id, 'rejected')}
                    disabled={reviewingId !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => void reviewRequest(request.id, 'approved')}
                    disabled={reviewingId !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Approve
                  </button>
                </div>
              )}
              {request.reviewedAt && request.reviewedBy && (
                <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                  Reviewed by {request.reviewedBy} on {new Date(request.reviewedAt).toLocaleString('en-GB')}.
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
