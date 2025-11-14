'use client';

// Main Dashboard Page for AiMoviez | 8SEC MADNESS

import { useSession, signIn } from 'next-auth/react';
import { motion } from 'framer-motion';
import { useMockData } from '@/hooks/useMockData';
import Navbar from '@/components/Navbar';
import HypeMeter from '@/components/HypeMeter';
import VideoCard from '@/components/VideoCard';
import UploadPanel from '@/components/UploadPanel';
import Leaderboard from '@/components/Leaderboard';
import StoryTimeline from '@/components/StoryTimeline';
import { Sparkles, Zap } from 'lucide-react';

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const {
    round,
    clips,
    leaders,
    timeline,
    hypeStats,
    userProfile,
    vote,
    uploadClip
  } = useMockData();

  // Show auth screen if not authenticated
  if (status === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-[#050510] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md p-8 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 shadow-2xl text-center space-y-6"
        >
          {/* Brand */}
          <div>
            <h1 className="text-3xl font-bold">
              <span className="bg-gradient-to-r from-cyan-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                AiMoviez
              </span>
            </h1>
            <p className="text-xl text-white/60 mt-2">8SEC MADNESS</p>
          </div>

          {/* Explainer */}
          <div className="space-y-3 text-left">
            <p className="text-white/80">
              Join <strong className="text-cyan-400">75 creators</strong> building a 10-minute film, 
              <strong className="text-violet-400"> 8 seconds at a time</strong>.
            </p>
            <ul className="space-y-2 text-sm text-white/60">
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-0.5">🎬</span>
                <span>Upload your 8-second vertical clip</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-400 mt-0.5">🗳️</span>
                <span>Vote for the best clips each round</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-fuchsia-400 mt-0.5">🏆</span>
                <span>Shape the story with the community</span>
              </li>
            </ul>
          </div>

          {/* CTA */}
          <button
            onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 hover:from-cyan-400 hover:to-violet-400 text-white font-bold text-lg transition-all duration-300 hover:shadow-lg hover:shadow-cyan-500/50 focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050510]"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>

          <p className="text-xs text-white/40">
            By continuing, you agree to our Terms of Service and Privacy Policy
          </p>
        </motion.div>
      </div>
    );
  }

  // Loading state
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[#050510] flex items-center justify-center">
        <div className="text-center space-y-4">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-16 h-16 mx-auto rounded-full border-4 border-cyan-400/20 border-t-cyan-400"
          />
          <p className="text-white/60">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  // Main dashboard
  return (
    <div className="min-h-screen bg-[#050510]">
      {/* Navbar */}
      <Navbar
        round={round}
        userName={session?.user?.name || userProfile.name}
        userAvatar={session?.user?.image || userProfile.avatar}
      />

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 space-y-6">
        
        {/* Hero Banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative p-8 rounded-2xl bg-gradient-to-r from-cyan-500/20 via-violet-500/20 to-fuchsia-500/20 border border-cyan-400/40 shadow-2xl overflow-hidden"
        >
          {/* Animated background */}
          <div className="absolute inset-0 opacity-30">
            <motion.div
              animate={{
                backgroundPosition: ['0% 0%', '100% 100%'],
              }}
              transition={{
                duration: 10,
                repeat: Infinity,
                repeatType: 'reverse',
              }}
              className="w-full h-full"
              style={{
                backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(6, 182, 212, 0.3) 0%, transparent 50%), radial-gradient(circle at 80% 50%, rgba(139, 92, 246, 0.3) 0%, transparent 50%)',
                backgroundSize: '100% 100%',
              }}
            />
          </div>

          <div className="relative text-center space-y-2">
            <h2 className="text-3xl md:text-4xl font-bold text-white flex items-center justify-center gap-3">
              <span className="text-4xl">🔥</span>
              Round {round.segmentNumber} Live — Vote Your Madness
              <span className="text-4xl">🔥</span>
            </h2>
            <p className="text-lg text-white/80">
              The story evolves with your votes. Make your scene count!
            </p>
          </div>
        </motion.div>

        {/* Row 1: Voting Arena + Creator Profile */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          
          {/* Voting Arena */}
          <div className="lg:col-span-3">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                  <Zap size={28} className="text-yellow-400" />
                  Voting Arena
                </h2>
                <span className="px-3 py-1 rounded-full bg-green-500/20 border border-green-500/40 text-green-400 text-sm font-medium">
                  {clips.length} clips live
                </span>
              </div>

              {clips.length === 0 ? (
                <div className="p-12 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 text-center">
                  <Sparkles size={48} className="mx-auto text-white/20 mb-3" />
                  <p className="text-white/60">No clips yet — be the first to upload!</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
                  {clips.map((clip) => (
                    <VideoCard
                      key={clip.id}
                      clip={clip}
                      onVote={vote}
                      isAuthenticated={!!session}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Creator Profile Mini Panel */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 p-6 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 shadow-2xl space-y-6">
              <div className="text-center">
                <img
                  src={session?.user?.image || userProfile.avatar}
                  alt="Your profile"
                  className="w-20 h-20 mx-auto rounded-full border-4 border-cyan-400/40 mb-3"
                />
                <h3 className="text-lg font-bold text-white">
                  {session?.user?.name || userProfile.name}
                </h3>
                <p className="text-sm text-white/60">Creator</p>
              </div>

              <div className="space-y-3 pt-3 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">Total Votes</span>
                  <span className="text-lg font-bold text-cyan-400">
                    {userProfile.totalVotes.toLocaleString()}
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">XP</span>
                  <span className="text-lg font-bold text-violet-400">
                    {userProfile.xp.toLocaleString()}
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">Clips</span>
                  <span className="text-lg font-bold text-fuchsia-400">
                    {userProfile.clipsSubmitted}
                  </span>
                </div>
              </div>

              {userProfile.badges.length > 0 && (
                <div className="pt-3 border-t border-white/10">
                  <p className="text-xs text-white/60 uppercase tracking-wider mb-2">Badges</p>
                  <div className="space-y-1">
                    {userProfile.badges.map((badge, i) => (
                      <div
                        key={i}
                        className="text-xs px-2 py-1 rounded-md bg-white/10 text-white/80 text-center"
                      >
                        {badge}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 2: Upload Panel + HypeMeter */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <UploadPanel
            onSubmit={uploadClip}
            hasUploadedThisRound={userProfile.hasUploadedThisRound}
          />
          <HypeMeter stats={hypeStats} />
        </div>

        {/* Row 3: Leaderboard */}
        <Leaderboard leaders={leaders} />

        {/* Row 4: Story Timeline */}
        <StoryTimeline segments={timeline} />

        {/* Row 5: AI Challenges Teaser */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-8 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-400/40 shadow-2xl text-center space-y-4"
        >
          <div className="text-4xl mb-2">🎯</div>
          <h3 className="text-2xl font-bold text-white">
            AI Challenges Coming Soon
          </h3>
          <p className="text-white/80 max-w-2xl mx-auto">
            Get bonus XP and exclusive badges by completing AI-generated creative challenges. 
            From scene transitions to genre mashups — push your creativity to new limits!
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-purple-300">
            <Sparkles size={16} />
            <span>Launching with Round 20</span>
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-white/40 text-sm">
          <p>© 2025 AiMoviez | 8SEC MADNESS. Built for creators, by creators.</p>
        </div>
      </footer>
    </div>
  );
}
