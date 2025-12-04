// hCaptcha verification utilities
// Docs: https://docs.hcaptcha.com/

const HCAPTCHA_SECRET = process.env.HCAPTCHA_SECRET_KEY;
const HCAPTCHA_VERIFY_URL = 'https://hcaptcha.com/siteverify';

export interface CaptchaVerifyResult {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  credit?: boolean;
  error_codes?: string[];
}

/**
 * Verify an hCaptcha token server-side
 */
export async function verifyCaptcha(token: string, remoteIp?: string): Promise<CaptchaVerifyResult> {
  if (!HCAPTCHA_SECRET) {
    console.warn('[CAPTCHA] HCAPTCHA_SECRET_KEY not configured, skipping verification');
    // In development or if not configured, allow requests through
    return { success: true };
  }

  if (!token) {
    return {
      success: false,
      error_codes: ['missing-input-response'],
    };
  }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', HCAPTCHA_SECRET);
    formData.append('response', token);
    if (remoteIp) {
      formData.append('remoteip', remoteIp);
    }

    const response = await fetch(HCAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      console.error('[CAPTCHA] Verification request failed:', response.status);
      return {
        success: false,
        error_codes: ['request-failed'],
      };
    }

    const result: CaptchaVerifyResult = await response.json();

    if (!result.success) {
      console.warn('[CAPTCHA] Verification failed:', result.error_codes);
    }

    return result;
  } catch (error) {
    console.error('[CAPTCHA] Verification error:', error);
    return {
      success: false,
      error_codes: ['internal-error'],
    };
  }
}

/**
 * Check if CAPTCHA is required based on feature flag or configuration
 */
export async function isCaptchaRequired(): Promise<boolean> {
  // Could check a feature flag here
  // For now, require CAPTCHA if the secret is configured
  return !!HCAPTCHA_SECRET;
}

/**
 * Get client IP from request headers
 */
export function getClientIp(headers: Headers): string | undefined {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return headers.get('x-real-ip') || undefined;
}
