'use client';

// ============================================================================
// MINIMAL COACH MARKS TOUR
// Small tooltips with arrows pointing to elements
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ============================================================================
// TYPES
// ============================================================================

interface TourStep {
  id: string;
  text: string; // Short text (max 10 words)
  target: string; // data-tour attribute value
  emoji: string;
}

interface SpotlightTourProps {
  onComplete: () => void;
  onSkip: () => void;
}

// ============================================================================
// TOUR STEPS - Short and sweet
// ============================================================================

const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    text: 'Clips compete for slots. Most votes wins!',
    target: 'video-area',
    emoji: '🎬',
  },
  {
    id: 'vote-button',
    text: 'Tap to vote! 200 votes per day.',
    target: 'vote-button',
    emoji: '❤️',
  },
  {
    id: 'double-tap',
    text: 'Or double-tap the video!',
    target: 'video-area',
    emoji: '👆',
  },
  {
    id: 'navigation',
    text: 'Swipe to see more clips',
    target: 'nav-arrows',
    emoji: '📱',
  },
  {
    id: 'bottom-menu',
    text: 'Story • Watch • Upload • Ranks • Profile',
    target: 'bottom-nav',
    emoji: '🧭',
  },
];

// ============================================================================
// COACH MARK TOOLTIP
// ============================================================================

interface CoachMarkProps {
  step: TourStep;
  targetRect: DOMRect | null;
  onTap: () => void;
}

function CoachMark({ step, targetRect, onTap }: CoachMarkProps) {
  // Calculate position based on target
  const getPosition = useCallback(() => {
    if (!targetRect) {
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', arrowDirection: 'none' as const };
    }

    const padding = 12;
    const tooltipHeight = 60;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Determine best position (prefer top, then bottom, then center)
    const spaceAbove = targetRect.top;
    const spaceBelow = viewportHeight - targetRect.bottom;

    // For bottom nav, show above
    if (step.target === 'bottom-nav') {
      return {
        bottom: `${viewportHeight - targetRect.top + padding}px`,
        left: '50%',
        transform: 'translateX(-50%)',
        arrowDirection: 'down' as const,
      };
    }

    // For vote button (right side), show to the left
    if (step.target === 'vote-button') {
      return {
        top: `${targetRect.top + targetRect.height / 2}px`,
        right: `${viewportWidth - targetRect.left + padding}px`,
        transform: 'translateY(-50%)',
        arrowDirection: 'right' as const,
      };
    }

    // For nav arrows (left side), show to the right
    if (step.target === 'nav-arrows') {
      return {
        top: `${targetRect.top + targetRect.height / 2}px`,
        left: `${targetRect.right + padding}px`,
        transform: 'translateY(-50%)',
        arrowDirection: 'left' as const,
      };
    }

    // Default: show above or below center
    if (spaceAbove > tooltipHeight + padding) {
      return {
        top: `${targetRect.top - tooltipHeight - padding}px`,
        left: '50%',
        transform: 'translateX(-50%)',
        arrowDirection: 'down' as const,
      };
    } else if (spaceBelow > tooltipHeight + padding) {
      return {
        top: `${targetRect.bottom + padding}px`,
        left: '50%',
        transform: 'translateX(-50%)',
        arrowDirection: 'up' as const,
      };
    }

    // Fallback: center of screen
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      arrowDirection: 'none' as const,
    };
  }, [targetRect, step.target]);

  const position = getPosition();
  const { arrowDirection, ...positionStyles } = position;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ type: 'spring', damping: 20, stiffness: 300 }}
      className="fixed z-[102] cursor-pointer"
      style={positionStyles}
      onClick={onTap}
    >
      <div className="relative">
        {/* Tooltip bubble */}
        <div className="bg-gray-900/95 backdrop-blur-sm border border-white/20 rounded-2xl px-4 py-3 shadow-xl max-w-[280px]">
          <div className="flex items-center gap-2">
            <span className="text-xl flex-shrink-0">{step.emoji}</span>
            <p className="text-white text-sm font-medium leading-tight">{step.text}</p>
          </div>
          <p className="text-cyan-400 text-xs mt-1.5 text-center">Tap to continue</p>
        </div>

        {/* Arrow */}
        {arrowDirection !== 'none' && (
          <div
            className={`absolute w-0 h-0 ${
              arrowDirection === 'down'
                ? 'bottom-[-8px] left-1/2 -translate-x-1/2 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-gray-900/95'
                : arrowDirection === 'up'
                ? 'top-[-8px] left-1/2 -translate-x-1/2 border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent border-b-gray-900/95'
                : arrowDirection === 'left'
                ? 'left-[-8px] top-1/2 -translate-y-1/2 border-t-8 border-b-8 border-r-8 border-t-transparent border-b-transparent border-r-gray-900/95'
                : 'right-[-8px] top-1/2 -translate-y-1/2 border-t-8 border-b-8 border-l-8 border-t-transparent border-b-transparent border-l-gray-900/95'
            }`}
          />
        )}
      </div>
    </motion.div>
  );
}

