'use client';

import { useState } from 'react';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ClockIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import RevenueCsvImport from '@/components/RevenueCsvImport';

type SiteResultGA4 = {
  site: string;
  inserted: number;
  errors: string[];
};

type SiteResultGSC = {
  site: string;
  dailyRecords: number;
  pageRecords: number;
  queryRecords: number;
  errors: string[];
};

type IngestResultGA4 = {
  mode: string;
  period: { startDate: string; endDate: string };
  sitesProcessed: number;
  totalRecords: number;
  errors: number;
  details: SiteResultGA4[];
};

type IngestResultGSC = {
  mode: string;
  period: { startDate: string; endDate: string };
  sitesProcessed: number;
  totalDaily: number;
  totalPages: number;
  totalQueries: number;
  errors: number;
  details: SiteResultGSC[];
};

type IngestResult = IngestResultGA4 | IngestResultGSC;

type JobStatus = 'idle' | 'running' | 'done' | 'error';

interface Job {
  label: string;
  endpoint: string;
  status: JobStatus;
  result: IngestResult | null;
  error: string;
}

const INITIAL_JOBS: Job[] = [
  { label: 'Google Analytics 4', endpoint: '/api/ingest/ga4', status: 'idle', result: null, error: '' },
  { label: 'Google Search Console', endpoint: '/api/ingest/gsc', status: 'idle', result: null, error: '' },
];

