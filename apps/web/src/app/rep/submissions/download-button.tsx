// HU-ASMS: Secure Signed Download Button Component
'use client';

import React, { useState } from 'react';
import { getSubmissionFileDownloadUrl } from './actions';
import { Button } from '../../../components/ui/button';
import { Download } from 'lucide-react';

export function DownloadButton({ fileId, fileName }: { fileId: string; fileName: string }) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const result = await getSubmissionFileDownloadUrl(fileId);
      if (result.error) {
        alert(`Download Error: ${result.error}`);
      } else if (result.signedUrl) {
        window.open(result.signedUrl, '_blank', 'noopener,noreferrer');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
      isLoading={loading}
      onClick={handleDownload}
    >
      <Download className="w-3.5 h-3.5 text-emerald-600" />
      <span>Download</span>
    </Button>
  );
}
