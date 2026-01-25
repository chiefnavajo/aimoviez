'use client';

// ============================================================================
// SPOTLIGHT ONBOARDING TOUR
// CSS box-shadow based spotlight with smooth transitions
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface TourStep {
  id: string;
  title: string;
  description: string;
  target: string; // data-tour attribute value
  emoji: string;
  position: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

interface SpotlightTourProps {
  onComplete: () => void;
  onSkip: () => void;
}

// ============================================================================
// TOUR STEPS (Simplified to 5 key steps)
// ============================================================================

const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to AiMoviez!',
    description: 'Help create a collaborative movie, one 8-second clip at a time. Clips compete for slots - the most voted clip wins each round!',
    target: 'video-area',
    emoji: '🎬',
    position: 'center',
  },
  {
    id: 'how-it-works',
    title: 'How Seasons Work',
    description: 'Each season has multiple slots. The winning clips are stitched together to form a 10-minute movie. Vote to decide which clips make the final cut!',
    target: 'video-area',
    emoji: '🏆',
    position: 'center',
  },
  {
    id: 'vote-button',
    title: 'Vote for Your Favorites',
    description: 'Tap the infinity button to vote. You have 200 votes per day - use them to help your favorite clips win their slot!',
    target: 'vote-button',
    emoji: '❤️',
    position: 'left',
  },
  {
    id: 'double-tap',
    title: 'Double-Tap to Vote',
    description: 'You can also double-tap anywhere on the video to quickly cast your vote!',
    target: 'video-area',
    emoji: '👆',
    position: 'center',
  },
  {
    id: 'navigation',
    title: 'Swipe to Explore',
    description: 'Swipe up/down or use the arrows to browse competing clips. Compare them and vote for the best one!',
    target: 'nav-arrows',
    emoji: '📱',
    position: 'right',
  },
  {
    id: 'bottom-menu',
    title: 'Explore the App',
    description: 'Story: watch the movie so far. Watch: browse clips. Upload: add your own. Ranks: see top voters & creators. Profile: your stats.',
    target: 'bottom-nav',
    emoji: '🧭',
    position: 'top',
  },
  {
    id: 'ready',
    title: "You're Ready!",
    description: 'Start voting now! When a slot closes, the clip with the most votes wins and joins the story. Help shape the movie!',
    target: 'vote-button',
    emoji: '🚀',
    position: 'left',
  },
];

// ============================================================================
// TOOLTIP COMPONENT
// ============================================================================

interface TooltipProps {
  step: TourStep;
  targetRect: DOMRect | null;
  isFirstStep: boolean;
  isLastStep: boolean;
  currentStep: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}