export default function IngestionPage() {
  const [jobs, setJobs] = useState<Job[]>(INITIAL_JOBS);
  const [mode, setMode] = useState<'incremental' | 'full' | 'smart'>('smart');

  const updateJob = (index: number, patch: Partial<Job>) =>
    setJobs((prev) => prev.map((j, i) => (i === index ? { ...j, ...patch } : j)));

  const runJob = async (index: number) => {
    updateJob(index, { status: 'running', result: null, error: '' });
    try {
      const res = await fetch(jobs[index].endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        updateJob(index, { status: 'error', error: data.error || 'Erreur inconnue' });
      } else {
        updateJob(index, { status: 'done', result: data });
      }
    } catch (err) {
      updateJob(index, { status: 'error', error: String(err) });
    }
  };

  const runAll = async () => {
    for (let i = 0; i < jobs.length; i++) {
      await runJob(i);
    }
  };

  const isAnyRunning = jobs.some((j) => j.status === 'running');

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Synchronisation des données</h1>
        <p className="text-gray-500 mt-1">Ingestion manuelle depuis Google Analytics 4 et Google Search Console</p>
      </div>

      {/* Mode selector */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-3">Mode d'ingestion</p>
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => setMode('smart')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              mode === 'smart'
                ? 'bg-[#191E55] text-white border-[#191E55]'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <BoltIcon className="w-4 h-4" />
            Smart — depuis dernière synchro
          </button>
          <button
            onClick={() => setMode('incremental')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              mode === 'incremental'
                ? 'bg-[#191E55] text-white border-[#191E55]'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <ArrowPathIcon className="w-4 h-4" />
            Incrémental (3 derniers jours)
          </button>
          <button
            onClick={() => setMode('full')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              mode === 'full'
                ? 'bg-[#191E55] text-white border-[#191E55]'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <ClockIcon className="w-4 h-4" />
            Historique complet (740 jours)
          </button>
        </div>
        <p className="text-xs mt-3 px-3 py-2 rounded-lg border
          {mode === 'smart' ? 'text-blue-700 bg-blue-50 border-blue-200' : mode === 'full' ? 'text-amber-600 bg-amber-50 border-amber-200' : 'text-gray-500 bg-gray-50 border-gray-200'}">
          {mode === 'smart' && 'Reprend automatiquement depuis la dernière date en base pour chaque site. Premier lancement = historique complet automatique.'}
          {mode === 'incremental' && 'Récupère uniquement les 3 derniers jours. Utile pour les mises à jour rapides.'}
          {mode === 'full' && "Recharge les 740 derniers jours pour tous les sites. Peut prendre plusieurs minutes."}
        </p>
      </div>

      {/* Jobs */}
      <div className="space-y-4 mb-6">
        {jobs.map((job, i) => (
          <div key={job.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <StatusIcon status={job.status} />
                <div>
                  <p className="font-semibold text-gray-900">{job.label}</p>
                  <p className="text-xs text-gray-400">
                    {job.endpoint}
                  </p>
                </div>
              </div>
              <button
                onClick={() => runJob(i)}
                disabled={isAnyRunning}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-[#f57503] rounded-lg hover:bg-[#e06a02] transition-colors disabled:opacity-40"
              >
                <ArrowPathIcon className={`w-4 h-4 ${job.status === 'running' ? 'animate-spin' : ''}`} />
                {job.status === 'running' ? 'En cours…' : 'Lancer'}
              </button>
            </div>

            {/* Résultat */}
            {job.status === 'done' && job.result && (
              <div className="border-t border-gray-100 pt-4">
                {'totalRecords' in job.result ? (
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <Stat label="Sites traités" value={job.result.sitesProcessed} />
                    <Stat label="Enregistrements" value={job.result.totalRecords} />
                    <Stat label="Erreurs" value={job.result.errors} highlight={job.result.errors > 0} />
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-3 mb-4">
                    <Stat label="Sites traités" value={(job.result as IngestResultGSC).sitesProcessed} />
                    <Stat label="Jours" value={(job.result as IngestResultGSC).totalDaily} />
                    <Stat label="Pages" value={(job.result as IngestResultGSC).totalPages} />
                    <Stat label="Requêtes" value={(job.result as IngestResultGSC).totalQueries} />
                  </div>
                )}
                <p className="text-xs text-gray-400 mb-3">
                  Période : {job.result.period.startDate} → {job.result.period.endDate}
                </p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {job.result.details.map((d) => (
                    <div key={d.site} className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-gray-50">
                      <span className="text-gray-700 font-medium">{d.site}</span>
                      <div className="flex items-center gap-3">
                        {'inserted' in d
                          ? <span className="text-gray-500">{d.inserted} enreg.</span>
                          : <span className="text-gray-500">{(d as SiteResultGSC).dailyRecords}j · {(d as SiteResultGSC).pageRecords}p · {(d as SiteResultGSC).queryRecords}q</span>
                        }
                        {d.errors.length > 0 && (
                          <span className="text-red-500 truncate max-w-64">{d.errors[0]}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {job.status === 'error' && (
              <div className="border-t border-gray-100 pt-3">
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {job.error}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Bouton tout lancer */}
      <button
        onClick={runAll}
        disabled={isAnyRunning}
        className="flex items-center gap-2 px-5 py-3 text-sm font-medium text-white bg-[#191E55] rounded-lg hover:bg-[#151a45] transition-colors disabled:opacity-40"
      >
        <ArrowPathIcon className={`w-4 h-4 ${isAnyRunning ? 'animate-spin' : ''}`} />
        {isAnyRunning ? 'Synchronisation en cours…' : 'Tout synchroniser'}
      </button>

      <div className="mt-8">
        <RevenueCsvImport />
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: JobStatus }) {
  if (status === 'running') return <ArrowPathIcon className="w-5 h-5 text-blue-500 animate-spin" />;
  if (status === 'done') return <CheckCircleIcon className="w-5 h-5 text-green-500" />;
  if (status === 'error') return <ExclamationCircleIcon className="w-5 h-5 text-red-500" />;
  return <div className="w-5 h-5 rounded-full border-2 border-gray-200" />;
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="bg-gray-50 rounded-lg px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${highlight ? 'text-red-600' : 'text-gray-900'}`}>
        {value.toLocaleString('fr-FR')}
      </p>
    </div>
  );
}
