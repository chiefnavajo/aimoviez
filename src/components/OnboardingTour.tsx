'use client';

// ============================================================================
// ONBOARDING TOUR
// Step-by-step guide for new users
// ============================================================================

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Play,
  Heart,
  BookOpen,
  Upload,
  User,
  Trophy,
  Zap,
  Sparkles,
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface TourStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  highlight?: string; // CSS selector to highlight
  position?: 'center' | 'bottom' | 'top';
  emoji?: string;
}

interface OnboardingTourProps {
  onComplete: () => void;
  onSkip: () => void;
}

// ============================================================================
// TOUR STEPS
// ============================================================================

const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to AiMoviez!',
    description: 'Create the world\'s first AI-powered collaborative movie, one 8-second clip at a time. Let\'s show you how it works!',
    icon: <Sparkles className="w-8 h-8" />,
    position: 'center',
    emoji: '🎬',
  },
  {
    id: 'voting',
    title: 'Vote for Your Favorites',
    description: 'Swipe through clips and tap the ∞ button to vote. The clip with the most votes wins and becomes part of the story!',
    icon: <Heart className="w-8 h-8" />,
    position: 'center',
    emoji: '❤️',
  },
  {
    id: 'power-votes',
    title: 'Power Votes',
    description: 'Hold the vote button longer for Super (3x) or Mega (10x) votes! Use them wisely - you only get one of each per round.',
    icon: <Zap className="w-8 h-8" />,
    position: 'center',
    emoji: '⚡',
  },
  {
    id: 'daily-limit',
    title: '200 Votes Per Day',
    description: 'You have 200 votes each day. Vote on multiple clips to help your favorites win!',
    icon: <Trophy className="w-8 h-8" />,
    position: 'center',
    emoji: '🏆',
  },
  {
    id: 'story',
    title: 'Watch the Story',
    description: 'See how all the winning clips come together to form an amazing collaborative movie!',
    icon: <BookOpen className="w-8 h-8" />,
    position: 'center',
    emoji: '📖',
  },
  {
    id: 'upload',
    title: 'Become a Creator',
    description: 'Upload your own 8-second clips and compete to be part of the story. Fame awaits!',
    icon: <Upload className="w-8 h-8" />,
    position: 'center',
    emoji: '🎥',
  },
  {
    id: 'profile',
    title: 'Track Your Progress',
    description: 'Check your profile to see your stats, badges, and contributions to the movie!',
    icon: <User className="w-8 h-8" />,
    position: 'center',
    emoji: '👤',
  },
  {
    id: 'ready',
    title: 'You\'re Ready!',
    description: 'Start voting now and help shape the story. Every vote counts!',
    icon: <Play className="w-8 h-8" />,
    position: 'center',
    emoji: '🚀',
  },
];

// ============================================================================
// COMPONENT
// ============================================================================

export default function OnboardingTour({ onComplete, onSkip }: OnboardingTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  const step = TOUR_STEPS[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === TOUR_STEPS.length - 1;
  const progress = ((currentStep + 1) / TOUR_STEPS.length) * 100;

  const handleNext = () => {
    if (isLastStep) {
      handleComplete();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirstStep) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleComplete = () => {
    setIsVisible(false);
    setTimeout(() => {
      onComplete();
    }, 300);
  };

  const handleSkip = () => {
    setIsVisible(false);
    setTimeout(() => {
      onSkip();
    }, 300);
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/90 backdrop-blur-md"
            onClick={handleSkip}
          />

          {/* Tour Card */}
          <motion.div
            key={step.id}
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-md bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 rounded-3xl border border-white/20 overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
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
              onClick={handleSkip}
              className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
            >
              <X className="w-5 h-5 text-white/70" />
            </button>

            {/* Content */}
            <div className="p-8 pt-10">
              {/* Icon */}
              <motion.div
                key={`icon-${step.id}`}
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', damping: 15, stiffness: 200, delay: 0.1 }}
                className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-cyan-500/20 via-purple-500/20 to-pink-500/20 border border-white/20 flex items-center justify-center"
              >
                <span className="text-4xl">{step.emoji}</span>
              </motion.div>

              {/* Title */}
              <motion.h2
                key={`title-${step.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="text-2xl font-black text-center text-white mb-3"
              >
                {step.title}
              </motion.h2>

              {/* Description */}
              <motion.p
                key={`desc-${step.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-white/70 text-center leading-relaxed mb-8"
              >
                {step.description}
              </motion.p>

              {/* Step Indicators */}
              <div className="flex justify-center gap-2 mb-6">
                {TOUR_STEPS.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentStep(index)}
                    className={`h-2 rounded-full transition-all ${
                      index === currentStep
                        ? 'w-8 bg-gradient-to-r from-cyan-500 to-purple-500'
                        : index < currentStep
                        ? 'w-2 bg-white/50'
                        : 'w-2 bg-white/20'
                    }`}
                  />
                ))}
              </div>

              {/* Navigation Buttons */}
              <div className="flex gap-3">
                {!isFirstStep && (
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={handlePrev}
                    className="flex-1 py-3 rounded-xl bg-white/10 border border-white/20 font-semibold text-white hover:bg-white/20 transition-colors flex items-center justify-center gap-2"
                  >
                    <ChevronLeft className="w-5 h-5" />
                    Back
                  </motion.button>
                )}

                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleNext}
                  className={`flex-1 py-3 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2 ${
                    isLastStep
                      ? 'bg-gradient-to-r from-green-500 to-emerald-500 hover:shadow-lg hover:shadow-green-500/30'
                      : 'bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 hover:shadow-lg hover:shadow-purple-500/30'
                  }`}
                >
                  {isLastStep ? (
                    <>
                      Start Voting!
                      <Sparkles className="w-5 h-5" />
                    </>
                  ) : (
                    <>
                      Next
                      <ChevronRight className="w-5 h-5" />
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
                  onClick={handleSkip}
                  className="w-full mt-4 text-white/60 text-sm hover:text-white/80 transition-colors"
                >
                  Skip tour
                </motion.button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ============================================================================
// HOOK: useOnboarding
// Manages onboarding state with localStorage
// ============================================================================

const ONBOARDING_KEY = 'aimoviez_onboarding_completed';

export function useOnboarding() {
  const [showTour, setShowTour] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user has completed onboarding
    const completed = localStorage.getItem(ONBOARDING_KEY);
    if (!completed) {
      setShowTour(true);
    }
    setIsLoading(false);
  }, []);

  const completeTour = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setShowTour(false);
  };

  const skipTour = () => {
    localStorage.setItem(ONBOARDING_KEY, 'skipped');
    setShowTour(false);
  };

  const resetTour = () => {
    localStorage.removeItem(ONBOARDING_KEY);
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
