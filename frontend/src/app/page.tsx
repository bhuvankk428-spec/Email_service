'use client';

import React, { useState } from 'react';
import { ToastProvider, useToast } from '../context/ToastContext';
import { useAuth } from '../hooks/useAuth';
import { useEmails } from '../hooks/useEmails';
import { LoginScreen } from '../components/auth/LoginScreen';
import { Sidebar } from '../components/layout/Sidebar';
import { TopBar } from '../components/layout/TopBar';
import { EmailListView } from '../components/emails/EmailListView';
import { EmailDetailView } from '../components/emails/EmailDetailView';
import { ComposeEmailView } from '../components/emails/ComposeEmailView';
import { CsvUploaderModal } from '../components/emails/CsvUploaderModal';
import { EmailRecord, ScheduleEmailsRequest } from '../types/api';

type DashboardView = 'list' | 'detail' | 'compose';

function DashboardApp() {
  const {
    user,
    isAuthenticated,
    loading: authLoading,
    devAuthEnabled,
    loginWithGoogle,
    loginWithDev,
    loginWithEmail,
    logout,
  } = useAuth();
  const {
    scheduledEmails,
    sentEmails,
    rawScheduledCount,
    rawSentCount,
    loading,
    refreshing,
    isSubmitting,
    refresh,
    scheduleBatch,
    cancelScheduledEmail,
    cancelAllScheduled,
  } = useEmails(isAuthenticated);

  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [currentView, setCurrentView] = useState<DashboardView>('list');
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [composeRecipients, setComposeRecipients] = useState<string[]>([]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 rounded-full border-2 border-[#A7F3D0] border-t-[#00A859] animate-spin" />
          <p className="text-xs font-medium text-gray-500">Checking your session...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <LoginScreen
        onGoogleLogin={loginWithGoogle}
        onDevLogin={loginWithDev}
        devAuthEnabled={devAuthEnabled}
        onEmailLogin={(email) => loginWithEmail(email)}
      />
    );
  }

  const displayedEmails = (activeTab === 'scheduled' ? scheduledEmails : sentEmails).filter(
    (e) =>
      e.recipient.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.body && e.body.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const loadedEmails = [...scheduledEmails, ...sentEmails];
  const detailEmail = selectedEmailId
    ? loadedEmails.find((email) => email.id === selectedEmailId) ?? null
    : sentEmails[0] ?? scheduledEmails[0] ?? null;

  const handleOpenDetail = (email: EmailRecord) => {
    setSelectedEmailId(email.id);
    setCurrentView('detail');
  };

  const handleScheduleSubmit = async (payload: ScheduleEmailsRequest): Promise<boolean> => {
    const success = await scheduleBatch(payload);
    if (success) {
      setActiveTab('scheduled');
      setCurrentView('list');
      return true;
    }
    return false;
  };

  const handleCancelEmail = async (id: string) => {
    const confirmed = window.confirm('Are you sure you want to cancel this scheduled email?');
    if (!confirmed) return;
    const cancelled = await cancelScheduledEmail(id);
    if (cancelled) {
      setSelectedEmailId(null);
      setCurrentView('list');
    }
  };

  const handleCancelAllScheduled = async () => {
    const confirmed = window.confirm(
      'Delete every queued scheduled email? Emails already processing cannot be cancelled. This cannot be undone.'
    );
    if (!confirmed) return;

    const deleted = await cancelAllScheduled();
    if (deleted !== null) {
      setSelectedEmailId(null);
      setCurrentView('list');
    }
  };

  const handleImportLeads = (newRecipients: string[]) => {
    setComposeRecipients((prev) => Array.from(new Set([...prev, ...newRecipients])));
    addToast({
      type: 'success',
      title: 'Leads Imported',
      message: `Added ${newRecipients.length} addresses to recipient list.`,
    });
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#111827] flex flex-col font-sans selection:bg-[#E8F8F0] selection:text-[#00A859]">
      <div className="flex-1 flex">

        <Sidebar
          user={user}
          activeTab={activeTab}
          onTabChange={(tab) => {
            setActiveTab(tab);
            setCurrentView('list');
          }}
          onComposeClick={() => setCurrentView('compose')}
          onLogout={logout}
          scheduledCount={rawScheduledCount}
          sentCount={rawSentCount}
        />

        <div className="flex-1 flex flex-col min-w-0 bg-[#F8F9FA]">

          <TopBar
            user={user}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onRefresh={refresh}
            refreshing={refreshing}
            onLogout={logout}
          />

          <main className="flex-1 bg-white">
            {currentView === 'list' && (
              <EmailListView
                emails={displayedEmails}
                activeTab={activeTab}
                loading={loading}
                onSelectEmail={handleOpenDetail}
                onCancelEmail={handleCancelEmail}
                onCancelAllScheduled={handleCancelAllScheduled}
                totalScheduled={rawScheduledCount}
                onComposeClick={() => setCurrentView('compose')}
              />
            )}

            {currentView === 'detail' && detailEmail && (
              <EmailDetailView
                email={detailEmail}
                onBack={() => setCurrentView('list')}
                onDelete={handleCancelEmail}
              />
            )}

            {currentView === 'detail' && !detailEmail && (
              <EmailListView
                emails={displayedEmails}
                activeTab={activeTab}
                loading={loading}
                onSelectEmail={handleOpenDetail}
                onCancelEmail={handleCancelEmail}
                onCancelAllScheduled={handleCancelAllScheduled}
                totalScheduled={rawScheduledCount}
                onComposeClick={() => setCurrentView('compose')}
              />
            )}

            {currentView === 'compose' && (
              <ComposeEmailView
                userEmail={user?.email ?? ''}
                onBack={() => setCurrentView('list')}
                onSubmit={handleScheduleSubmit}
                onOpenUploader={() => setIsUploaderOpen(true)}
                initialRecipients={composeRecipients}
                isSubmitting={isSubmitting}
              />
            )}
          </main>
        </div>
      </div>

      <CsvUploaderModal
        isOpen={isUploaderOpen}
        onClose={() => setIsUploaderOpen(false)}
        onImport={handleImportLeads}
      />

    </div>
  );
}

export default function Home() {
  return (
    <ToastProvider>
      <DashboardApp />
    </ToastProvider>
  );
}