// ============================================================================
// PROGRESS DOTS (Bottom of screen)
// ============================================================================

interface ProgressDotsProps {
  currentStep: number;
  totalSteps: number;
  onSkip: () => void;
}

function ProgressDots({ currentStep, totalSteps, onSkip }: ProgressDotsProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed bottom-24 left-0 right-0 z-[102] flex flex-col items-center gap-2"
    >
      {/* Progress dots */}
      <div className="flex gap-1.5">
        {Array.from({ length: totalSteps }).map((_, index) => (
          <div
            key={index}
            className={`w-2 h-2 rounded-full transition-all ${
              index === currentStep
                ? 'bg-cyan-400 w-4'
                : index < currentStep
                ? 'bg-white/60'
                : 'bg-white/30'
            }`}
          />
        ))}
      </div>

      {/* Skip button */}
      <button
        onClick={onSkip}
        className="text-white/50 text-xs hover:text-white/70 transition-colors"
      >
        Skip tour
      </button>
    </motion.div>
  );
}

// ============================================================================
// PULSING HIGHLIGHT
// ============================================================================

interface PulsingHighlightProps {
  targetRect: DOMRect | null;
}

function PulsingHighlight({ targetRect }: PulsingHighlightProps) {
  if (!targetRect) return null;

  const padding = 8;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed z-[101] pointer-events-none"
      style={{
        top: targetRect.top - padding,
        left: targetRect.left - padding,
        width: targetRect.width + padding * 2,
        height: targetRect.height + padding * 2,
      }}
    >
      {/* Pulsing ring */}
      <motion.div
        animate={{
          boxShadow: [
            '0 0 0 0 rgba(60, 242, 255, 0.4)',
            '0 0 0 8px rgba(60, 242, 255, 0)',
          ],
        }}
        transition={{ duration: 1.5, repeat: Infinity }}
        className="w-full h-full rounded-2xl border-2 border-cyan-400/60"
      />
    </motion.div>
  );
}

// ============================================================================
// DARK OVERLAY (with cutout for target)
// ============================================================================

interface OverlayProps {
  targetRect: DOMRect | null;
}

function DarkOverlay({ targetRect }: OverlayProps) {
  if (!targetRect) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/70"
      />
    );
  }

  const padding = 12;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100]"
    >
      <div
        className="absolute"
        style={{
          top: targetRect.top - padding,
          left: targetRect.left - padding,
          width: targetRect.width + padding * 2,
          height: targetRect.height + padding * 2,
          borderRadius: 16,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.75)',
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
  const isLastStep = currentStep === TOUR_STEPS.length - 1;

  // Find and track the target element
  useEffect(() => {
    const findTarget = () => {
      const target = document.querySelector(`[data-tour="${step.target}"]`);
      if (target) {
        const rect = target.getBoundingClientRect();
        setTargetRect(rect);

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
      setTimeout(onComplete, 200);
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  }, [isLastStep, onComplete]);

  const handleSkip = useCallback(() => {
    setIsVisible(false);
    setTimeout(onSkip, 200);
  }, [onSkip]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'Escape') {
        handleSkip();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handleSkip]);

  return (
    <AnimatePresence>
      {isVisible && (
        <>
          {/* Click blocker */}
          <div
            className="fixed inset-0 z-[99]"
            onClick={handleNext}
          />

          {/* Dark overlay with cutout */}
          <DarkOverlay targetRect={targetRect} />

          {/* Pulsing highlight on target */}
          <PulsingHighlight targetRect={targetRect} />

          {/* Coach mark tooltip */}
          <CoachMark
            step={step}
            targetRect={targetRect}
            onTap={handleNext}
          />

          {/* Progress dots at bottom */}
          <ProgressDots
            currentStep={currentStep}
            totalSteps={TOUR_STEPS.length}
            onSkip={handleSkip}
          />
        </>
      )}
    </AnimatePresence>
  );
}

// ============================================================================
// HOOK: useSpotlightTour
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
