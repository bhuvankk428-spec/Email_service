import React from 'react';
import { Search, RefreshCw, HelpCircle, LogOut } from 'lucide-react';
import { AuthUser } from '../../types/api';

interface TopBarProps {
  user: AuthUser | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  onLogout: () => void;
}

export function TopBar({
  user,
  searchQuery,
  onSearchChange,
  onRefresh,
  refreshing,
  onLogout,
}: TopBarProps) {
  return (
    <header className="h-14 bg-white border-b border-[#E5E7EB] px-6 flex items-center justify-between shrink-0 sticky top-0 z-30">

      <div className="relative w-36 sm:w-72 max-w-sm">
        <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search"
          className="w-full bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl pl-9 pr-3.5 py-1.5 text-xs text-gray-800 placeholder-gray-400 focus:bg-white focus:outline-none focus:border-[#00A859] focus:ring-1 focus:ring-[#00A859] transition-all"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onRefresh}
          title="Refresh email list"
          className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-[#00A859]' : ''}`} />
        </button>

        <button
          type="button"
          title="Documentation & help"
          className="hidden md:inline-flex p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-2.5 pl-3 border-l border-gray-100">
          <div className="flex flex-col items-end min-w-0">
            <span className="text-xs font-semibold text-gray-900 truncate max-w-[100px] md:max-w-[160px]">
              {user?.name ?? 'Account'}
            </span>
            <span className="hidden md:block text-[10px] text-gray-400 truncate max-w-[180px]">
              {user?.email ?? ''}
            </span>
          </div>

          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              className="w-7 h-7 rounded-full object-cover border border-gray-200"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-[#E8F8F0] text-[#00A859] text-xs font-bold flex items-center justify-center border border-[#A7F3D0]">
              {user?.name ? user.name.slice(0, 2).toUpperCase() : '?'}
            </div>
          )}

          <button
            type="button"
            onClick={onLogout}
            title="Log out"
            aria-label="Log out"
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
