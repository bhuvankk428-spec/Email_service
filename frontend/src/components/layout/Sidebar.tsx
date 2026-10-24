import React from 'react';
import { AuthUser } from '../../types/api';
import { Clock, Send, Edit, LogOut, ChevronDown } from 'lucide-react';

interface SidebarProps {
  user: AuthUser | null;
  activeTab: 'scheduled' | 'sent';
  onTabChange: (tab: 'scheduled' | 'sent') => void;
  onComposeClick: () => void;
  onLogout: () => void;
  scheduledCount: number;
  sentCount: number;
}

export function Sidebar({
  user,
  activeTab,
  onTabChange,
  onComposeClick,
  onLogout,
  scheduledCount,
  sentCount,
}: SidebarProps) {
  const [showUserMenu, setShowUserMenu] = React.useState(false);

  return (
    <aside className="w-64 bg-white border-r border-[#E5E7EB] flex flex-col h-screen shrink-0 sticky top-0 select-none">

      <div className="p-5 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => onTabChange('scheduled')}>
          <span className="text-2xl font-black tracking-tight text-gray-900 font-sans">
            ON3
          </span>
        </div>
      </div>

      <div className="px-4 py-2 relative">
        <div
          onClick={() => setShowUserMenu(!showUserMenu)}
          className="bg-white border border-gray-100 rounded-xl p-2.5 flex items-center justify-between shadow-xs hover:border-gray-200 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                className="w-8 h-8 rounded-full object-cover shrink-0 border border-gray-200"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#E8F8F0] text-[#00A859] font-bold text-xs flex items-center justify-center shrink-0 border border-[#A7F3D0]">
                {user?.name ? user.name.slice(0, 2).toUpperCase() : '?'}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gray-900 truncate">
                {user?.name ?? 'Account'}
              </p>
              <p className="text-[11px] text-gray-400 truncate">
                {user?.email ?? ''}
              </p>
            </div>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        </div>

        {showUserMenu && (
          <div className="absolute left-4 right-4 mt-1 bg-white border border-gray-100 rounded-xl shadow-lg p-1.5 z-50">
            <button
              onClick={() => {
                setShowUserMenu(false);
                onLogout();
              }}
              className="w-full text-left px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-2 cursor-pointer transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log out</span>
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onComposeClick}
          className="mt-3 w-full bg-[#E8F8F0] hover:bg-[#ddf3e4] border border-[#A7F3D0] text-[#00A859] font-medium py-2 px-4 rounded-xl flex items-center justify-center gap-2 text-xs tracking-wide transition-colors cursor-pointer active:scale-[0.99] shadow-2xs"
        >
          <Edit className="w-3.5 h-3.5" />
          <span>Compose</span>
        </button>
      </div>

      <nav className="px-3 py-4 space-y-1 flex-1">
        <button
          type="button"
          onClick={() => onTabChange('scheduled')}
          className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
            activeTab === 'scheduled'
              ? 'bg-[#E8F8F0] text-[#00A859]'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Clock className="w-4 h-4 shrink-0" />
            <span>Scheduled</span>
          </div>
          <span
            className={`text-[11px] px-1.5 py-0.2 rounded-md font-semibold ${
              activeTab === 'scheduled'
                ? 'bg-white text-[#00A859] border border-[#A7F3D0]'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {scheduledCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange('sent')}
          className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
            activeTab === 'sent'
              ? 'bg-[#E8F8F0] text-[#00A859]'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Send className="w-4 h-4 shrink-0" />
            <span>Sent</span>
          </div>
          <span
            className={`text-[11px] px-1.5 py-0.2 rounded-md font-semibold ${
              activeTab === 'sent'
                ? 'bg-white text-[#00A859] border border-[#A7F3D0]'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {sentCount}
          </span>
        </button>
      </nav>

      <div className="p-4 border-t border-gray-100 text-[11px] text-gray-400 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#00A859] animate-pulse" />
          <span>Engine Active</span>
        </div>
        <button
          onClick={onLogout}
          title="Logout"
          className="text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </aside>
  );
}
