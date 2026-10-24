import { apiClient } from '../lib/api-client';
import {
  EmailRecord,
  ScheduleEmailsRequest,
  ScheduleEmailsResponse,
  EmailStats,
  CancelAllScheduledResponse,
} from '../types/api';

export class EmailService {
  public static async fetchScheduled(): Promise<EmailRecord[]> {
    const res = await apiClient.getScheduledEmails();
    return res.items || [];
  }

  public static async fetchSent(): Promise<EmailRecord[]> {
    const res = await apiClient.getSentEmails();
    return res.items || [];
  }

  public static async scheduleEmails(payload: ScheduleEmailsRequest): Promise<ScheduleEmailsResponse> {
    return await apiClient.scheduleEmails(payload);
  }

  public static async cancelSchedule(id: string): Promise<void> {
    return await apiClient.cancelEmail(id);
  }

  public static async cancelAllScheduled(): Promise<CancelAllScheduledResponse> {
    return await apiClient.cancelAllScheduledEmails();
  }

  public static async fetchStats(): Promise<EmailStats> {
    return await apiClient.getStats();
  }
}
