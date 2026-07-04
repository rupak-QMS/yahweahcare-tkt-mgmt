// ============================================================
// app/login/page.tsx — Microsoft-only login screen
// ============================================================

'use client';

import { useState } from 'react';
import { useAuth } from './AuthContext';

export default function LoginPage() {
  const { loginWithMicrosoft, loading, user } = useAuth();
  const [rememberMe, setRememberMe] = useState(false);

  // Already signed in? Bounce to dashboard.
  if (!loading && user) {
    if (typeof window !== 'undefined') window.location.replace('/dashboard');
    return null;
  }

  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const error = urlParams?.get('error');
  const loggedOut = urlParams?.get('logged_out');

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-500 to-teal-500 p-6">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-50 rounded-2xl mb-3">
            <span className="text-3xl">🤝</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            <span className="bg-gradient-to-br from-blue-700 to-blue-500 bg-clip-text text-transparent">YAHWEH</span>
            <span className="ml-1.5 bg-gradient-to-br from-emerald-500 to-teal-500 bg-clip-text text-transparent">CARE</span>
            <sup className="text-xs text-slate-400 ml-0.5">™</sup>
          </h1>
          <p className="text-slate-500 text-sm mt-2">HRMS — Sign in with your Microsoft work account</p>
        </div>

        {loggedOut && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm border border-emerald-200">
            ✓ You have been signed out.
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
            {decodeURIComponent(error)}
          </div>
        )}

        <button
          onClick={() => loginWithMicrosoft(rememberMe)}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-[#2F2F2F] hover:bg-black text-white rounded-lg font-medium transition disabled:opacity-50"
        >
          {/* Microsoft logo */}
          <svg width="20" height="20" viewBox="0 0 21 21">
            <rect x="1"  y="1"  width="9" height="9" fill="#f25022" />
            <rect x="1"  y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="1"  width="9" height="9" fill="#7fba00" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          Sign in with Microsoft
        </button>

        <label className="flex items-center gap-2 mt-4 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
          Keep me signed in on this device (90 days)
        </label>

        <p className="mt-6 text-xs text-slate-400 text-center">
          Only employees with an official @yahwehcare.com.au or @yahwehpc.com.au account can sign in.
          For account access, contact your administrator.
        </p>
      </div>
    </main>
  );
}
