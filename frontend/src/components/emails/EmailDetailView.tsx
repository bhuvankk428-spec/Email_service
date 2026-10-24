import React from 'react';
import { EmailRecord } from '../../types/api';
import { ArrowLeft, ExternalLink, Trash2 } from 'lucide-react';

interface EmailDetailViewProps {
  email: EmailRecord;
  onBack: () => void;
  onDelete?: (id: string) => void;
}

function initials(value: string): string {
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'Not sent yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function bodyDocument(body: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base target="_blank" />
    <style>
      body { margin: 0; padding: 0; color: #1f2937; font: 14px/1.65 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; white-space: pre-wrap; overflow-wrap: anywhere; }
      a { color: #00a859; }
      img { max-width: 100%; height: auto; }
      blockquote { border-left: 3px solid #a7f3d0; margin-left: 0; padding-left: 12px; color: #4b5563; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

export function EmailDetailView({ email, onBack, onDelete }: EmailDetailViewProps) {
  const senderName = email.sender ?? 'Scheduled sender';
  const statusLabel =
    email.status === 'scheduled'
      ? 'Scheduled'
      : email.status === 'processing'
        ? 'Processing'
        : email.status === 'failed'
          ? 'Failed'
          : 'Sent';

  const statusClass =
    email.status === 'failed'
      ? 'bg-red-50 text-red-700 border-red-200'
      : email.status === 'sent'
        ? 'bg-[#EAF7EE] text-[#00A859] border-[#A7F3D0]'
        : 'bg-[#FEF3C7] text-[#D97706] border-amber-200';

  const canCancel = email.status === 'scheduled';

  return (
    <div className="bg-white min-h-[calc(100vh-3.5rem)] flex flex-col">

      <div className="h-14 border-b border-gray-100 px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors cursor-pointer"
            title="Back to list"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-bold text-gray-900 truncate">
            {email.subject} <span className="text-gray-400">| {email.id.slice(0, 8)}</span>
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${statusClass}`}>
            {statusLabel}
          </span>
          {canCancel && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(email.id)}
              className="p-1.5 hover:text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
              title="Cancel scheduled email"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="p-8 max-w-4xl space-y-6">

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-full bg-[#00A859] text-white font-bold text-sm flex items-center justify-center shrink-0 shadow-xs">
              {initials(senderName) || 'EM'}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-gray-900 truncate">{senderName}</span>
                <span className="text-xs text-gray-400 truncate">
                  to {email.recipient}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {formatTimestamp(email.sentAt ?? email.scheduledAt)}
              </p>
            </div>
          </div>
        </div>

        {email.errorMessage && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            <span className="font-semibold">Delivery error: </span>
            {email.errorMessage}
          </div>
        )}

        {email.etherealUrl && (
          <a
            href={email.etherealUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#00A859] hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open delivered message in Ethereal
          </a>
        )}

        <iframe
          title={`Email body: ${email.subject}`}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={bodyDocument(email.body ?? '')}
          className="w-full min-h-[420px] rounded-xl border border-gray-200 bg-white"
        />
      </div>
    </div>
  );
}
