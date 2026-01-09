// hooks/useLandscapeVideo.ts
// Detects landscape orientation and manages auto-hide controls for immersive video

import { useState, useEffect, useCallback, useRef } from 'react';

interface UseLandscapeVideoOptions {
  autoHideDelay?: number; // ms before controls auto-hide (default: 3000)
  enabled?: boolean; // disable for tablets or when not needed
}

interface UseLandscapeVideoReturn {
  isLandscape: boolean;
  showControls: boolean;
  handleScreenTap: () => void;
}

export function useLandscapeVideo(options: UseLandscapeVideoOptions = {}): UseLandscapeVideoReturn {
  const { autoHideDelay = 3000, enabled = true } = options;

  const [isLandscape, setIsLandscape] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check if device is mobile (landscape mode mainly useful on phones)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // Clear any existing timeout
  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  // Start the auto-hide timer
  const startHideTimer = useCallback(() => {
    clearHideTimeout();
    if (isLandscape) {
      hideTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, autoHideDelay);
    }
  }, [isLandscape, autoHideDelay, clearHideTimeout]);

  // Handle screen tap - show controls and restart timer
  const handleScreenTap = useCallback(() => {
    if (isLandscape) {
      setShowControls(true);
      startHideTimer();
    }
  }, [isLandscape, startHideTimer]);

  // Detect orientation changes
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const checkOrientation = () => {
      // Use matchMedia for reliable orientation detection
      const landscapeQuery = window.matchMedia('(orientation: landscape)');
      const isNowLandscape = landscapeQuery.matches && isMobile;

      setIsLandscape(isNowLandscape);

      // When entering landscape, show controls initially then start hide timer
      if (isNowLandscape) {
        setShowControls(true);
        // Start hide timer after a short delay
        setTimeout(() => {
          startHideTimer();
        }, 100);
      } else {
        // In portrait, always show controls
        setShowControls(true);
        clearHideTimeout();
      }
    };

    // Initial check
    checkOrientation();

    // Listen for orientation changes
    const landscapeQuery = window.matchMedia('(orientation: landscape)');

    // Modern API
    if (landscapeQuery.addEventListener) {
      landscapeQuery.addEventListener('change', checkOrientation);
    } else {
      // Fallback for older browsers
      landscapeQuery.addListener(checkOrientation);
    }

    // Also listen for resize as fallback
    window.addEventListener('resize', checkOrientation);

    return () => {
      clearHideTimeout();
      if (landscapeQuery.removeEventListener) {
        landscapeQuery.removeEventListener('change', checkOrientation);
      } else {
        landscapeQuery.removeListener(checkOrientation);
      }
      window.removeEventListener('resize', checkOrientation);
    };
  }, [enabled, isMobile, startHideTimer, clearHideTimeout]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearHideTimeout();
    };
  }, [clearHideTimeout]);

  return {
    isLandscape: enabled ? isLandscape : false,
    showControls,
    handleScreenTap,
  };
}
