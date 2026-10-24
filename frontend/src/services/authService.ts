import { apiClient } from '../lib/api-client';
import { AuthUser } from '../types/api';

export class AuthService {
  public static async getUser(): Promise<AuthUser> {
    return await apiClient.getCurrentUser();
  }

  public static async initiateGoogleLogin(): Promise<string> {
    const res = await apiClient.getGoogleAuthUrl();
    return res.authUrl;
  }

  public static async devLogin(): Promise<AuthUser> {
    return await apiClient.devLogin();
  }

  public static async logout(): Promise<void> {
    return await apiClient.logout();
  }
}
