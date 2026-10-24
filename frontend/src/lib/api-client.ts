import {
  AuthUser,
  EmailRecord,
  ScheduleEmailsRequest,
  ScheduleEmailsResponse,
  EmailListResponse,
  EmailStats,
  CancelAllScheduledResponse,
} from '../types/api';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null ? (value as JsonRecord) : {};
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:4000/api');

export class ApiError extends Error {
  public code: string;
  public details?: unknown;
  public status: number;

  constructor(message: string, status: number, code = 'API_ERROR', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
      });

      let json: unknown = null;
      const text = await response.text();
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { message: text };
        }
      }

      const record = asRecord(json);

      if (!response.ok) {
        const errorData = asRecord(record.error);
        const message =
          (typeof errorData.message === 'string' && errorData.message) ||
          (typeof record.message === 'string' && record.message) ||
          `HTTP Error ${response.status}: ${response.statusText}`;
        const code =
          (typeof errorData.code === 'string' && errorData.code) || 'UNKNOWN_ERROR';
        throw new ApiError(message, response.status, code, errorData.details);
      }

      return (record.data !== undefined ? record.data : json) as T;
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Network request failed';
      throw new ApiError(message, 0, 'NETWORK_ERROR');
    }
  }

  public async getCurrentUser(): Promise<AuthUser> {
    return this.request<AuthUser>('/auth/me');
  }

  public async getGoogleAuthUrl(): Promise<{ authUrl: string }> {
    return this.request<{ authUrl: string }>('/auth/google');
  }

  public async devLogin(): Promise<AuthUser> {
    return this.request<AuthUser>('/auth/dev-login', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  public async logout(): Promise<void> {
    return this.request<void>('/auth/logout', { method: 'POST' });
  }

  public async scheduleEmails(payload: ScheduleEmailsRequest): Promise<ScheduleEmailsResponse> {
    return this.request<ScheduleEmailsResponse>('/emails/schedule', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public async getScheduledEmails(): Promise<EmailListResponse> {
    const res = await this.request<EmailListResponse | EmailRecord[]>(
      '/emails/scheduled?limit=100',
    );

    if (Array.isArray(res)) {
      return { items: res, total: res.length, nextCursor: null };
    }
    return res;
  }

  public async getSentEmails(): Promise<EmailListResponse> {
    const res = await this.request<EmailListResponse | EmailRecord[]>(
      '/emails/sent?limit=100',
    );
    if (Array.isArray(res)) {
      return { items: res, total: res.length, nextCursor: null };
    }
    return res;
  }

  public async getStats(): Promise<EmailStats> {
    return this.request<EmailStats>('/emails/stats');
  }

  public async cancelEmail(id: string): Promise<void> {
    return this.request<void>(`/emails/${id}`, { method: 'DELETE' });
  }

  public async cancelAllScheduledEmails(): Promise<CancelAllScheduledResponse> {
    return this.request<CancelAllScheduledResponse>('/emails/scheduled', {
      method: 'DELETE',
    });
  }

  public async getHealth(): Promise<{ status: string; uptime?: number }> {
    return this.request<{ status: string; uptime?: number }>('/health');
  }
}

export const apiClient = new ApiClient();
