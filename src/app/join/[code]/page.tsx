'use client';

// ============================================================================
// JOIN PAGE - Handle referral links
// Redirects to dashboard and stores referral code
// ============================================================================

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession, signIn } from 'next-auth/react';
import { motion } from 'framer-motion';
import { Gift, Sparkles, ArrowRight, LogIn } from 'lucide-react';

export default function JoinPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [processing, setProcessing] = useState(false);
  const referralCode = params.code as string;

  useEffect(() => {
    // Store referral code in localStorage for later use during signup
    if (referralCode) {
      localStorage.setItem('referral_code', referralCode.toUpperCase());
    }
  }, [referralCode]);

  useEffect(() => {
    // If user is logged in, track the referral and redirect
    if (status === 'authenticated' && session?.user) {
      trackReferralAndRedirect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session]);

  const trackReferralAndRedirect = async () => {
    if (processing) return;
    setProcessing(true);

    try {
      // Try to track the referral
      await fetch('/api/referral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referral_code: referralCode,
        }),
      });
    } catch {
      // Referral tracking failed, but still redirect
    }

    // Clear the stored code
    localStorage.removeItem('referral_code');

    // Redirect to dashboard
    router.push('/dashboard');
  };

  const handleSignIn = () => {
    signIn('google', { callbackUrl: `/join/${referralCode}` });
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full text-center space-y-8"
      >
        {/* Animated Gift Icon */}
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            rotate: [0, -5, 5, 0],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            repeatType: 'reverse',
          }}
          className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center"
        >
          <Gift className="w-12 h-12 text-cyan-400" />
        </motion.div>

        {/* Welcome Message */}
        <div className="space-y-4">
          <h1 className="text-3xl font-black">
            You&apos;ve Been Invited!
          </h1>
          <p className="text-white/60">
            Someone shared AiMoviez with you. Join now and both of you get bonus rewards!
          </p>
        </div>

        {/* Referral Code Display */}
        <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
          <div className="text-sm text-white/60 mb-2">Referral Code</div>
          <div className="flex items-center justify-center gap-2">
            <Sparkles className="w-5 h-5 text-yellow-400" />
            <span className="text-2xl font-mono font-bold text-cyan-400">
              {referralCode?.toUpperCase()}
            </span>
            <Sparkles className="w-5 h-5 text-yellow-400" />
          </div>
        </div>

        {/* Benefits */}
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-left bg-green-500/10 rounded-xl p-4 border border-green-500/30">
            <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
              <Gift className="w-4 h-4 text-green-400" />
            </div>
            <div>
              <div className="font-medium text-green-300">Your Bonus</div>
              <div className="text-sm text-white/60">+50 XP welcome bonus when you join</div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-left bg-purple-500/10 rounded-xl p-4 border border-purple-500/30">
            <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <div className="font-medium text-purple-300">Friend&apos;s Bonus</div>
              <div className="text-sm text-white/60">They earn XP for inviting you</div>
            </div>
          </div>
        </div>

        {/* CTA */}
        {status === 'loading' || processing ? (
          <div className="flex items-center justify-center py-4">
            <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : status === 'authenticated' ? (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => router.push('/dashboard')}
            className="w-full py-4 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl font-bold text-lg flex items-center justify-center gap-2"
          >
            Go to Dashboard
            <ArrowRight className="w-5 h-5" />
          </motion.button>
        ) : (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleSignIn}
            className="w-full py-4 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl font-bold text-lg flex items-center justify-center gap-2"
          >
            <LogIn className="w-5 h-5" />
            Sign Up to Claim Bonus
          </motion.button>
        )}

        {/* Skip Link */}
        <p className="text-sm text-white/40">
          <button
            onClick={() => router.push('/dashboard')}
            className="hover:text-white/60 transition-colors underline"
          >
            Continue without signing up
          </button>
        </p>
      </motion.div>
    </div>
  );
}