function TourTooltip({
  step,
  targetRect,
  isFirstStep,
  isLastStep,
  currentStep,
  totalSteps,
  onNext,
  onPrev,
  onSkip,
}: TooltipProps) {
  const getPosition = useCallback(() => {
    // Always center the tooltip for consistent mobile experience
    // This works better across all devices and screen sizes
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }, []);

  const position = getPosition();
  const progress = ((currentStep + 1) / totalSteps) * 100;

  return (
    <motion.div
      key={step.id}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="fixed z-[102] w-[85vw] max-w-[320px] bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 rounded-2xl border border-white/20 overflow-hidden shadow-2xl"
      style={position}
    >
      {/* Progress Bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-white/10">
        <motion.div
          className="h-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      {/* Skip Button */}
      <button
        onClick={onSkip}
        className="absolute top-3 right-3 p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
        aria-label="Skip tour"
      >
        <X className="w-4 h-4 text-white/70" />
      </button>

      {/* Content */}
      <div className="p-4 sm:p-5 pt-5 sm:pt-6">
        {/* Emoji Icon */}
        <motion.div
          key={`emoji-${step.id}`}
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', damping: 15, stiffness: 200, delay: 0.1 }}
          className="w-12 h-12 sm:w-14 sm:h-14 mx-auto mb-3 sm:mb-4 rounded-xl bg-gradient-to-br from-cyan-500/20 via-purple-500/20 to-pink-500/20 border border-white/20 flex items-center justify-center"
        >
          <span className="text-2xl sm:text-3xl">{step.emoji}</span>
        </motion.div>

        {/* Title */}
        <motion.h2
          key={`title-${step.id}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="text-base sm:text-lg font-bold text-center text-white mb-1.5 sm:mb-2"
        >
          {step.title}
        </motion.h2>

        {/* Description */}
        <motion.p
          key={`desc-${step.id}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-white/70 text-center text-xs sm:text-sm leading-relaxed mb-4 sm:mb-5"
        >
          {step.description}
        </motion.p>

        {/* Step Indicators */}
        <div className="flex justify-center gap-1 sm:gap-1.5 mb-3 sm:mb-4">
          {TOUR_STEPS.map((_, index) => (
            <div
              key={index}
              className={`h-1.5 rounded-full transition-all ${
                index === currentStep
                  ? 'w-6 bg-gradient-to-r from-cyan-500 to-purple-500'
                  : index < currentStep
                  ? 'w-1.5 bg-white/50'
                  : 'w-1.5 bg-white/20'
              }`}
            />
          ))}
        </div>

        {/* Navigation Buttons */}
        <div className="flex gap-2">
          {!isFirstStep && (
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={onPrev}
              className="flex-1 py-2.5 rounded-xl bg-white/10 border border-white/20 font-semibold text-white text-sm hover:bg-white/20 transition-colors flex items-center justify-center gap-1"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </motion.button>
          )}

          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={onNext}
            className={`flex-1 py-2.5 rounded-xl font-bold text-white text-sm transition-all flex items-center justify-center gap-1 ${
              isLastStep
                ? 'bg-gradient-to-r from-green-500 to-emerald-500 hover:shadow-lg hover:shadow-green-500/30'
                : 'bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 hover:shadow-lg hover:shadow-purple-500/30'
            }`}
          >
            {isLastStep ? (
              <>
                Start Voting!
                <Sparkles className="w-4 h-4" />
              </>
            ) : (
              <>
                Next
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </motion.button>
        </div>

        {/* Skip Link */}
        {!isLastStep && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            onClick={onSkip}
            className="w-full mt-3 text-white/50 text-xs hover:text-white/70 transition-colors"
          >
            Skip tour
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================================
// SPOTLIGHT OVERLAY
// ============================================================================

interface SpotlightOverlayProps {
  targetRect: DOMRect | null;
  isCenter: boolean;
}

function SpotlightOverlay({ targetRect, isCenter }: SpotlightOverlayProps) {
  if (isCenter || !targetRect) {
    // Full dark overlay for center/welcome steps
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm"
      />
    );
  }

  // Spotlight with cutout using CSS box-shadow
  const padding = 8;
  const borderRadius = 16;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] pointer-events-none"
    >
      {/* The spotlight cutout */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="absolute"
        style={{
          top: targetRect.top - padding,
          left: targetRect.left - padding,
          width: targetRect.width + padding * 2,
          height: targetRect.height + padding * 2,
          borderRadius: borderRadius,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.85)',
        }}
      />

      {/* Highlight ring around the target */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.3 }}
        className="absolute pointer-events-none"
        style={{
          top: targetRect.top - padding - 2,
          left: targetRect.left - padding - 2,
          width: targetRect.width + padding * 2 + 4,
          height: targetRect.height + padding * 2 + 4,
          borderRadius: borderRadius + 2,
          border: '2px solid rgba(60, 242, 255, 0.6)',
          boxShadow: '0 0 20px rgba(60, 242, 255, 0.4), inset 0 0 20px rgba(60, 242, 255, 0.1)',
        }}
      />
    </motion.div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function SpotlightTour({ onComplete, onSkip }: SpotlightTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const observerRef = useRef<ResizeObserver | null>(null);

  const step = TOUR_STEPS[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === TOUR_STEPS.length - 1;
  const isCenter = step.position === 'center';

  // Find and track the target element
  useEffect(() => {
    const findTarget = () => {
      const target = document.querySelector(`[data-tour="${step.target}"]`);
      if (target) {
        const rect = target.getBoundingClientRect();
        setTargetRect(rect);

        // Observe size changes
        if (observerRef.current) {
          observerRef.current.disconnect();
        }
        observerRef.current = new ResizeObserver(() => {
          const newRect = target.getBoundingClientRect();
          setTargetRect(newRect);
        });
        observerRef.current.observe(target);
      } else {
        setTargetRect(null);
      }
    };

    findTarget();

    // Re-find on window resize
    const handleResize = () => findTarget();
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize);
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [step.target]);

  const handleNext = useCallback(() => {
    if (isLastStep) {
      setIsVisible(false);
      setTimeout(onComplete, 300);
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  }, [isLastStep, onComplete]);

  const handlePrev = useCallback(() => {
    if (!isFirstStep) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [isFirstStep]);

  const handleSkip = useCallback(() => {
    setIsVisible(false);
    setTimeout(onSkip, 300);
  }, [onSkip]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'Escape') {
        handleSkip();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrev, handleSkip]);

  return (
    <AnimatePresence>
      {isVisible && (
        <>
          {/* Click blocker - prevents interacting with elements behind */}
          <div
            className="fixed inset-0 z-[99]"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Spotlight Overlay */}
          <SpotlightOverlay targetRect={targetRect} isCenter={isCenter} />

          {/* Tooltip */}
          <TourTooltip
            step={step}
            targetRect={targetRect}
            isFirstStep={isFirstStep}
            isLastStep={isLastStep}
            currentStep={currentStep}
            totalSteps={TOUR_STEPS.length}
            onNext={handleNext}
            onPrev={handlePrev}
            onSkip={handleSkip}
          />
        </>
      )}
    </AnimatePresence>
  );
}

// ============================================================================
// HOOK: useSpotlightTour
// Manages spotlight tour state with localStorage
// ============================================================================

const SPOTLIGHT_TOUR_KEY = 'aimoviez_spotlight_tour_completed';

export function useSpotlightTour() {
  const [showTour, setShowTour] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const completed = localStorage.getItem(SPOTLIGHT_TOUR_KEY);
    if (!completed) {
      setShowTour(true);
    }
    setIsLoading(false);
  }, []);

  const completeTour = () => {
    localStorage.setItem(SPOTLIGHT_TOUR_KEY, 'true');
    setShowTour(false);
  };

  const skipTour = () => {
    localStorage.setItem(SPOTLIGHT_TOUR_KEY, 'skipped');
    setShowTour(false);
  };

  const resetTour = () => {
    localStorage.removeItem(SPOTLIGHT_TOUR_KEY);
    setShowTour(true);
  };

  return {
    showTour,
    isLoading,
    completeTour,
    skipTour,
    resetTour,
  };
}
