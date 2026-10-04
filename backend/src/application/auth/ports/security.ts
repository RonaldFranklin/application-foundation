export interface IdentityProtection {
  index(value: string, purpose?: string): string;
  encrypt(value: string, purpose: string): string;
  decrypt(value: string, purpose: string): string;
}
export interface Passwords {
  dummy: string;
  init(): Promise<void>;
  hash(value: string): Promise<string>;
  verify(hash: string, value: string): Promise<boolean>;
  run<T>(work: () => Promise<T>): Promise<T | null>;
}
export interface Tokens {
  generate(): string;
  digest(value: string): string;
  recoveryCode(): string;
}
export interface Totp {
  generateSecret(): string;
  uri(secret: string): string;
  step(secret: string, code: string): bigint | null;
}
export interface Captcha {
  verify(value: string, ip: string): Promise<boolean>;
}
export interface SecurityEvents {
  login(event: "login_failed" | "password_accepted", master: boolean): void;
}
