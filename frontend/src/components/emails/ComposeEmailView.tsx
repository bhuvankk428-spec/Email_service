import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Edit3,
  X,
  Upload,
  Clock,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  Link as LinkIcon,
  Paperclip,
  Code,
  Undo2,
  Redo2,
  ChevronDown,
} from 'lucide-react';
import { ScheduleEmailsRequest } from '../../types/api';
import { isValidEmail } from '../../lib/lead-parser';

interface ComposeEmailViewProps {
  userEmail: string;
  onBack: () => void;
  onSubmit: (payload: ScheduleEmailsRequest) => Promise<boolean>;
  onOpenUploader: () => void;
  initialRecipients?: string[];
  isSubmitting?: boolean;
}

export function ComposeEmailView({
  userEmail,
  onBack,
  onSubmit,
  onOpenUploader,
  initialRecipients = [],
  isSubmitting = false,
}: ComposeEmailViewProps) {
  const [recipients, setRecipients] = useState<string[]>(initialRecipients);

  useEffect(() => {
    if (initialRecipients.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecipients((prev) => {
      const seen = new Set(prev.map((r) => r.toLowerCase()));
      const merged = [...prev];
      for (const recipient of initialRecipients) {
        const key = recipient.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(recipient);
        }
      }
      return merged;
    });
  }, [initialRecipients]);
  const [newRecipientInput, setNewRecipientInput] = useState('');
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const [isSendLaterOpen, setIsSendLaterOpen] = useState(false);
  const [selectedPresetTime, setSelectedPresetTime] = useState<string>('Tomorrow, 10:00 AM');
  const [customDateTime, setCustomDateTime] = useState('');
  const [delaySeconds, setDelaySeconds] = useState('2');
  const [hourlyLimit, setHourlyLimit] = useState('100');

  const addRecipient = (raw: string): boolean => {
    const trimmed = raw.trim().replace(/,$/, '').trim();
    if (!trimmed) return false;

    if (!isValidEmail(trimmed)) {
      setRecipientError(`"${trimmed}" is not a valid email address.`);
      return false;
    }

    if (recipients.some((r) => r.toLowerCase() === trimmed.toLowerCase())) {
      setRecipientError('That recipient is already in the list.');
      return false;
    }

    setRecipients([...recipients, trimmed]);
    setRecipientError(null);
    return true;
  };

  const handleAddRecipient = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (addRecipient(newRecipientInput)) {
        setNewRecipientInput('');
      }
    }
  };

  const handleRemoveRecipient = (emailToRemove: string) => {
    setRecipients(recipients.filter((r) => r !== emailToRemove));
    setRecipientError(null);
  };

  const calculateSendAt = (): string => {
    const now = new Date();
    if (customDateTime) {
      const custom = new Date(customDateTime);
      if (!isNaN(custom.getTime())) {
        return new Date(Math.max(custom.getTime(), now.getTime())).toISOString();
      }
    }

    if (selectedPresetTime === 'Now (send immediately)') return now.toISOString();

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (selectedPresetTime === 'Tomorrow, 10:00 AM') {
      tomorrow.setHours(10, 0, 0, 0);
    } else if (selectedPresetTime === 'Tomorrow, 11:00 AM') {
      tomorrow.setHours(11, 0, 0, 0);
    } else if (selectedPresetTime === 'Tomorrow, 01:00 PM') {
      tomorrow.setHours(13, 0, 0, 0);
    } else {
      tomorrow.setHours(10, 0, 0, 0);
    }

    return tomorrow.toISOString();
  };

  const handleSaveSchedule = async () => {

    let recipientsToSend = recipients;
    const pending = newRecipientInput.trim().replace(/,$/, '').trim();
    if (pending) {
      if (!isValidEmail(pending)) {
        setRecipientError(`"${pending}" is not a valid email address.`);
        return;
      }
      if (!recipients.some((r) => r.toLowerCase() === pending.toLowerCase())) {
        recipientsToSend = [...recipients, pending];
        setRecipients(recipientsToSend);
      }
      setNewRecipientInput('');
    }

    if (recipientsToSend.length === 0) {
      alert('Please enter at least one recipient email.');
      return;
    }

    const invalid = recipientsToSend.filter((r) => !isValidEmail(r));
    if (invalid.length > 0) {
      setRecipientError(`Remove or fix these invalid addresses: ${invalid.join(', ')}`);
      return;
    }

    if (!subject.trim()) {
      alert('Please enter an email subject.');
      return;
    }
    if (!body.trim()) {
      alert('Please write an email body.');
      return;
    }

    const parsedDelaySeconds = Number(delaySeconds);
    if (
      !Number.isFinite(parsedDelaySeconds) ||
      parsedDelaySeconds < 0.1 ||
      parsedDelaySeconds > 86_400
    ) {
      alert('Delay between emails must be between 0.1 and 86,400 seconds.');
      return;
    }

    const parsedHourlyLimit = Number(hourlyLimit);
    if (
      !Number.isInteger(parsedHourlyLimit) ||
      parsedHourlyLimit < 1 ||
      parsedHourlyLimit > 100_000
    ) {
      alert('Hourly limit must be a whole number between 1 and 100,000.');
      return;
    }

    const startAt = calculateSendAt();

    const escapedBody = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br />');

    const payload: ScheduleEmailsRequest = {
      subject: subject.trim(),
      body: escapedBody,
      recipients: recipientsToSend,
      startAt,
      delayBetweenEmailsMs: Math.round(parsedDelaySeconds * 1000),
      maxEmailsPerHour: parsedHourlyLimit,
      idempotencyKey:
        'batch_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    };

    const success = await onSubmit(payload);
    if (success) {
      setIsSendLaterOpen(false);
      onBack();
    }
  };

  return (
    <div className="bg-white min-h-[calc(100vh-3.5rem)] flex flex-col relative select-none">

      <div className="h-14 border-b border-gray-100 px-6 flex items-center justify-between shrink-0 relative">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors cursor-pointer"
            title="Back to list"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-semibold text-gray-900">
            Compose New Email
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            title="Draft options"
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
          >
            <Edit3 className="w-4 h-4" />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setIsSendLaterOpen(!isSendLaterOpen)}
              className="bg-[#00A859] hover:bg-[#00924c] text-white font-medium text-xs px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer active:scale-[0.98]"
            >
              <span>Schedule</span>
              <ChevronDown className="w-3 h-3" />
            </button>

            {isSendLaterOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 p-4 z-50 transition-all">
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <h4 className="text-xs font-bold text-gray-900">Schedule delivery</h4>
                  <Clock className="w-3.5 h-3.5 text-[#00A859]" />
                </div>

                <div className="py-2.5">
                  <p className="text-[11px] font-semibold text-gray-400 mb-2">
                    Pick date &amp; time
                  </p>

                  <div className="space-y-1">
                    {[
                      'Now (send immediately)',
                      'Tomorrow, 10:00 AM',
                      'Tomorrow, 11:00 AM',
                      'Tomorrow, 01:00 PM',
                    ].map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => {
                          setSelectedPresetTime(slot);
                          setCustomDateTime('');
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center justify-between ${
                          selectedPresetTime === slot && !customDateTime
                            ? 'bg-[#E8F8F0] text-[#00A859]'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span>{slot}</span>
                        {selectedPresetTime === slot && !customDateTime && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#00A859]" />
                        )}
                      </button>
                    ))}
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-gray-100">
                    <label className="text-[11px] text-gray-500 block mb-1">
                      Custom date &amp; time
                    </label>
                    <input
                      type="datetime-local"
                      value={customDateTime}
                      onChange={(e) => {
                        setCustomDateTime(e.target.value);
                        setSelectedPresetTime('');
                      }}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1 text-xs text-gray-800 focus:bg-white focus:outline-none focus:border-[#00A859]"
                    />
                    <p className="mt-1 text-[10px] text-gray-400">
                      Times at or before now are sent immediately.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setIsSendLaterOpen(false)}
                    className="px-3 py-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleSaveSchedule}
                    className="bg-[#00A859] hover:bg-[#00924c] text-white text-xs font-semibold px-4 py-1.5 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    {isSubmitting ? 'Scheduling...' : 'Schedule'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-8 pt-4 pb-2 border-b border-gray-100 space-y-2.5">

        <div className="flex items-center text-xs">
          <span className="w-14 text-gray-400 font-medium shrink-0">From</span>
          <div className="flex items-center gap-1.5 text-gray-800 font-medium cursor-pointer">
            <span>{userEmail}</span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </div>
        </div>

        <div className="flex items-center justify-between text-xs min-h-[36px]">
          <div className="flex items-center flex-wrap gap-1.5 flex-1 pr-3">
            <span className="w-14 text-gray-400 font-medium shrink-0">To</span>

            {recipients.map((rec) => (
              <span
                key={rec}
                className="bg-white border border-[#A7F3D0] text-[#00A859] rounded-md px-2 py-0.5 text-xs font-medium flex items-center gap-1 shadow-2xs"
              >
                <span>{rec}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveRecipient(rec)}
                  className="hover:text-red-500 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}

            <input
              type="email"
              value={newRecipientInput}
              onChange={(e) => {
                setNewRecipientInput(e.target.value);
                if (recipientError) setRecipientError(null);
              }}
              onKeyDown={handleAddRecipient}
              placeholder={recipients.length === 0 ? 'Type recipient email & press Enter...' : ''}
              className="outline-none text-xs text-gray-800 placeholder-gray-400 min-w-[140px] flex-1 py-1"
            />
          </div>

          <button
            type="button"
            onClick={onOpenUploader}
            className="text-[#00A859] hover:text-[#00924c] font-medium text-xs flex items-center gap-1 shrink-0 cursor-pointer hover:underline"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>+ Upload List</span>
          </button>
        </div>

        {recipientError && (
          <p className="pl-14 text-[11px] font-medium text-red-500" role="alert">
            {recipientError}
          </p>
        )}

        <div className="flex items-center text-xs">
          <span className="w-14 text-gray-400 font-medium shrink-0">Subject</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="outline-none text-xs text-gray-900 placeholder-gray-400 flex-1 py-1"
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pl-14 text-[11px]">
          <label className="flex items-center gap-2 text-gray-500">
            <span className="font-medium">Delay between emails</span>
            <input
              type="number"
              min="0.1"
              max="86400"
              step="0.1"
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(e.target.value)}
              className="w-16 bg-gray-50 border border-gray-200 rounded-md px-2 py-1 text-gray-800 focus:bg-white focus:outline-none focus:border-[#00A859]"
            />
            <span className="text-gray-400">sec</span>
          </label>

          <label className="flex items-center gap-2 text-gray-500">
            <span className="font-medium">Hourly limit</span>
            <input
              type="number"
              min="1"
              max="100000"
              step="1"
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(e.target.value)}
              className="w-20 bg-gray-50 border border-gray-200 rounded-md px-2 py-1 text-gray-800 focus:bg-white focus:outline-none focus:border-[#00A859]"
            />
            <span className="text-gray-400">per sender</span>
          </label>
        </div>

        <p className="pl-14 text-[10px] text-gray-400">
          The server still applies its configured minimum gap and per-sender hourly cap.
          Emails above the limit move to the next window.
        </p>
      </div>

      <div className="px-8 py-2 border-b border-gray-100 flex items-center gap-1 text-gray-500 text-xs shrink-0 flex-wrap">
        <button
          type="button"
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 rounded-md cursor-pointer"
        >
          <span>Sans Serif</span>
          <ChevronDown className="w-3 h-3 text-gray-400" />
        </button>

        <span className="w-px h-4 bg-gray-200 mx-1" />

        <button type="button" className="p-1.5 hover:bg-gray-100 rounded text-gray-600 cursor-pointer">
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="p-1.5 hover:bg-gray-100 rounded text-gray-600 cursor-pointer">
          <Redo2 className="w-3.5 h-3.5" />
        </button>

        <span className="w-px h-4 bg-gray-200 mx-1" />

        <button type="button" className="p-1.5 hover:bg-gray-100 rounded text-gray-700 font-bold cursor-pointer">
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="p-1.5 hover:bg-gray-100 rounded text-gray-700 cursor-pointer">
          <Italic className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="p-1.5 hover:bg-gray-100 rounded text-gray-700 cursor-pointer">
          <Underline className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="p-1.5 hover:bg-gray-100 rounded text-gray-700 cursor-pointer">
          <Strikethrough className="w-3.5 h-3.5" />
        </button>

        <span className="w-px h-4 bg-gray-200 mx-1" />

        <button type="button" className="p-1.5 hover:bg-gray-100 rounded text-gray-700 cursor-pointer">
          <AlignLeft className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="p-1.5 hover:bg-gray-100 rounded text-gray-700 cursor-pointer">
          <AlignCenter className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="p-1.5 hover:bg-gray-100 rounded text-gray-700 cursor-pointer">
          <AlignRight className="w-3.5 h-3.5" />
        </button>

        <span className="w-px h-4 bg-gray-200 mx-1" />

        <button type="button" className="p-1.5 hover:bg-gray-100 rounded text-gray-700 cursor-pointer">
          <List className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="p-1.5 hover:bg-gray-100 rounded text-gray-700 cursor-pointer">
          <ListOrdered className="w-3.5 h-3.5" />
        </button>

        <span className="w-px h-4 bg-gray-200 mx-1" />

        <button type="button" className="p-1.5 hover:bg-gray-100 rounded text-gray-700 cursor-pointer">
          <LinkIcon className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="p-1.5 hover:bg-gray-100 rounded text-gray-700 cursor-pointer">
          <Paperclip className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="p-1.5 hover:bg-gray-100 rounded text-gray-700 cursor-pointer">
          <Code className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 p-8 flex flex-col">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Type your email here..."
          className="w-full flex-1 min-h-[220px] outline-none text-xs sm:text-sm text-gray-800 placeholder-gray-400 resize-none font-normal leading-relaxed"
        />
      </div>
    </div>
  );
}
