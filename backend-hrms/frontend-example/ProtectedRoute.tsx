// ============================================================
// <ProtectedRoute> — role/permission gate
// ============================================================
//
// Usage:
//   <ProtectedRoute roles={['super_admin','admin']}>
//     <UserManagementPage />
//   </ProtectedRoute>
//
//   <ProtectedRoute permissions={['user.delete']}>
//     <DeleteButton />
//   </ProtectedRoute>

'use client';

import type { ReactNode } from 'react';
import { useAuth, type AuthUser } from './AuthContext';

interface Props {
  children: ReactNode;
  roles?: AuthUser['role'][];
  permissions?: string[];
  fallback?: ReactNode;
}

export function ProtectedRoute({ children, roles, permissions, fallback }: Props) {
  const { user, loading, hasRole, hasPermission } = useAuth();

  if (loading) return <div className="p-6 text-slate-500">Loading…</div>;
  if (!user) {
    if (typeof window !== 'undefined') window.location.replace('/login');
    return null;
  }
  if (roles && !hasRole(...roles))             return fallback ?? <Unauthorized />;
  if (permissions && !hasPermission(...permissions)) return fallback ?? <Unauthorized />;
  return <>{children}</>;
}

function Unauthorized() {
  return (
    <main className="p-12 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-50 border border-red-200 text-red-600 mb-4">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold text-slate-800">Access Restricted</h1>
      <p className="text-slate-500 mt-2">You don't have permission to view this page.</p>
    </main>
  );
}
