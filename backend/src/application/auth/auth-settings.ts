// Validated at the composition boundary; no framework/config loader dependency.
export interface AuthSettings {
  MASTER_USERNAME: string;
  MASTER_EMAIL: string;
  MASTER_INITIAL_PASSWORD: string;
  ACCOUNT_WINDOW_MS: number;
  ACCOUNT_FAILURE_LIMIT: number;
  COOLDOWN_BASE_MS: number;
  COOLDOWN_MAX_MS: number;
  MASTER_COOLDOWN_BASE_MS: number;
  MASTER_COOLDOWN_MAX_MS: number;
  SESSION_HOURS: number;
  MASTER_DEVICE_DAYS: number;
  TURNSTILE_THRESHOLD: number;
  API_IP_LIMIT: number;
  LOGIN_IP_LIMIT: number;
}
