// HU-ASMS: Delivery Actions & Manifest Modal Client Component
'use client';

import React, { useState } from 'react';
import { dispatchDelivery, acknowledgeDelivery, getDeliveryPackageManifest } from './actions';
import { Button } from '../../../components/ui/button';
import { Send, CheckCircle2, FileText, ExternalLink, X, Copy, Check } from 'lucide-react';
import { formatFileSize } from '@hu-asms/shared';

export function DeliveryActionsClient({ delivery }: { delivery: any }) {
  const [loading, setLoading] = useState(false);
  const [manifestModalOpen, setManifestModalOpen] = useState(false);
  const [manifestData, setManifestData] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const handleDispatch = async () => {
    const notes = prompt('Enter dispatch confirmation notes (e.g. "Forwarded via Telegram to Dr. Michael"):');
    if (notes === null) return;

    setLoading(true);
    try {
      const res = await dispatchDelivery(delivery.id, notes);
      if (!res.success) alert(`Error: ${res.error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledge = async () => {
    if (!confirm('Confirm teacher acknowledgment of this submission batch?')) return;

    setLoading(true);
    try {
      const res = await acknowledgeDelivery(delivery.id);
      if (!res.success) alert(`Error: ${res.error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleViewManifest = async () => {
    setLoading(true);
    try {
      const res = await getDeliveryPackageManifest(delivery.id);
      if (res.error) {
        alert(`Error loading manifest: ${res.error}`);
      } else {
        setManifestData(res);
        setManifestModalOpen(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const copyTelegramText = () => {
    if (!manifestData) return;
    const d = manifestData.delivery;
    let text = `📦 *HU-ASMS Delivery Package: ${d.course?.title}*\n` +
      `*Project:* ${d.project?.title}\n` +
      `*Scope:* ${d.section?.academic_year?.name} — ${d.section?.name}\n` +
      `*Items in Batch:* ${d.batch_count} submissions\n` +
      `───────────────────────────\n\n`;

    manifestData.items.forEach((item: any, idx: number) => {
      text += `${idx + 1}. *${item.submitterName}* — \`${item.fileName}\` (${formatFileSize(item.fileSizeBytes)})\n` +
        `📥 [Download File](${item.signedUrl})\n\n`;
    });

    text += `_Note: Download links expire in 15 minutes for institutional data protection._`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs gap-1.5"
          onClick={handleViewManifest}
          isLoading={loading}
        >
          <FileText className="w-3.5 h-3.5 text-slate-500" />
          <span>Manifest</span>
        </Button>

        {delivery.status === 'prepared' && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="text-xs gap-1.5 bg-emerald-700 hover:bg-emerald-800"
            onClick={handleDispatch}
            isLoading={loading}
          >
            <Send className="w-3.5 h-3.5" />
            <span>Mark Sent</span>
          </Button>
        )}

        {delivery.status === 'sent' && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="text-xs gap-1.5 bg-purple-700 hover:bg-purple-800"
            onClick={handleAcknowledge}
            isLoading={loading}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-purple-200" />
            <span>Acknowledge</span>
          </Button>
        )}
      </div>

      {/* Manifest Modal */}
      {manifestModalOpen && manifestData && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden border border-slate-200">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-base font-bold text-slate-900">Delivery Package Manifest</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Temporary 15-minute signed links for course instructor forwarding.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManifestModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800">
                <span className="font-semibold">Instructor Destination:</span> {manifestData.delivery?.teacher?.full_name} ({manifestData.delivery?.teacher?.email})
              </div>

              <div className="space-y-2">
                <div className="font-semibold text-slate-700 uppercase tracking-wider text-[11px]">
                  Batch Artifacts ({manifestData.items?.length || 0}):
                </div>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg max-h-60 overflow-y-auto">
                  {manifestData.items?.map((item: any, idx: number) => (
                    <div key={idx} className="p-3 flex items-center justify-between hover:bg-slate-50">
                      <div>
                        <div className="font-bold text-slate-900">{item.submitterName}</div>
                        <div className="text-slate-500 text-[11px] mt-0.5">
                          {item.fileName} ({formatFileSize(item.fileSizeBytes)})
                        </div>
                      </div>
                      {item.signedUrl && (
                        <a
                          href={item.signedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-medium"
                        >
                          <span>Test Link</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copyTelegramText}
                className="gap-1.5 text-xs text-slate-700"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-slate-500" />}
                <span>{copied ? 'Copied Manifest Text' : 'Copy Formatted Manifest for Telegram'}</span>
              </Button>

              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setManifestModalOpen(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
