import React, { useState } from 'react';
import { GoogleIcon } from '../common/GoogleIcon';

interface LoginScreenProps {
  onGoogleLogin: () => void;
  onEmailLogin: (email: string) => void;
  onDevLogin?: () => void;
  devAuthEnabled?: boolean;
  isLoading?: boolean;
}

export function LoginScreen({
  onGoogleLogin,
  onEmailLogin,
  onDevLogin,
  devAuthEnabled = false,
  isLoading = false,
}: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onEmailLogin(email);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center px-4 selection:bg-[#E8F8F0] selection:text-[#00A859]">

      <div className="absolute top-6 left-6 text-xs font-semibold text-gray-400 tracking-wider uppercase">
        Login Screen
      </div>

      <div className="w-full max-w-[390px] bg-white rounded-2xl p-8 border border-gray-100 shadow-sm transition-all duration-200">
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-6 tracking-tight">
          Login
        </h1>

        <button
          type="button"
          onClick={onGoogleLogin}
          disabled={isLoading}
          className="w-full bg-[#EAF7EE] hover:bg-[#ddf3e4] border border-[#A7F3D0] text-gray-800 font-medium py-2.5 px-4 rounded-xl flex items-center justify-center gap-2.5 text-sm transition-all duration-150 cursor-pointer shadow-xs disabled:opacity-60 active:scale-[0.99]"
        >
          <GoogleIcon className="w-4 h-4" />
          <span>Login with Google</span>
        </button>

        {devAuthEnabled && onDevLogin && (
          <button
            type="button"
            onClick={onDevLogin}
            disabled={isLoading}
            className="mt-3 w-full bg-white hover:bg-gray-50 border border-dashed border-gray-300 text-gray-600 font-medium py-2.5 px-4 rounded-xl flex items-center justify-center gap-2.5 text-sm transition-all duration-150 cursor-pointer disabled:opacity-60 active:scale-[0.99]"
          >
            <span>Continue in local demo mode</span>
          </button>
        )}

        <div className="relative my-5">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-100" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white px-3 text-gray-400 font-normal">
              Or sign in with email
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email ID"
              className="w-full bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:bg-white focus:outline-none focus:border-[#00A859] focus:ring-1 focus:ring-[#00A859] transition-all"
            />
          </div>

          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:bg-white focus:outline-none focus:border-[#00A859] focus:ring-1 focus:ring-[#00A859] transition-all"
            />
          </div>

          <div className="pt-1.5">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#00A859] hover:bg-[#00924c] text-white font-medium py-2.5 rounded-lg text-sm transition-all duration-150 shadow-sm cursor-pointer disabled:opacity-60 active:scale-[0.99] flex items-center justify-center gap-2"
            >
              <span>Login</span>
            </button>
          </div>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-gray-400">
          Google sign-in is required. Email/password login is disabled for this
          deployment.
        </p>
      </div>
    </div>
  );
}
