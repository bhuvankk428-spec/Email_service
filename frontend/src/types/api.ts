export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export type UserProfile = AuthUser;

export type EmailStatus =
  | 'scheduled'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'cancelled';

export interface EmailRecord {
  id: string;
  batchId?: string;
  recipient: string;
  subject: string;
  body?: string;
  sender?: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  errorMessage?: string | null;
  createdAt: string;
  delayBetweenEmailsMs?: number;
  maxEmailsPerHour?: number;
  etherealUrl?: string | null;
}

export interface ScheduleEmailsRequest {
  subject: string;
  body: string;
  recipients: string[];
  startAt: string;
  delayBetweenEmailsMs?: number;
  maxEmailsPerHour?: number;
  idempotencyKey: string;
  sender?: string;
}

export type ScheduleBatchPayload = ScheduleEmailsRequest;

export interface ScheduleEmailsResponse {
  batchId: string;
  total?: number;
  acceptedCount: number;
  rejectedCount?: number;
  firstSendAt?: string;
  lastSendAt?: string;
  delayMs?: number;
  hourlyLimit?: number;
  status: 'scheduled' | 'partially_scheduled';
  message?: string;
  items?: EmailRecord[];
}

export interface CancelAllScheduledResponse {
  ok: boolean;
  deleted: number;
}

export interface EmailListResponse {
  items: EmailRecord[];
  total: number;
  nextCursor: string | null;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface EmailStats {
  totalScheduled: number;
  totalSent: number;
  totalFailed: number;
  totalProcessing: number;
}
