import React, { useEffect, useRef, useState } from 'react';
import { Download, File, Files, Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

const DATABASE_NAME = 'aptpos_documents';
const DATABASE_VERSION = 1;
const STORE_NAME = 'documents';
const MAX_FILE_SIZE = 5 * 1024 * 1024;

interface StoredDocument {
  id: string;
  name: string;
  type: string;
  size: number;
  addedAt: string;
  blob: Blob;
}

function openDocumentDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open local document storage.'));
  });
}

function runDocumentTransaction<T>(
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDocumentDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = createRequest(transaction.objectStore(STORE_NAME));

    transaction.oncomplete = () => {
      database.close();
      resolve(request.result);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Local document storage transaction failed.'));
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Local document storage transaction failed.'));
    };
  }));
}

const formatFileSize = (size: number) =>
  size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / (1024 * 1024)).toFixed(2)} MB`;

export const FilesView: React.FC = () => {
  const { isRtl } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshDocuments = async () => {
    const records = await runDocumentTransaction<StoredDocument[]>(
      'readonly',
      (store) => store.getAll()
    );
    setDocuments(records.sort((a, b) => b.addedAt.localeCompare(a.addedAt)));
  };

  useEffect(() => {
    let active = true;
    const loadDocuments = async () => {
      try {
        const records = await runDocumentTransaction<StoredDocument[]>(
          'readonly',
          (store) => store.getAll()
        );
        if (active) {
          setDocuments(records.sort((a, b) => b.addedAt.localeCompare(a.addedAt)));
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load local documents.');
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void loadDocuments();
    return () => {
      active = false;
    };
  }, []);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0 || isSaving) return;

    const oversizedFile = files.find((file) => file.size > MAX_FILE_SIZE);
    if (oversizedFile) {
      setError(
        isRtl
          ? `حجم الملف ${oversizedFile.name} يتجاوز الحد الأقصى 5 ميجابايت.`
          : `${oversizedFile.name} exceeds the 5 MB per-file limit.`
      );
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      for (const file of files) {
        const record: StoredDocument = {
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          addedAt: new Date().toISOString(),
          blob: file,
        };
        await runDocumentTransaction<IDBValidKey>(
          'readwrite',
          (store) => store.add(record)
        );
      }
      await refreshDocuments();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save document locally.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (document: StoredDocument) => {
    const confirmed = window.confirm(
      isRtl
        ? `هل تريد حذف الملف ${document.name}؟`
        : `Delete ${document.name} from local documents?`
    );
    if (!confirmed) return;

    setError(null);
    try {
      await runDocumentTransaction<undefined>(
        'readwrite',
        (store) => store.delete(document.id)
      );
      await refreshDocuments();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete local document.');
    }
  };

  const handleDownload = (document: StoredDocument) => {
    const url = URL.createObjectURL(document.blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = document.name;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
            <Files className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold text-slate-900">
              {isRtl ? 'الملفات' : 'Files'}
            </h1>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {isRtl ? 'احفظ المستندات المهمة محلياً. الحد الأقصى 5 ميجابايت لكل ملف.' : 'Keep important documents locally. Maximum 5 MB per file.'}
            </p>
          </div>
        </div>
        <div>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => void handleUpload(event)}
          />
          <button
            type="button"
            disabled={isSaving}
            onClick={() => inputRef.current?.click()}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            {isSaving
              ? (isRtl ? 'جارٍ الحفظ...' : 'Saving...')
              : (isRtl ? 'إضافة ملفات' : 'Add files')}
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {isLoading ? (
          <p className="py-12 text-center text-xs text-slate-500">
            {isRtl ? 'جارٍ تحميل الملفات...' : 'Loading documents...'}
          </p>
        ) : documents.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
            <File className="h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">
              {isRtl ? 'لا توجد ملفات محفوظة' : 'No saved documents'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {isRtl ? 'أضف مستنداتك المهمة، بحد أقصى 5 ميجابايت للملف.' : 'Add important documents, up to 5 MB each.'}
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-2">
            {documents.map((document) => (
              <article
                key={document.id}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xs"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <File className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-xs font-semibold text-slate-800" title={document.name}>
                    {document.name}
                  </h2>
                  <p className="mt-1 truncate text-[10px] text-slate-500">
                    {formatFileSize(document.size)} · {new Date(document.addedAt).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDownload(document)}
                  aria-label={isRtl ? `تنزيل ${document.name}` : `Download ${document.name}`}
                  title={isRtl ? 'تنزيل' : 'Download'}
                  className="rounded-lg p-2 text-blue-700 hover:bg-blue-50"
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(document)}
                  aria-label={isRtl ? `حذف ${document.name}` : `Delete ${document.name}`}
                  title={isRtl ? 'حذف' : 'Delete'}
                  className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
