import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Developer, Role } from '../lib/types';

interface AuthState {
  session: Session | null;
  role: Role;
  developer: Developer | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string, position: string) => Promise<{ needsConfirm: boolean }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>();
  const [profile, setProfile] = useState<{ userId: string; role: Role; developer: Developer | null } | null>(null);
  const activeUserId = useRef<string>();
  const profileRequest = useRef(0);
  const userId = session?.user?.id;
  const currentProfile = profile?.userId === userId ? profile : null;
  const loading = session === undefined || (userId !== undefined && !currentProfile);

  const refresh = useCallback(async () => {
    const userId = activeUserId.current;
    if (!userId) return;

    const request = ++profileRequest.current;
    let role: Role = 'user';
    let developer: Developer | null = null;
    try {
      const [{ data: roleRow }, { data: devRow }] = await Promise.all([
        supabase.from('user_roles').select('role').eq('user_id', userId).maybeSingle(),
        supabase.from('developers').select('*').eq('user_id', userId).maybeSingle(),
      ]);
      role = (roleRow?.role as Role) ?? 'user';
      developer = (devRow as Developer) ?? null;
    } finally {
      if (request === profileRequest.current) setProfile({ userId, role, developer });
    }
  }, []);

  useEffect(() => {
    let receivedAuthEvent = false;
    // Supabase 的资料查询会读取会话，必须等认证回调返回后再发起。
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'INITIAL_SESSION' && receivedAuthEvent) return;
      receivedAuthEvent = true;
      const nextUserId = nextSession?.user?.id;
      if (activeUserId.current !== nextUserId) {
        activeUserId.current = nextUserId;
        profileRequest.current++;
        setProfile(null);
      }
      setSession(nextSession);
    });

    return () => {
      subscription.unsubscribe();
      activeUserId.current = undefined;
      profileRequest.current++;
    };
  }, []);

  useEffect(() => {
    if (session) void refresh().catch((error) => console.error('加载用户资料失败', error));
  }, [session, refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, name: string, position: string) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name, position } },
      });
      if (error) throw error;
      // 若开启了邮箱验证，session 为空，需要用户去邮箱确认
      return { needsConfirm: !data.session };
    },
    []
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session: session ?? null,
        role: currentProfile?.role ?? 'user',
        developer: currentProfile?.developer ?? null,
        loading,
        signIn,
        signUp,
        signOut,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
