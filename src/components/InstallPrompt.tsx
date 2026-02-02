'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { X, Download, Share, Plus, Smartphone } from 'lucide-react';

interface InstallPromptProps {
  variant?: 'banner' | 'settings';
}

export function InstallPrompt({ variant = 'banner' }: InstallPromptProps) {
  const { isInstallable, isIOS, isStandalone, promptInstall, dismissPrompt } = useInstallPrompt();
  const [showIOSModal, setShowIOSModal] = useState(false);

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSModal(true);
    } else {
      await promptInstall();
    }
  };

  // Settings variant - always show option (unless already in PWA)
  if (variant === 'settings') {
    if (isStandalone) {
      return (
        <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
            <Smartphone className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">App Installed</p>
            <p className="text-xs text-white/60">You&apos;re using the installed app</p>
          </div>
        </div>
      );
    }

    return (
      <>
        <button
          onClick={handleInstallClick}
          className="w-full flex items-center gap-3 p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors text-left"
        >
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3CF2FF]/20 to-[#A020F0]/20 flex items-center justify-center">
            <Download className="w-5 h-5 text-[#3CF2FF]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">Install App</p>
            <p className="text-xs text-white/60">Add to your home screen</p>
          </div>
          <div className="text-white/40">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>

        {/* iOS Instructions Modal */}
        <IOSModal show={showIOSModal} onClose={() => setShowIOSModal(false)} />
      </>
    );
  }

  // Banner variant - only show if installable
  if (!isInstallable) return null;

  return (
    <>
      {/* Top Banner */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="absolute top-0 left-0 right-0 z-40 p-2 pt-safe"
      >
        <div className="mx-2 bg-gradient-to-r from-[#3CF2FF]/20 to-[#A020F0]/20 border border-white/10 rounded-xl backdrop-blur-md">
          <div className="flex items-center gap-2 px-3 py-2">
            {/* Icon */}
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#3CF2FF] to-[#A020F0] flex items-center justify-center flex-shrink-0">
              <Download className="w-4 h-4 text-white" />
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">
                Install AiMoviez for the best experience
              </p>
            </div>

            {/* Install button */}
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleInstallClick}
              className="px-3 py-1.5 bg-white text-black rounded-lg font-semibold text-xs flex-shrink-0"
            >
              Install
            </motion.button>

            {/* Dismiss button */}
            <button
              onClick={dismissPrompt}
              className="p-2 rounded-full hover:bg-white/20 active:bg-white/30 transition-colors flex-shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
      </motion.div>

      {/* iOS Instructions Modal */}
      <IOSModal show={showIOSModal} onClose={() => setShowIOSModal(false)} />
    </>
  );
}

// Separate iOS Modal component
function IOSModal({ show, onClose }: { show: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-[#1a1a2e] border border-white/10 rounded-2xl p-6 relative"
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/10 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-white/60" />
            </button>

            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#3CF2FF] to-[#A020F0] flex items-center justify-center mx-auto mb-4">
                <Download className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white mb-1">
                Install AiMoviez
              </h3>
              <p className="text-sm text-white/60">
                Add to your home screen for the best experience
              </p>
            </div>

            {/* Steps */}
            <div className="space-y-4">
              {/* Step 1 */}
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-[#3CF2FF]/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-[#3CF2FF]">1</span>
                </div>
                <div className="flex-1 pt-1">
                  <p className="text-sm text-white">
                    Tap the <strong>Share</strong> button
                  </p>
                  <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded-lg">
                    <Share className="w-5 h-5 text-[#007AFF]" />
                    <span className="text-xs text-white/70">Share</span>
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-[#3CF2FF]/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-[#3CF2FF]">2</span>
                </div>
                <div className="flex-1 pt-1">
                  <p className="text-sm text-white">
                    Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong>
                  </p>
                  <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded-lg">
                    <Plus className="w-5 h-5 text-white" />
                    <span className="text-xs text-white/70">Add to Home Screen</span>
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-[#3CF2FF]/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-[#3CF2FF]">3</span>
                </div>
                <div className="flex-1 pt-1">
                  <p className="text-sm text-white">
                    Tap <strong>&quot;Add&quot;</strong> in the top right corner
                  </p>
                </div>
              </div>
            </div>

            {/* Note */}
            <p className="mt-6 text-xs text-white/40 text-center">
              Make sure you&apos;re using Safari browser
            </p>

            {/* Close button */}
            <button
              onClick={onClose}
              className="mt-4 w-full py-3 bg-white/10 hover:bg-white/15 rounded-xl text-white font-medium transition-colors"
            >
              Got it
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
