'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { EmailRecord, ScheduleEmailsRequest, EmailStats } from '../types/api';
import { EmailService } from '../services/emailService';
import { useToast } from '../context/ToastContext';

export interface EmailFilters {
  searchQuery: string;
  status: string;
}

export function useEmails(enabled = true) {
  const [scheduledEmails, setScheduledEmails] = useState<EmailRecord[]>([]);
  const [sentEmails, setSentEmails] = useState<EmailRecord[]>([]);
  const [stats, setStats] = useState<EmailStats>({
    totalScheduled: 0,
    totalProcessing: 0,
    totalSent: 0,
    totalFailed: 0,
  });
  const [loading, setLoading] = useState<boolean>(enabled);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [filters, setFilters] = useState<EmailFilters>({
    searchQuery: '',
    status: 'all',
  });

  const { addToast } = useToast();

  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);

    try {
      const [scheduled, sent, computedStats] = await Promise.all([
        EmailService.fetchScheduled(),
        EmailService.fetchSent(),
        EmailService.fetchStats(),
      ]);

      setScheduledEmails(scheduled);
      setSentEmails(sent);
      setStats(computedStats);
    } catch (error: unknown) {
      console.error('Failed to load email scheduler data:', error);
      addToast({
        type: 'error',
        title: 'Connection Notice',
        message:
          error instanceof Error && error.message
            ? error.message
            : 'Could not fetch latest updates from API. Please verify network or service status.',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (!enabled) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
    const interval = setInterval(() => {
      loadData(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [loadData, enabled]);

  const scheduleBatch = async (payload: ScheduleEmailsRequest): Promise<boolean> => {
    setIsSubmitting(true);
    try {
      const res = await EmailService.scheduleEmails(payload);
      const pacing = [
        res.delayMs ? `delay ${(res.delayMs / 1000).toFixed(1)}s` : null,
        res.hourlyLimit ? `limit ${res.hourlyLimit}/hour per sender` : null,
      ].filter(Boolean);

      addToast({
        type: 'success',
        title: 'Emails Scheduled Successfully',
        message: `Accepted ${res.acceptedCount} email(s) into the persistent queue${
          pacing.length > 0 ? ` (${pacing.join(', ')})` : ''
        }.`,
      });
      await loadData(true);
      return true;
    } catch (error: unknown) {
      addToast({
        type: 'error',
        title: 'Scheduling Failed',
        message:
          error instanceof Error && error.message
            ? error.message
            : 'An error occurred while creating delayed jobs.',
      });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelScheduledEmail = async (id: string): Promise<boolean> => {
    try {
      await EmailService.cancelSchedule(id);
      addToast({
        type: 'info',
        title: 'Schedule Cancelled',
        message: 'Email removed from the delivery queue.',
      });
      await loadData(true);
      return true;
    } catch (error: unknown) {
      addToast({
        type: 'error',
        title: 'Cancellation Failed',
        message:
          error instanceof Error && error.message
            ? error.message
            : 'Could not cancel scheduled email.',
      });
      return false;
    }
  };

  const cancelAllScheduled = async (): Promise<number | null> => {
    try {
      const res = await EmailService.cancelAllScheduled();
      addToast({
        type: 'info',
        title: 'Scheduled Queue Cleared',
        message: `Deleted ${res.deleted} scheduled email(s) and removed their jobs.`,
      });
      await loadData(true);
      return res.deleted;
    } catch (error: unknown) {
      addToast({
        type: 'error',
        title: 'Bulk Cancellation Failed',
        message:
          error instanceof Error && error.message
            ? error.message
            : 'Could not delete the scheduled queue.',
      });
      return null;
    }
  };

  const filteredScheduled = useMemo(() => {
    return scheduledEmails.filter((email) => {
      const matchesSearch =
        email.recipient.toLowerCase().includes(filters.searchQuery.toLowerCase()) ||
        email.subject.toLowerCase().includes(filters.searchQuery.toLowerCase());
      const matchesStatus = filters.status === 'all' || email.status === filters.status;
      return matchesSearch && matchesStatus;
    });
  }, [scheduledEmails, filters.searchQuery, filters.status]);

  const filteredSent = useMemo(() => {
    return sentEmails.filter((email) => {
      const matchesSearch =
        email.recipient.toLowerCase().includes(filters.searchQuery.toLowerCase()) ||
        email.subject.toLowerCase().includes(filters.searchQuery.toLowerCase());
      const matchesStatus = filters.status === 'all' || email.status === filters.status;
      return matchesSearch && matchesStatus;
    });
  }, [sentEmails, filters.searchQuery, filters.status]);

  return {
    scheduledEmails: filteredScheduled,
    sentEmails: filteredSent,
    rawScheduledCount: stats.totalScheduled + stats.totalProcessing,
    rawSentCount: stats.totalSent + stats.totalFailed,
    stats,
    loading,
    refreshing,
    isSubmitting,
    filters,
    setFilters,
    refresh: () => loadData(true),
    scheduleBatch,
    cancelScheduledEmail,
    cancelAllScheduled,
  };
}
