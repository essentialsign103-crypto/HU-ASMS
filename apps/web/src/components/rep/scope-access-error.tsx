// HU-ASMS: Shared Scoped Authorization & Identifier Error Panel for Representative Routes
import React from 'react';
import { Card } from '../ui/card';
import { AlertTriangle } from 'lucide-react';

export function ScopeAccessError({
  status,
  message,
}: {
  status: 400 | 401 | 403;
  message: string;
}) {
  const title =
    status === 400
      ? 'Invalid Request Identifier'
      : status === 401
        ? 'Authentication Required'
        : 'Section Scope Access Denied';

  return (
    <div className="max-w-2xl mx-auto py-8">
      <Card title={title}>
        <div className="flex items-start gap-3 text-sm text-red-700">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
          <div>
            <p className="font-semibold">{message}</p>
            <p className="text-xs text-slate-600 mt-1">
              Access is restricted strictly to valid identifiers within your active section assignments.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
