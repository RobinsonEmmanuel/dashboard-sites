'use client';

import { useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowUpTrayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  DocumentArrowUpIcon,
} from '@heroicons/react/24/outline';
import type { AffiliationPartner } from '@/lib/models/revenue';

const PARTNERS: { id: AffiliationPartner; label: string; color: string }[] = [
  { id: 'getyourguide', label: 'GetYourGuide', color: '#FF5533' },
  { id: 'booking', label: 'Booking.com', color: '#003580' },
  { id: 'tiqets', label: 'Tiqets', color: '#ff6b35' },
  { id: 'discovercars', label: 'DiscoverCars', color: '#00a651' },
  { id: 'sendowl', label: 'SendOwl', color: '#7c3aed' },
];

function fmtEur(n: number) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(n);
}

interface ImportResult {
  partner: AffiliationPartner;
  inserted: number;
  duplicates: number;
  skipped: number;
  cancelled?: number;
  errors: string[];
  totalCommission: number;
  totalCommissionWithCancelled?: number;
  detectedColumns?: string[];
  message: string;
}

function PartnerBadge({ partner }: { partner: AffiliationPartner }) {
  const p = PARTNERS.find((x) => x.id === partner);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: p ? `${p.color}20` : '#f3f4f6', color: p?.color ?? '#6b7280' }}
    >
      {p?.label ?? partner}
    </span>
  );
}

export default function RevenueCsvImport({
  onImportSuccess,
}: {
  onImportSuccess?: (result: ImportResult) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Import state ---
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [detectedPartner, setDetectedPartner] = useState<AffiliationPartner | null>(null);
  const [partnerOverride, setPartnerOverride] = useState<AffiliationPartner | ''>('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState('');

  const effectivePartner = partnerOverride || detectedPartner;
  const acceptedFileTypes = useMemo(() => '.csv,.tsv,.txt', []);

  // --- detect partner via CSV headers (preview) ---
  const handleFileSelect = async (f: File) => {
    setFile(f);
    setImportResult(null);
    setImportError('');
    setDetectedPartner(null);
    setPartnerOverride('');

    const slice = f.slice(0, 1000);
    const text = await slice.text();
    const firstLine = text.split('\n')[0] ?? '';
    const headers = firstLine
      .split(/[,;\t]/)
      .map((h) => h.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);

    const qs = new URLSearchParams({ headers: headers.join(',') });
    const res = await fetch(`/api/revenue/import?${qs}`);
    const data = await res.json();
    setDetectedPartner((data.partner ?? null) as AffiliationPartner | null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setImportError('');
    setImportResult(null);

    try {
      const fd = new FormData();
      fd.append('file', file);
      if (partnerOverride) fd.append('partner', partnerOverride);

      const res = await fetch('/api/revenue/import', { method: 'POST', body: fd });
      const data = await res.json();

      if (!res.ok) {
        setImportError(data.error || 'Erreur lors de l\'import');
        return;
      }

      setImportResult(data as ImportResult);
      onImportSuccess?.(data as ImportResult);
    } catch {
      setImportError('Erreur réseau');
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
        <DocumentArrowUpIcon className="w-5 h-5 text-[#f57503]" />
        <h2 className="text-base font-semibold text-gray-900">Import CSV affiliation</h2>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Drop zone */}
          <div>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                dragOver
                  ? 'border-[#f57503] bg-orange-50'
                  : 'border-gray-200 hover:border-[#f57503] hover:bg-orange-50/30'
              }`}
            >
              <ArrowUpTrayIcon className="w-8 h-8 mx-auto mb-3 text-gray-400" />

              {file ? (
                <div>
                  <p className="text-sm font-medium text-gray-900">{file.name}</p>
                  <p className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(1)} Ko</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-gray-700">Glissez votre CSV ici</p>
                  <p className="text-xs text-gray-400 mt-1">ou cliquez pour sélectionner</p>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept={acceptedFileTypes}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }}
              />
            </div>

            {file && (
              <div className="mt-4 p-3 bg-gray-50 rounded-xl">
                <p className="text-xs font-medium text-gray-500 mb-2">Partenaire détecté</p>
                <div className="flex items-center gap-3">
                  {detectedPartner ? (
                    <PartnerBadge partner={detectedPartner} />
                  ) : (
                    <span className="text-xs text-gray-400">Non reconnu automatiquement</span>
                  )}

                  <select
                    value={partnerOverride}
                    onChange={(e) => setPartnerOverride(e.target.value as AffiliationPartner | '')}
                    className="ml-auto text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                  >
                    <option value="">Détection auto</option>
                    {PARTNERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Result + submit */}
          <div className="flex flex-col justify-between gap-4">
            <div className="space-y-3">
              {importResult && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircleIcon className="w-5 h-5 text-green-600" />
                    <p className="text-sm font-semibold text-green-800">Import réussi</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-green-700">
                    <span>
                      Insérés : <strong>{importResult.inserted}</strong>
                    </span>
                    <span>
                      Doublons : <strong>{importResult.duplicates}</strong>
                    </span>
                    <span>
                      Ignorés : <strong>{importResult.skipped}</strong>
                    </span>
                    {importResult.cancelled != null && importResult.cancelled > 0 && (
                      <span>
                        Annulés : <strong>{importResult.cancelled}</strong>
                      </span>
                    )}

                    <span className="col-span-2 border-t border-green-200 pt-1 mt-1">
                      Commission nette : <strong>{fmtEur(importResult.totalCommission)}</strong>
                      {importResult.cancelled != null &&
                        importResult.cancelled > 0 &&
                        importResult.totalCommissionWithCancelled != null && (
                          <span className="text-green-500 ml-2">
                            (brut : {fmtEur(importResult.totalCommissionWithCancelled)})
                          </span>
                        )}
                    </span>
                  </div>

                  {importResult.errors.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-orange-600 cursor-pointer">
                        {importResult.errors.length} avertissement(s)
                      </summary>
                      <ul className="mt-1 text-xs text-orange-600 space-y-0.5">
                        {importResult.errors.slice(0, 5).map((e, i) => (
                          <li key={i}>• {e}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              {importError && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                  <ExclamationTriangleIcon className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700">{importError}</p>
                </div>
              )}

              <div className="p-3 bg-blue-50 rounded-xl text-xs text-blue-700 space-y-1">
                <p className="font-medium mb-1">Formats acceptés :</p>
                {PARTNERS.map((p) => (
                  <div key={p.id} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                    {p.label}
                  </div>
                ))}
                <p className="text-blue-500 mt-2">
                  Note : les revenus Canarias avec code <strong>CAL</strong> sont attribués au site
                  "Canarias".
                </p>
              </div>
            </div>

            <button
              onClick={handleImport}
              disabled={!file || !effectivePartner || importing}
              className="w-full py-2.5 text-sm font-medium text-white bg-[#f57503] rounded-xl hover:bg-[#e06a02] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {importing ? (
                <>
                  <ArrowPathIcon className="w-4 h-4 animate-spin" />
                  Import…
                </>
              ) : (
                'Ingérer la donnée'
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

