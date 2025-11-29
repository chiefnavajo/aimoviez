'use client';

// ============================================================================
// REFERRAL SECTION COMPONENT
// Shows user's referral info, link, and progress
// ============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Gift,
  Copy,
  Check,
  Share2,
  Users,
  Trophy,
  ChevronRight,
  Sparkles,
  ExternalLink,
} from 'lucide-react';

interface ReferralTier {
  count: number;
  title: string;
  reward: number;
  badge: string | null;
}

interface ReferralData {
  enabled: boolean;
  referral_code: string;
  referral_link: string;
  referral_count: number;
  completed_referrals: number;
  pending_referrals: number;
  total_rewards: number;
  current_tier: ReferralTier | null;
  next_tier: ReferralTier | null;
  progress_to_next: number;
  tiers: ReferralTier[];
}

export default function ReferralSection() {
  const [copied, setCopied] = useState(false);
  const [showTiers, setShowTiers] = useState(false);

  const { data, isLoading, error } = useQuery<ReferralData>({
    queryKey: ['referral-info'],
    queryFn: async () => {
      const response = await fetch('/api/referral');
      if (!response.ok) throw new Error('Failed to fetch referral info');
      return response.json();
    },
    staleTime: 60000, // Cache for 1 minute
  });

  // Don't render if feature is disabled or still loading
  if (isLoading) {
    return (
      <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10 animate-pulse">
        <div className="h-6 bg-white/10 rounded w-1/3 mb-4" />
        <div className="h-4 bg-white/10 rounded w-2/3 mb-2" />
        <div className="h-12 bg-white/10 rounded mt-4" />
      </div>
    );
  }

  if (error || !data?.enabled) {
    return null; // Feature not enabled, don't show anything
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(data.referral_link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = data.referral_link;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join me on AiMoviez!',
          text: 'Check out AiMoviez - vote on AI-generated movie clips and earn rewards!',
          url: data.referral_link,
        });
      } catch {
        // User cancelled share
      }
    } else {
      copyLink();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-purple-500/10 to-cyan-500/10 backdrop-blur-sm rounded-2xl p-6 border border-purple-500/30"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-purple-500/20">
            <Gift className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h3 className="font-bold">Invite Friends</h3>
            <p className="text-sm text-white/60">Earn rewards for each friend</p>
          </div>
        </div>

        {data.current_tier && (
          <div className="text-right">
            <div className="text-xs text-white/40">Current Tier</div>
            <div className="font-bold text-purple-400">{data.current_tier.title}</div>
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white/5 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-cyan-400">{data.referral_count}</div>
          <div className="text-xs text-white/60">Referrals</div>
        </div>
        <div className="bg-white/5 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-green-400">{data.total_rewards}</div>
          <div className="text-xs text-white/60">XP Earned</div>
        </div>
        <div className="bg-white/5 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-yellow-400">{data.pending_referrals}</div>
          <div className="text-xs text-white/60">Pending</div>
        </div>
      </div>

      {/* Progress to Next Tier */}
      {data.next_tier && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-white/60">Progress to {data.next_tier.title}</span>
            <span className="text-white/80">{data.referral_count}/{data.next_tier.count}</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${data.progress_to_next}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="h-full bg-gradient-to-r from-purple-500 to-cyan-500 rounded-full"
            />
          </div>
          <div className="text-xs text-white/40 mt-1">
            +{data.next_tier.reward} XP per referral at this tier
          </div>
        </div>
      )}

      {/* Referral Code */}
      <div className="bg-black/30 rounded-xl p-4 mb-4">
        <div className="text-xs text-white/40 mb-2">Your Referral Code</div>
        <div className="flex items-center justify-between">
          <span className="text-xl font-mono font-bold text-cyan-400">
            {data.referral_code}
          </span>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={copyLink}
            className={`p-2 rounded-lg transition-colors ${
              copied ? 'bg-green-500/20 text-green-400' : 'bg-white/10 hover:bg-white/20'
            }`}
          >
            {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
          </motion.button>
        </div>
      </div>

      {/* Share Buttons */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={copyLink}
          className="py-3 bg-white/10 hover:bg-white/20 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors"
        >
          {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied!' : 'Copy Link'}
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={shareLink}
          className="py-3 bg-gradient-to-r from-purple-500 to-cyan-500 rounded-xl font-bold flex items-center justify-center gap-2"
        >
          <Share2 className="w-4 h-4" />
          Share
        </motion.button>
      </div>

      {/* View Tiers Button */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => setShowTiers(!showTiers)}
        className="w-full py-3 bg-white/5 hover:bg-white/10 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors"
      >
        <Trophy className="w-4 h-4 text-yellow-400" />
        View All Reward Tiers
        <ChevronRight className={`w-4 h-4 transition-transform ${showTiers ? 'rotate-90' : ''}`} />
      </motion.button>

      {/* Tiers Modal/Dropdown */}
      <AnimatePresence>
        {showTiers && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-2">
              {data.tiers.map((tier, index) => {
                const isAchieved = data.referral_count >= tier.count;
                const isCurrent = data.current_tier?.count === tier.count;

                return (
                  <div
                    key={index}
                    className={`p-3 rounded-xl border transition-all ${
                      isCurrent
                        ? 'bg-purple-500/20 border-purple-500/50'
                        : isAchieved
                        ? 'bg-green-500/10 border-green-500/30'
                        : 'bg-white/5 border-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center ${
                            isAchieved ? 'bg-green-500/20' : 'bg-white/10'
                          }`}
                        >
                          {isAchieved ? (
                            <Check className="w-4 h-4 text-green-400" />
                          ) : (
                            <Users className="w-4 h-4 text-white/40" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold">{tier.title}</span>
                            {isCurrent && (
                              <span className="px-2 py-0.5 bg-purple-500/30 rounded-full text-xs text-purple-300">
                                Current
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-white/60">
                            {tier.count} referral{tier.count !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-cyan-400">+{tier.reward} XP</div>
                        {tier.badge && (
                          <div className="text-xs text-white/40 flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />
                            Badge
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
