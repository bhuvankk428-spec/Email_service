'use client';

import { useState, useEffect, useCallback } from 'react';
import { AuthUser } from '../types/api';
import { AuthService } from '../services/authService';
import { useToast } from '../context/ToastContext';

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const { addToast } = useToast();
  const devAuthEnabled = process.env.NEXT_PUBLIC_DEV_AUTH_ENABLED === 'true';

  const fetchUser = useCallback(async () => {
    try {
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const authResult = urlParams.get('auth');
        const error = urlParams.get('error');

        if (error) {
          addToast({
            type: 'error',
            title: 'Google sign-in failed',
            message: error === 'invalid_state' ? 'The login attempt expired. Please try again.' : 'Please try signing in again.',
          });
        }

        if (authResult === 'success') {
          addToast({
            type: 'success',
            title: 'Signed in with Google',
            message: 'Welcome to your ReachInbox dashboard.',
          });
        }

        if (authResult || error) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }

      const data = await AuthService.getUser();
      setUser(data && data.email ? data : null);
    } catch {

      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {

    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchUser();
  }, [fetchUser]);

  const handleGoogleLogin = async () => {
    try {
      const authUrl = await AuthService.initiateGoogleLogin();
      if (!authUrl) {
        throw new Error('Missing Google authorization URL');
      }
      window.location.href = authUrl;
    } catch (error: unknown) {
      addToast({
        type: 'error',
        title: 'Google sign-in unavailable',
        message:
          error instanceof Error && error.message
            ? error.message
            : 'The backend is not configured for Google OAuth yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      });
    }
  };

  const handleDevLogin = async () => {
    try {
      const data = await AuthService.devLogin();
      setUser(data);
      addToast({
        type: 'success',
        title: 'Local demo session started',
        message: 'Signed in with the local development account.',
      });
    } catch {
      addToast({
        type: 'error',
        title: 'Local login unavailable',
        message: 'Enable DEV_AUTH_ENABLED=true on the backend and rebuild the frontend.',
      });
    }
  };

  const handleEmailLogin = (email?: string) => {
    addToast({
      type: 'info',
      title: 'Use Google sign-in',
      message: email
        ? `Email/password sign-in is disabled for ${email}. Please use Login with Google or the local demo button.`
        : 'Email/password sign-in is disabled. Use Login with Google, or the local demo button when enabled.',
    });
  };

  const handleLogout = async () => {
    try {
      await AuthService.logout();
    } catch (err) {
      console.warn('Logout API warning:', err);
    } finally {
      setUser(null);
      addToast({
        type: 'info',
        title: 'Logged Out',
        message: 'You have been signed out.',
      });
    }
  };

  return {
    user,
    loading,
    isAuthenticated: !!user,
    devAuthEnabled,
    loginWithGoogle: handleGoogleLogin,
    loginWithDev: handleDevLogin,
    loginWithEmail: handleEmailLogin,
    logout: handleLogout,
    refetchUser: fetchUser,
  };
}
