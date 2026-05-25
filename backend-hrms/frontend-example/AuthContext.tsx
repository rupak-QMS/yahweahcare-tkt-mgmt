// ============================================================
// Next.js AuthContext — cookie-based auth client
// ============================================================
//
// All auth state lives in HTTP-only cookies set by the backend.
// The frontend just calls /auth/me on mount to find out who's signed in,
// and uses /auth/refresh on 401 to keep the access token fresh.

'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4001';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: 'super_admin' | 'admin' | 'hr' | 'manager' | 'employee';
  role_label: string;
  department: string | null;
  designation: string | null;
  profile_photo_url: string | null;
  is_admin: boolean;
  bootstrap_admin: boolean;
  active: boolean;
}

interface AuthState {
  user: AuthUser | null;
  permissions: string[];
  loading: boolean;
  loginWithMicrosoft: (rememberMe?: boolean) => void;
  logout: (global?: boolean) => Promise<void>;
  hasRole: (...roles: AuthUser['role'][]) => boolean;
  hasPermission: (...perms: string[]) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
      if (res.status === 401) {
        // Try a silent refresh once
        const refreshRes = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
        if (refreshRes.ok) {
          const retry = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
          if (retry.ok) {
            const data = await retry.json();
            setUser(data.user); setPermissions(data.permissions); return;
          }
        }
        setUser(null); setPermissions([]); return;
      }
      if (res.ok) {
        const data = await res.json();
        setUser(data.user); setPermissions(data.permissions);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMe(); }, [fetchMe]);

  // Refresh access token every 12 min (TTL is 15 min)
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => {
      fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' }).catch(() => {});
    }, 12 * 60_000);
    return () => clearInterval(t);
  }, [user]);

  const loginWithMicrosoft = (rememberMe = false) => {
    window.location.href = `${API_BASE}/auth/microsoft${rememberMe ? '?remember=1' : ''}`;
  };

  const logout = async (global = false) => {
    const endpoint = global ? '/auth/logout-all' : '/auth/logout';
    const res = await fetch(`${API_BASE}${endpoint}`, { method: 'POST', credentials: 'include' });
    setUser(null); setPermissions([]);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      // Bounce through Microsoft global sign-out so the SSO cookie also clears
      if (data?.microsoftLogoutUrl) window.location.href = data.microsoftLogoutUrl;
      else window.location.href = '/login';
    }
  };

  return (
    <AuthContext.Provider value={{
      user, permissions, loading,
      loginWithMicrosoft, logout, refresh: fetchMe,
      hasRole: (...rs) => !!user && rs.includes(user.role),
      hasPermission: (...ps) => ps.every(p => permissions.includes(p)),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
