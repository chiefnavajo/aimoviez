// hooks/useInstallPrompt.ts
// Handles PWA install prompt for Android and iOS

import { useState, useEffect, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface UseInstallPromptReturn {
  isInstallable: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isStandalone: boolean;
  promptInstall: () => Promise<boolean>;
  dismissPrompt: () => void;
  isDismissed: boolean;
}

const DISMISSED_KEY = 'pwa-install-dismissed';

export function useInstallPrompt(): UseInstallPromptReturn {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check if already dismissed
    const dismissed = localStorage.getItem(DISMISSED_KEY);
    if (dismissed === 'true') {
      setIsDismissed(true);
    }

    // Detect platform
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
    const isAndroidDevice = /android/.test(userAgent);

    setIsIOS(isIOSDevice);
    setIsAndroid(isAndroidDevice);

    // Check if already installed as PWA (standalone mode)
    const isInStandaloneMode =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      document.referrer.includes('android-app://');

    setIsStandalone(isInStandaloneMode);

    // Listen for beforeinstallprompt (Android/Chrome)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Listen for app installed
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      console.log('[PWA] App was installed');
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Trigger the install prompt (Android/Chrome)
  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[PWA] Install prompt error:', error);
      return false;
    }
  }, [deferredPrompt]);

  // Dismiss the install banner
  const dismissPrompt = useCallback(() => {
    setIsDismissed(true);
    localStorage.setItem(DISMISSED_KEY, 'true');
  }, []);

  // Determine if we should show install option
  // - Android: show if beforeinstallprompt fired (deferredPrompt exists)
  // - iOS: show if on iOS Safari and not standalone
  const isInstallable = !isStandalone && !isDismissed && (
    !!deferredPrompt || // Android/Chrome with prompt ready
    (isIOS && !isStandalone) // iOS Safari not installed
  );

  return {
    isInstallable,
    isIOS,
    isAndroid,
    isStandalone,
    promptInstall,
    dismissPrompt,
    isDismissed,
  };
}
