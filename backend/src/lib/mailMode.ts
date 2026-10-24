export const LOCAL_MAIL_HOST = 'outbox.local';

export function isLocalMailHost(host: string): boolean {
  return host === LOCAL_MAIL_HOST;
}
