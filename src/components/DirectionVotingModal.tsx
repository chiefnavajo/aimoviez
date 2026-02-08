'use client';

// ============================================================================
// DIRECTION VOTING MODAL
// ============================================================================
// Shows once per session when direction voting is open for the current slot.
// After voting or dismissing, collapses to a floating indicator.
// Users can tap the indicator to re-open the voting modal or see results.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Vote, ChevronUp, Sparkles, Clock } from 'lucide-react';
import {
  useDirections,
  useDirectionVoteStatus,
  useCastDirectionVote,
  DirectionOption,
} from '@/hooks/useCoDirector';

interface DirectionVotingModalProps {
  className?: string;
}

export default function DirectionVotingModal({ className = '' }: DirectionVotingModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasShownThisSession, setHasShownThisSession] = useState(false);
  const [selectedDirection, setSelectedDirection] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);

  // Fetch directions data
  const { data: directionsData, isLoading: loadingDirections } = useDirections();
  const { data: voteStatus, isLoading: loadingVoteStatus } = useDirectionVoteStatus();
  const { mutate: castVote, isPending: isVoting } = useCastDirectionVote();

  const votingOpen = directionsData?.voting_open ?? false;
  const directions = directionsData?.directions ?? [];
  const totalVotes = directionsData?.total_votes ?? 0;
  const hasVoted = voteStatus?.has_voted ?? false;
  const votedFor = voteStatus?.voted_for ?? null;
  const slotPosition = directionsData?.slot_position;

  // Calculate time remaining in useEffect (not during render)
  useEffect(() => {
    if (!directionsData?.voting_ends_at) {
      setTimeRemaining(null);
      return;
    }

    const updateTimeRemaining = () => {
      const endTime = new Date(directionsData.voting_ends_at!).getTime();
      const now = Date.now();
      const diff = endTime - now;

      if (diff <= 0) {
        setTimeRemaining('Ended');
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (hours > 0) {
        setTimeRemaining(`${hours}h ${minutes}m left`);
      } else {
        setTimeRemaining(`${minutes}m left`);
      }
    };

    // Initial calculation
    updateTimeRemaining();

    // Update every minute
    const interval = setInterval(updateTimeRemaining, 60000);
    return () => clearInterval(interval);
  }, [directionsData?.voting_ends_at]);

  // Auto-show modal once per session when voting is open and user hasn't voted
  useEffect(() => {
    if (votingOpen && directions.length > 0 && !hasShownThisSession && !hasVoted) {
      // Check session storage to see if we've already shown this
      const sessionKey = `direction_voting_shown_${slotPosition}`;
      const alreadyShown = sessionStorage.getItem(sessionKey);

      if (!alreadyShown) {
        setIsOpen(true);
        setHasShownThisSession(true);
        sessionStorage.setItem(sessionKey, 'true');
      } else {
        setHasShownThisSession(true);
      }
    }
  }, [votingOpen, directions.length, hasShownThisSession, hasVoted, slotPosition]);

  const handleVote = useCallback(() => {
    if (!selectedDirection || isVoting) return;

    castVote(selectedDirection, {
      onSuccess: () => {
        // Close modal after successful vote
        setTimeout(() => setIsOpen(false), 1500);
      },
    });
  }, [selectedDirection, isVoting, castVote]);

  const handleDismiss = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleOpenModal = useCallback(() => {
    setIsOpen(true);
  }, []);

  // Don't render anything if voting is not open or no directions
  if (!votingOpen || directions.length === 0) {
    return null;
  }

  const isLoading = loadingDirections || loadingVoteStatus;

  return (
    <>
      {/* Floating Indicator (when modal is closed) */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleOpenModal}
            className={`fixed bottom-20 left-4 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full
                       bg-gradient-to-r from-purple-600 to-pink-600 shadow-lg shadow-purple-500/30
                       border border-purple-400/30 ${className}`}
          >
            {hasVoted ? (
              <>
                <Check className="w-5 h-5 text-white" />
                <span className="text-white text-sm font-semibold">Voted</span>
              </>
            ) : (
              <>
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  <Vote className="w-5 h-5 text-white" />
                </motion.div>
                <span className="text-white text-sm font-semibold">Vote on Direction</span>
                <motion.div
                  className="w-2 h-2 rounded-full bg-white"
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              </>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Full-screen Modal */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm overflow-y-auto"
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="min-h-full flex flex-col"
            >
              {/* Header */}
              <div className="sticky top-0 z-10 bg-gradient-to-b from-black via-black/95 to-transparent pb-6 pt-safe">
                <div className="flex items-center justify-between px-4 pt-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-6 h-6 text-purple-400" />
                    <div>
                      <h2 className="text-white text-lg font-bold">Choose the Story Direction</h2>
                      <p className="text-white/60 text-sm">Slot #{slotPosition}</p>
                    </div>
                  </div>
                  <button
                    onClick={handleDismiss}
                    className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center"
                  >
                    <X className="w-5 h-5 text-white" />
                  </button>
                </div>

                {/* Timer */}
                {timeRemaining && (
                  <div className="flex items-center justify-center gap-2 mt-3 px-4">
                    <Clock className="w-4 h-4 text-purple-400" />
                    <span className="text-purple-400 text-sm font-medium">{timeRemaining}</span>
                    <span className="text-white/40 text-sm">· {totalVotes} votes</span>
                  </div>
                )}
              </div>

              {/* Loading State */}
              {isLoading && (
                <div className="flex-1 flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                </div>
              )}

              {/* Directions List */}
              {!isLoading && (
                <div className="flex-1 px-4 pb-32 space-y-4">
                  {directions.map((direction: DirectionOption, index: number) => {
                    const isSelected = selectedDirection === direction.id;
                    const isVotedFor = votedFor === direction.id;
                    const votePercent = totalVotes > 0
                      ? Math.round((direction.vote_count / totalVotes) * 100)
                      : 0;

                    return (
                      <motion.button
                        key={direction.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        onClick={() => !hasVoted && setSelectedDirection(direction.id)}
                        disabled={hasVoted}
                        className={`w-full p-4 rounded-2xl border text-left transition-all relative overflow-hidden
                          ${isSelected
                            ? 'border-purple-500 bg-purple-500/20'
                            : isVotedFor
                              ? 'border-green-500 bg-green-500/20'
                              : 'border-white/10 bg-white/5 hover:bg-white/10'}
                          ${hasVoted ? 'cursor-default' : 'cursor-pointer'}
                        `}
                      >
                        {/* Vote percentage bar (shown after voting) */}
                        {hasVoted && (
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${votePercent}%` }}
                            transition={{ duration: 0.5, delay: 0.2 }}
                            className={`absolute inset-y-0 left-0 ${
                              isVotedFor ? 'bg-green-500/20' : 'bg-white/5'
                            }`}
                          />
                        )}

                        <div className="relative z-10">
                          {/* Header */}
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="flex items-center gap-2">
                              <span className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-pink-500
                                             flex items-center justify-center text-white text-sm font-bold">
                                {index + 1}
                              </span>
                              <h3 className="text-white font-bold text-base">{direction.title}</h3>
                            </div>
                            {isVotedFor && (
                              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/30">
                                <Check className="w-3 h-3 text-green-400" />
                                <span className="text-green-400 text-xs font-medium">Your vote</span>
                              </div>
                            )}
                            {isSelected && !hasVoted && (
                              <div className="w-6 h-6 rounded-full bg-purple-500 flex items-center justify-center">
                                <Check className="w-4 h-4 text-white" />
                              </div>
                            )}
                          </div>

                          {/* Description */}
                          <p className="text-white/70 text-sm leading-relaxed mb-3">
                            {direction.description}
                          </p>

                          {/* Meta info */}
                          <div className="flex flex-wrap gap-2">
                            {direction.mood && (
                              <span className="px-2 py-1 rounded-full bg-white/10 text-white/60 text-xs">
                                {direction.mood}
                              </span>
                            )}
                            {direction.suggested_genre && (
                              <span className="px-2 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs">
                                {direction.suggested_genre}
                              </span>
                            )}
                            {hasVoted && (
                              <span className="px-2 py-1 rounded-full bg-white/10 text-white/60 text-xs ml-auto">
                                {votePercent}% · {direction.vote_count} votes
                              </span>
                            )}
                          </div>

                          {/* Visual hints (collapsed by default) */}
                          {direction.visual_hints && (
                            <details className="mt-3">
                              <summary className="text-purple-400 text-xs cursor-pointer hover:text-purple-300">
                                Visual hints
                              </summary>
                              <p className="text-white/50 text-xs mt-1 pl-2 border-l border-purple-500/30">
                                {direction.visual_hints}
                              </p>
                            </details>
                          )}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              )}

              {/* Bottom Action Bar */}
              <div className="fixed bottom-0 left-0 right-0 p-4 pb-safe bg-gradient-to-t from-black via-black/95 to-transparent">
                {hasVoted ? (
                  <button
                    onClick={handleDismiss}
                    className="w-full py-4 rounded-xl bg-white/10 border border-white/20
                             text-white font-bold text-base"
                  >
                    Close
                  </button>
                ) : (
                  <button
                    onClick={handleVote}
                    disabled={!selectedDirection || isVoting}
                    className={`w-full py-4 rounded-xl font-bold text-base transition-all
                      ${selectedDirection
                        ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/30'
                        : 'bg-white/10 text-white/40 cursor-not-allowed'}
                    `}
                  >
                    {isVoting ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Submitting...
                      </span>
                    ) : selectedDirection ? (
                      'Submit Vote'
                    ) : (
                      'Select a direction to vote'
                    )}
                  </button>
                )}

                {/* Hint to swipe down */}
                <div className="flex justify-center mt-3">
                  <button
                    onClick={handleDismiss}
                    className="flex items-center gap-1 text-white/40 text-xs"
                  >
                    <ChevronUp className="w-4 h-4 rotate-180" />
                    <span>Swipe down or tap to close</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
