'use client';

export default function RootErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
            <svg
              className="w-6 h-6 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              Service Unavailable
            </h1>

            <p className="text-gray-600 mb-4 text-sm">
              The application encountered an unexpected error. Please try again
              or contact your system administrator.
            </p>

            {error.digest && (
              <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-4">
                <p className="text-xs text-gray-500 font-mono">
                  Error reference: {error.digest}
                </p>
              </div>
            )}

            <button
              onClick={reset}
              className="px-4 py-2 bg-green-700 text-white text-sm font-medium rounded-lg hover:bg-green-800 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>

        <div className="mt-8 pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-400 text-center">
            Haramaya University — Academic Submission Management System
          </p>
        </div>
      </div>
    </div>
  );
}
