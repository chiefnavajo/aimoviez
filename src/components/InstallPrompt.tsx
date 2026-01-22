'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { X, Download, Share, Plus } from 'lucide-react';

export function InstallPrompt() {
  const { isInstallable, isIOS, promptInstall, dismissPrompt } = useInstallPrompt();
  const [showIOSModal, setShowIOSModal] = useState(false);

  if (!isInstallable) return null;

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSModal(true);
    } else {
      const installed = await promptInstall();
      if (installed) {
        // App was installed
      }
    }
  };

  return (
    <>
      {/* Install Banner */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mt-4 relative"
      >
        <div className="bg-gradient-to-r from-[#3CF2FF]/10 to-[#A020F0]/10 border border-white/10 rounded-xl p-4 backdrop-blur-sm">
          {/* Dismiss button */}
          <button
            onClick={dismissPrompt}
            className="absolute top-2 right-2 p-1.5 rounded-full hover:bg-white/10 transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4 text-white/50" />
          </button>

          <div className="flex items-center gap-3">
            {/* App icon */}
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#3CF2FF] to-[#A020F0] flex items-center justify-center flex-shrink-0">
              <Download className="w-6 h-6 text-white" />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">
                Install AiMoviez
              </p>
              <p className="text-xs text-white/60 truncate">
                {isIOS ? 'Add to your home screen' : 'Get the full app experience'}
              </p>
            </div>

            {/* Install button */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleInstallClick}
              className="px-4 py-2 bg-white text-black rounded-lg font-semibold text-sm flex-shrink-0"
            >
              Install
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* iOS Instructions Modal */}
      <AnimatePresence>
        {showIOSModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
            onClick={() => setShowIOSModal(false)}
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
                onClick={() => setShowIOSModal(false)}
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
                onClick={() => setShowIOSModal(false)}
                className="mt-4 w-full py-3 bg-white/10 hover:bg-white/15 rounded-xl text-white font-medium transition-colors"
              >
                Got it
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
