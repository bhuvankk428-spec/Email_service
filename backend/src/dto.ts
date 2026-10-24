import type { Email, Sender, User } from '@prisma/client';

type EmailWithSender = Email & { sender?: Pick<Sender, 'user'> | null };

export interface UserDto {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  avatarUrl: string | null;
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar ?? null,
    avatarUrl: user.avatar ?? null,
  };
}

export interface ScheduledEmailDto {
  id: string;
  email: string;
  recipient: string;
  subject: string;
  body: string;
  batchId: string;
  sender: string | null;
  scheduledAt: string;
  createdAt: string;
  status: 'scheduled' | 'processing';
}

export interface SentEmailDto {
  id: string;
  email: string;
  recipient: string;
  subject: string;
  body: string;
  batchId: string;
  sender: string | null;
  scheduledAt: string;
  sentAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  status: 'sent' | 'failed';
  previewUrl: string | null;
  etherealUrl: string | null;
  error: string | null;
  errorMessage: string | null;
}

export function toScheduledDto(email: EmailWithSender): ScheduledEmailDto {
  const status = email.status === 'PROCESSING' ? 'processing' : 'scheduled';
  return {
    id: email.id,
    email: email.toEmail,
    recipient: email.toEmail,
    subject: email.subject,
    body: email.body,
    batchId: email.batchId,
    sender: email.sender?.user ?? null,
    scheduledAt: email.scheduledAt.toISOString(),
    createdAt: email.createdAt.toISOString(),
    status,
  };
}

export function toSentDto(email: EmailWithSender): SentEmailDto {
  const finishedAt = email.finishedAt ? email.finishedAt.toISOString() : null;
  return {
    id: email.id,
    email: email.toEmail,
    recipient: email.toEmail,
    subject: email.subject,
    body: email.body,
    batchId: email.batchId,
    sender: email.sender?.user ?? null,
    scheduledAt: email.scheduledAt.toISOString(),
    sentAt: finishedAt,
    finishedAt,
    createdAt: email.createdAt.toISOString(),
    status: email.status === 'FAILED' ? 'failed' : 'sent',
    previewUrl: email.previewUrl ?? null,
    etherealUrl: email.previewUrl ?? null,
    error: email.error ?? null,
    errorMessage: email.error ?? null,
  };
}
