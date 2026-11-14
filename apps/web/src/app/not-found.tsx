// HU-ASMS: 404 Not Found Page
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="w-16 h-16 rounded-xl bg-red-600 flex items-center justify-center font-bold text-white text-3xl mx-auto mb-4 shadow-lg">
          !
        </div>
        <h1 className="text-4xl font-bold text-white mb-2">404</h1>
        <h2 className="text-xl text-slate-300 mb-6">Page Not Found</h2>
        <p className="text-slate-400 mb-8 max-w-md">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center px-6 py-3 rounded-lg bg-green-700 text-white font-semibold hover:bg-green-800 transition-colors"
        >
          Return Home
        </Link>
      </div>
    </div>
  );
}
