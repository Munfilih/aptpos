export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string }
  | { state: 'downloading'; version: string; percent: number; releaseNotes?: string }
  | { state: 'downloaded'; version: string; releaseNotes?: string }
  | { state: 'backing-up'; version: string; releaseNotes?: string }
  | { state: 'up-to-date'; version: string }
  | { state: 'installing' }
  | { state: 'error'; message: string };
