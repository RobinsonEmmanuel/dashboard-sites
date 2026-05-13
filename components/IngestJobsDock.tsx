'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  QueueListIcon,
  ChevronUpIcon,
  XMarkIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { parseResponseJson } from '@/lib/parse-response-json';

type JobRow = {
  id: string;
  name: string;
  state: 'waiting' | 'active' | 'delayed';
  partner?: string;
  timestamp: number;
};

function labelName(name: string) {
  if (name === 'ga4') return 'GA4';
  if (name === 'gsc') return 'Search Console';
  if (name === 'revenue-import') return 'Import CSV revenus';
  return name;
}

function stateLabel(state: JobRow['state']) {
  if (state === 'active') return 'En cours';
  if (state === 'waiting') return 'En attente';
  return 'Différé';
}

function stateStyle(state: JobRow['state']) {
  if (state === 'active') return 'bg-orange-100 text-[#c2410c] border-orange-200';
  if (state === 'waiting') return 'bg-gray-100 text-gray-700 border-gray-200';
  return 'bg-blue-50 text-blue-800 border-blue-100';
}

export default function IngestJobsDock() {
  const [open, setOpen] = useState(false);
  const [queueEnabled, setQueueEnabled] = useState<boolean | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/ingest/jobs');
      const data = (await parseResponseJson(res)) as {
        queueEnabled?: boolean;
        jobs?: JobRow[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setQueueEnabled(Boolean(data.queueEnabled));
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau');
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    const onDirty = () => void fetchJobs();
    window.addEventListener('ingest-queue-maybe-changed', onDirty);
    return () => window.removeEventListener('ingest-queue-maybe-changed', onDirty);
  }, [fetchJobs]);

  useEffect(() => {
    if (queueEnabled === false) return undefined;
    const t = window.setInterval(() => void fetchJobs(), open ? 2500 : 8000);
    return () => window.clearInterval(t);
  }, [fetchJobs, open, queueEnabled]);

  const removeJob = async (id: string) => {
    setRemovingId(id);
    setError('');
    try {
      const res = await fetch(`/api/ingest/jobs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = (await parseResponseJson(res)) as { error?: string; ok?: boolean };
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Suppression impossible');
    } finally {
      setRemovingId(null);
    }
  };

  if (queueEnabled === false) {
    return null;
  }

  const count = jobs.length;
  const showBadge = count > 0;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2 pointer-events-none">
      {open && (
        <div
          className="pointer-events-auto w-[min(100vw-2rem,20rem)] max-h-[min(70vh,22rem)] flex flex-col rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden"
          role="dialog"
          aria-label="File d’ingestion"
        >
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[#191E55] text-white shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <QueueListIcon className="w-4 h-4 shrink-0 text-white/90" />
              <span className="text-sm font-semibold truncate">File d’ingestion</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded-lg hover:bg-white/10 transition-colors"
              aria-label="Replier"
            >
              <ChevronUpIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="p-2 border-b border-gray-100 flex items-center justify-between gap-2 shrink-0">
            <span className="text-xs text-gray-500">
              {count === 0 ? 'Aucun job en attente ou en cours' : `${count} job${count > 1 ? 's' : ''}`}
            </span>
            <button
              type="button"
              onClick={() => void fetchJobs()}
              disabled={loading}
              className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40"
              aria-label="Actualiser"
            >
              <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {error && (
            <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border-b border-red-100">
              {error}
            </div>
          )}

          <ul className="overflow-y-auto flex-1 min-h-0 divide-y divide-gray-100">
            {jobs.map((j) => (
              <li
                key={j.id}
                className="flex items-start gap-2 px-3 py-2.5 text-left hover:bg-gray-50/80"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-900">{labelName(j.name)}</p>
                  <p className="text-[10px] text-gray-400 font-mono truncate mt-0.5" title={j.id}>
                    {j.id}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${stateStyle(j.state)}`}
                    >
                      {stateLabel(j.state)}
                    </span>
                    {j.partner && (
                      <span className="text-[10px] text-gray-500">{j.partner}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void removeJob(j.id)}
                  disabled={removingId === j.id}
                  className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                  title="Retirer de la file"
                  aria-label={`Retirer le job ${j.id}`}
                >
                  {removingId === j.id ? (
                    <ArrowPathIcon className="w-4 h-4 animate-spin" />
                  ) : (
                    <XMarkIcon className="w-4 h-4" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          void fetchJobs();
        }}
        className="pointer-events-auto relative flex items-center justify-center w-12 h-12 rounded-full bg-[#191E55] text-white shadow-lg border border-white/10 hover:bg-[#232861] transition-colors"
        aria-expanded={open}
        aria-label={open ? 'Fermer la file d’ingestion' : 'Ouvrir la file d’ingestion'}
      >
        <QueueListIcon className="w-5 h-5" />
        {showBadge && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.125rem] h-[1.125rem] px-1 flex items-center justify-center rounded-full bg-[#f57503] text-[10px] font-bold text-white border-2 border-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
    </div>
  );
}
