import 'dotenv/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readSmtpConfig } = require('../dist/infra/email/smtp-config.js');
const { smtpOptions } = require('../dist/infra/email/smtp-sender.js');
const nodemailer = require('nodemailer');

let transport;
try {
  // Validate SMTP settings without enabling the email worker or requiring Redis.
  const config = readSmtpConfig(
    { ...process.env, EMAIL_DELIVERY_ENABLED: 'true' },
    true,
  );
  if (!config.enabled) throw new Error('SMTP is disabled');

  transport = nodemailer.createTransport(smtpOptions(config));
  await transport.verify();
  console.log('SMTP connection, TLS and authentication verified. No email was sent.');
} catch {
  console.error(
    'SMTP verification failed. Check Gmail 2-Step Verification, the app password, SMTP_USER, EMAIL_FROM and network access. Provider details and credentials were suppressed.',
  );
  process.exitCode = 1;
} finally {
  transport?.close();
}
