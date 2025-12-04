'use client';

import { useEffect, useRef } from 'react';

export function ServiceWorkerRegistration() {
  // MEMORY LEAK FIX: Store interval ID for cleanup
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    // Register service worker
    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        registrationRef.current = registration;
        console.log('[PWA] Service Worker registered:', registration.scope);

        // Check for updates periodically - store interval ID for cleanup
        intervalRef.current = setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000); // Check every hour
      } catch (error) {
        console.error('[PWA] Service Worker registration failed:', error);
      }
    };

    // Register after page is fully loaded
    if (document.readyState === 'complete') {
      registerSW();
    } else {
      window.addEventListener('load', registerSW, { once: true });
    }

    // MEMORY LEAK FIX: Cleanup on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // Note: We don't unregister the service worker itself as it should persist
    };
  }, []);

  return null;
}
