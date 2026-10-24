import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Sender } from '@prisma/client';
import { env } from '../config/env.js';
import { isLocalMailHost } from '../lib/mailMode.js';

const transports = new Map<string, Transporter>();

export interface SenderCredentials {
  id: string;
  host: string;
  port: number;
  user: string;
  pass: string;
}

export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  html: string;
  messageId: string;
}

export interface SendResult {
  messageId: string | undefined;
  previewUrl: string | null;
}

export function getTransport(sender: Sender | SenderCredentials): Transporter {
  const existing = transports.get(sender.id);
  if (existing) return existing;

  const transport = isLocalMailHost(sender.host)
    ? nodemailer.createTransport({
        streamTransport: true,
        buffer: true,
        newline: 'unix',
      })
    : nodemailer.createTransport({
        host: sender.host,
        port: sender.port,
        secure: false,
        auth: { user: sender.user, pass: sender.pass },
        pool: true,
        maxConnections: 2,
        maxMessages: 50,
      });

  transports.set(sender.id, transport);
  return transport;
}

export async function sendEmail(
  sender: Sender | SenderCredentials,
  mail: OutgoingMail,
  emailId: string,
): Promise<SendResult> {
  const info = await getTransport(sender).sendMail(mail);

  if (isLocalMailHost(sender.host)) {
    const outboxDir = path.resolve(env.LOCAL_OUTBOX_DIR);
    const fileName = `${emailId.replace(/[^a-zA-Z0-9-]/g, '')}.eml`;
    await mkdir(outboxDir, { recursive: true });
    const raw = Buffer.isBuffer(info.message)
      ? info.message
      : Buffer.from(String(info.message));
    await writeFile(path.join(outboxDir, fileName), raw);
    return { messageId: info.messageId, previewUrl: null };
  }

  return {
    messageId: info.messageId,
    previewUrl: nodemailer.getTestMessageUrl(info) || null,
  };
}

export async function closeMailer(): Promise<void> {
  await Promise.all(
    [...transports.values()].map((transport) =>
      Promise.resolve(transport.close()).catch(() => undefined),
    ),
  );
  transports.clear();
}
