'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import HCaptcha from '@hcaptcha/react-hcaptcha';

// ============================================================================
// CAPTCHA VERIFICATION COMPONENT
// Wraps hCaptcha for bot protection on sensitive actions (voting, etc.)
// ============================================================================

interface CaptchaVerificationProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: (error: string) => void;
  size?: 'normal' | 'compact' | 'invisible';
  theme?: 'light' | 'dark';
  className?: string;
}

const HCAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || '';

export function CaptchaVerification({
  onVerify,
  onExpire,
  onError,
  size = 'normal',
  theme = 'dark',
  className = '',
}: CaptchaVerificationProps) {
  const captchaRef = useRef<HCaptcha>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Handle successful verification
  const handleVerify = useCallback(
    (token: string) => {
      onVerify(token);
    },
    [onVerify]
  );

  // Handle token expiration
  const handleExpire = useCallback(() => {
    onExpire?.();
  }, [onExpire]);

  // Handle errors
  const handleError = useCallback(
    (err: string) => {
      console.error('[CaptchaVerification] Error:', err);
      onError?.(err);
    },
    [onError]
  );

  // Reset captcha (useful after form submission)
  const _reset = useCallback(() => {
    captchaRef.current?.resetCaptcha();
  }, []);

  // Execute invisible captcha programmatically
  const _execute = useCallback(() => {
    if (size === 'invisible') {
      captchaRef.current?.execute();
    }
  }, [size]);

  // If no site key configured, don't render captcha
  if (!HCAPTCHA_SITE_KEY) {
    console.warn('[CaptchaVerification] NEXT_PUBLIC_HCAPTCHA_SITE_KEY not configured');
    return null;
  }

  return (
    <div className={`captcha-container ${className}`}>
      <HCaptcha
        ref={captchaRef}
        sitekey={HCAPTCHA_SITE_KEY}
        onVerify={handleVerify}
        onExpire={handleExpire}
        onError={handleError}
        onLoad={() => setIsLoaded(true)}
        size={size}
        theme={theme}
      />
      {!isLoaded && (
        <div className="text-sm text-gray-500 animate-pulse">
          Loading verification...
        </div>
      )}
    </div>
  );
}

// ============================================================================
// INVISIBLE CAPTCHA HOOK
// For programmatic captcha execution (e.g., on vote button click)
// ============================================================================

interface UseInvisibleCaptchaOptions {
  onVerify: (token: string) => void;
  onError?: (error: string) => void;
}

export function useInvisibleCaptcha({ onVerify, onError }: UseInvisibleCaptchaOptions) {
  const captchaRef = useRef<HCaptcha>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const execute = useCallback(async (): Promise<string | null> => {
    if (!HCAPTCHA_SITE_KEY) {
      // No captcha configured, return null (voting will proceed without it)
      return null;
    }

    setIsExecuting(true);
    try {
      const response = await captchaRef.current?.execute({ async: true });
      if (response?.response) {
        setToken(response.response);
        onVerify(response.response);
        return response.response;
      }
      return null;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      onError?.(errorMsg);
      return null;
    } finally {
      setIsExecuting(false);
    }
  }, [onVerify, onError]);

  const reset = useCallback(() => {
    captchaRef.current?.resetCaptcha();
    setToken(null);
  }, []);

  const CaptchaWidget = useCallback(
    () =>
      HCAPTCHA_SITE_KEY ? (
        <HCaptcha
          ref={captchaRef}
          sitekey={HCAPTCHA_SITE_KEY}
          size="invisible"
          onVerify={(t) => setToken(t)}
          onError={(e) => onError?.(e)}
        />
      ) : null,
    [onError]
  );

  return {
    execute,
    reset,
    isExecuting,
    token,
    CaptchaWidget,
    isConfigured: !!HCAPTCHA_SITE_KEY,
  };
}

// ============================================================================
// CAPTCHA REQUIREMENT CHECK HOOK
// Checks if captcha is required from the server
// ============================================================================

export function useCaptchaRequired() {
  const [isRequired, setIsRequired] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function checkCaptchaRequired() {
      try {
        const res = await fetch('/api/captcha/status');
        if (res.ok) {
          const data = await res.json();
          setIsRequired(data.required);
        }
      } catch {
        // Default to not required if check fails
        setIsRequired(false);
      } finally {
        setIsLoading(false);
      }
    }

    checkCaptchaRequired();
  }, []);

  return { isRequired, isLoading };
}

export default CaptchaVerification;
