import React from 'react';
import { EmailRecord } from '../../types/api';
import { Clock, ChevronDown, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';

interface EmailListViewProps {
  emails: EmailRecord[];
  activeTab: 'scheduled' | 'sent';
  loading: boolean;
  onSelectEmail: (email: EmailRecord) => void;
  onCancelEmail?: (id: string) => void;
  onCancelAllScheduled?: () => void;
  totalScheduled?: number;
  onComposeClick: () => void;
}

export function EmailListView({
  emails,
  activeTab,
  loading,
  onSelectEmail,
  onCancelEmail,
  onCancelAllScheduled,
  totalScheduled = 0,
  onComposeClick,
}: EmailListViewProps) {

  const formatTimestamp = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return 'Unknown time';

      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = d.toDateString() === tomorrow.toDateString();

      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

      if (isToday) return `Today, ${timeStr}`;
      if (isTomorrow) return `Tomorrow, ${timeStr}`;
      return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
    } catch {
      return 'Unknown time';
    }
  };

  const formatRecipientName = (email: string) => {
    const localPart = email.split('@')[0]?.trim();
    if (!localPart) return email;
    return localPart
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  };

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="p-12 text-center bg-white rounded-2xl border border-gray-100 my-6 mx-6 shadow-xs">
        <div className="w-12 h-12 rounded-full bg-[#E8F8F0] text-[#00A859] flex items-center justify-center mx-auto mb-3">
          <Clock className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-gray-900">
          No {activeTab} emails found
        </h3>
        <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
          {activeTab === 'scheduled'
            ? 'You have no scheduled emails queued in this workspace.'
            : 'No sent outbound emails recorded yet in this workspace.'}
        </p>
        <button
          onClick={onComposeClick}
          className="mt-4 bg-[#00A859] hover:bg-[#00924c] text-white text-xs font-medium px-4 py-2 rounded-xl transition-colors cursor-pointer"
        >
          Compose New Email
        </button>
      </div>
    );
  }

  return (
    <>
      {activeTab === 'scheduled' && onCancelAllScheduled && totalScheduled > 0 && (
        <div className="px-6 py-3 bg-white border-b border-gray-100 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-gray-900">Scheduled emails</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {totalScheduled} queued or processing. Bulk delete removes queued emails only.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelAllScheduled}
            className="shrink-0 text-[11px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-100 rounded-lg px-3 py-1.5 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete all scheduled</span>
          </button>
        </div>
      )}

      <div className="bg-white border-b border-gray-100 divide-y divide-gray-100">
        {emails.map((email) => {
        const isScheduled = activeTab === 'scheduled';
        const recipientName = formatRecipientName(email.recipient);
        const scheduledTimeLabel = formatTimestamp(email.scheduledAt);
        const sentTimeLabel = email.sentAt ? formatTimestamp(email.sentAt) : null;

        return (
          <div
            key={email.id}
            onClick={() => onSelectEmail(email)}
            className="group px-6 py-3.5 flex items-center justify-between hover:bg-gray-50/70 transition-colors cursor-pointer select-none"
          >

            <div className="w-44 sm:w-56 shrink-0 min-w-0">
              <span className="text-xs font-medium text-gray-900 group-hover:text-gray-950 truncate block">
                {recipientName}
              </span>
              <span className="text-[10px] text-gray-400 truncate block">
                {email.recipient}
              </span>
            </div>

            <div className="flex-1 flex items-center gap-3 min-w-0 pr-4">

              {isScheduled ? (
                <>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-md shrink-0 ${
                      email.status === 'processing'
                        ? 'bg-blue-50 text-blue-600'
                        : 'bg-[#E8F8F0] text-[#00A859]'
                    }`}
                  >
                    {email.status === 'processing' ? 'Processing' : 'Scheduled'}
                  </span>
                  <span className="text-[11px] text-gray-500 shrink-0 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-gray-400" />
                    {scheduledTimeLabel}
                  </span>
                </>
              ) : (
                <>
                  <div
                    className={`text-[11px] font-medium px-2 py-0.5 rounded-md shrink-0 flex items-center gap-1 ${
                      email.status === 'sent'
                        ? 'bg-[#E8F8F0] text-[#00A859]'
                        : 'bg-red-50 text-red-600'
                    }`}
                  >
                    {email.status === 'sent' ? (
                      <>
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Sent</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-3 h-3" />
                        <span>Failed</span>
                      </>
                    )}
                  </div>
                  {sentTimeLabel && (
                    <span className="text-[11px] text-gray-500 shrink-0 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-gray-400" />
                      {sentTimeLabel}
                    </span>
                  )}
                </>
              )}

              <div className="flex items-center min-w-0 text-xs">
                <span className="font-semibold text-gray-900 shrink-0 mr-1.5">
                  {email.subject}
                </span>
                <span className="text-gray-500 font-normal truncate">
                  {email.body
                    ? `- ${email.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()}`
                    : ''}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {email.status === 'scheduled' && onCancelEmail && (
                <button
                  type="button"
                  title="Cancel scheduled send"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancelEmail(email.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 rounded transition-all cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 transition-colors" />
            </div>
          </div>
        );
        })}
      </div>
    </>
  );
}
