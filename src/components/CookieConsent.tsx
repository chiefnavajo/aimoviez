'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cookie, X, Settings, Check } from 'lucide-react';
import Link from 'next/link';

const COOKIE_CONSENT_KEY = 'aimoviez_cookie_consent';

interface CookiePreferences {
  essential: boolean; // Always true, required
  functional: boolean;
  analytics: boolean;
}

const DEFAULT_PREFERENCES: CookiePreferences = {
  essential: true,
  functional: true,
  analytics: false,
};

export default function CookieConsent() {
  const [isVisible, setIsVisible] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [preferences, setPreferences] = useState<CookiePreferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    // Check if user has already consented
    const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!consent) {
      // Small delay before showing banner
      const timer = setTimeout(() => setIsVisible(true), 1000);
      return () => clearTimeout(timer);
    } else {
      // Load saved preferences
      try {
        const savedPrefs = JSON.parse(consent);
        setPreferences(savedPrefs);
      } catch {
        // Invalid consent data, show banner again
        localStorage.removeItem(COOKIE_CONSENT_KEY);
        setIsVisible(true);
      }
    }
  }, []);

  const saveConsent = (prefs: CookiePreferences) => {
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(prefs));
    setPreferences(prefs);
    setIsVisible(false);
    setShowSettings(false);

    // Dispatch event for other components to react to consent changes
    window.dispatchEvent(new CustomEvent('cookieConsentChange', { detail: prefs }));
  };

  const acceptAll = () => {
    saveConsent({
      essential: true,
      functional: true,
      analytics: true,
    });
  };

  const acceptEssential = () => {
    saveConsent({
      essential: true,
      functional: false,
      analytics: false,
    });
  };

  const savePreferences = () => {
    saveConsent(preferences);
  };

  if (!isVisible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="fixed bottom-0 left-0 right-0 z-[100] p-4 md:p-6"
      >
        <div className="max-w-4xl mx-auto">
          <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            {/* Main Banner */}
            {!showSettings ? (
              <div className="p-4 md:p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-cyan-500/20 flex-shrink-0 hidden sm:flex">
                    <Cookie className="w-6 h-6 text-cyan-400" />
                  </div>

                  <div className="flex-1">
                    <h3 className="text-lg font-bold mb-2">We use cookies</h3>
                    <p className="text-sm text-white/70 mb-4">
                      We use cookies to improve your experience, analyze traffic, and personalize content.
                      By clicking "Accept All", you consent to our use of cookies.{' '}
                      <Link href="/privacy" className="text-cyan-400 hover:underline">
                        Learn more
                      </Link>
                    </p>

                    <div className="flex flex-wrap gap-3">
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={acceptAll}
                        className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-cyan-500/20 transition-all"
                      >
                        Accept All
                      </motion.button>

                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={acceptEssential}
                        className="px-5 py-2.5 bg-white/10 rounded-xl font-semibold text-sm hover:bg-white/20 transition-colors"
                      >
                        Essential Only
                      </motion.button>

                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setShowSettings(true)}
                        className="px-5 py-2.5 bg-white/5 rounded-xl font-semibold text-sm hover:bg-white/10 transition-colors flex items-center gap-2"
                      >
                        <Settings className="w-4 h-4" />
                        Customize
                      </motion.button>
                    </div>
                  </div>

                  <button
                    onClick={acceptEssential}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors flex-shrink-0"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5 text-white/60" />
                  </button>
                </div>
              </div>
            ) : (
              /* Settings Panel */
              <div className="p-4 md:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold">Cookie Preferences</h3>
                  <button
                    onClick={() => setShowSettings(false)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    aria-label="Close settings"
                  >
                    <X className="w-5 h-5 text-white/60" />
                  </button>
                </div>

                <div className="space-y-4 mb-6">
                  {/* Essential Cookies */}
                  <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold">Essential</h4>
                        <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded-full text-xs">
                          Required
                        </span>
                      </div>
                      <p className="text-sm text-white/60">
                        Required for the website to function. Cannot be disabled.
                      </p>
                    </div>
                    <div className="p-2 bg-green-500/20 rounded-lg">
                      <Check className="w-5 h-5 text-green-400" />
                    </div>
                  </div>

                  {/* Functional Cookies */}
                  <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
                    <div className="flex-1">
                      <h4 className="font-semibold mb-1">Functional</h4>
                      <p className="text-sm text-white/60">
                        Remember your preferences, settings, and enhance features.
                      </p>
                    </div>
                    <button
                      onClick={() => setPreferences(p => ({ ...p, functional: !p.functional }))}
                      className={`w-12 h-7 rounded-full transition-colors relative ${
                        preferences.functional ? 'bg-cyan-500' : 'bg-white/20'
                      }`}
                      aria-label={`${preferences.functional ? 'Disable' : 'Enable'} functional cookies`}
                    >
                      <motion.div
                        animate={{ x: preferences.functional ? 22 : 2 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        className="w-5 h-5 bg-white rounded-full absolute top-1"
                      />
                    </button>
                  </div>

                  {/* Analytics Cookies */}
                  <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
                    <div className="flex-1">
                      <h4 className="font-semibold mb-1">Analytics</h4>
                      <p className="text-sm text-white/60">
                        Help us understand how visitors interact with the website.
                      </p>
                    </div>
                    <button
                      onClick={() => setPreferences(p => ({ ...p, analytics: !p.analytics }))}
                      className={`w-12 h-7 rounded-full transition-colors relative ${
                        preferences.analytics ? 'bg-cyan-500' : 'bg-white/20'
                      }`}
                      aria-label={`${preferences.analytics ? 'Disable' : 'Enable'} analytics cookies`}
                    >
                      <motion.div
                        animate={{ x: preferences.analytics ? 22 : 2 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        className="w-5 h-5 bg-white rounded-full absolute top-1"
                      />
                    </button>
                  </div>
                </div>

                <div className="flex gap-3">
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={savePreferences}
                    className="flex-1 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-cyan-500/20 transition-all"
                  >
                    Save Preferences
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={acceptAll}
                    className="px-5 py-2.5 bg-white/10 rounded-xl font-semibold text-sm hover:bg-white/20 transition-colors"
                  >
                    Accept All
                  </motion.button>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// Hook to check cookie consent
export function useCookieConsent() {
  const [consent, setConsent] = useState<CookiePreferences | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (stored) {
      try {
        setConsent(JSON.parse(stored));
      } catch {
        setConsent(null);
      }
    }

    const handleChange = (e: CustomEvent<CookiePreferences>) => {
      setConsent(e.detail);
    };

    window.addEventListener('cookieConsentChange', handleChange as EventListener);
    return () => window.removeEventListener('cookieConsentChange', handleChange as EventListener);
  }, []);

  return consent;
}
