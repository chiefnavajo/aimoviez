'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { BookOpen, Heart, Trophy, User, Plus, Film, Users, Clock, Zap, Award, Globe } from 'lucide-react';
import BottomNavigation from '@/components/BottomNavigation';

// ============================================================================
// ABOUT PAGE - Matching Dashboard/Storyboard Style
// ============================================================================

const FEATURES = [
  { icon: Film, title: '8-Second Clips', description: 'Upload short, impactful clips that tell a story in 8 seconds' },
  { icon: Users, title: 'Community Voting', description: 'The community decides which clips make it into the movie' },
  { icon: Clock, title: '24-Hour Rounds', description: 'Each voting round lasts 24 hours - vote for your favorites' },
  { icon: Zap, title: 'Real-Time Updates', description: 'Watch the leaderboard change in real-time as votes come in' },
  { icon: Award, title: 'Win Recognition', description: 'Get your clip locked into the official movie and earn badges' },
  { icon: Globe, title: 'Global Movie', description: '75 clips from creators worldwide form one collaborative film' },
];

const STATS = [
  { value: '75', label: 'Clips per Movie' },
  { value: '8s', label: 'Max Clip Length' },
  { value: '24h', label: 'Voting Rounds' },
  { value: '∞', label: 'Creators Worldwide' },
];

export default function AboutPage() {
  const renderContent = () => (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-8 md:py-12">
      {/* Hero Section */}
      <div className="text-center mb-12">
        <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-3xl md:text-5xl font-black mb-4">
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7]">8SEC MADNESS</span>
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-lg md:text-xl text-white/70 max-w-2xl mx-auto">
          The world's first collaborative AI movie, built 8 seconds at a time by creators like you.
        </motion.p>
      </div>

      {/* Stats */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
        {STATS.map((stat, i) => (
          <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
            <div className="text-3xl md:text-4xl font-black bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-500">{stat.value}</div>
            <div className="text-sm text-white/60">{stat.label}</div>
          </div>
        ))}
      </motion.div>

      {/* How It Works */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mb-12">
        <h2 className="text-2xl font-black mb-6 text-center">How It Works</h2>
        <div className="space-y-4">
          {[
            { step: '1', title: 'Upload', desc: 'Create and upload your 8-second AI-generated clip' },
            { step: '2', title: 'Vote', desc: 'Vote on clips competing for each slot in the movie' },
            { step: '3', title: 'Win', desc: 'Top-voted clips get locked into the final movie' },
            { step: '4', title: 'Watch', desc: 'See the complete movie built by the community' },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-4 p-4 bg-white/5 rounded-xl">
              <div className="w-10 h-10 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 flex items-center justify-center font-black flex-shrink-0">{item.step}</div>
              <div>
                <div className="font-bold text-lg">{item.title}</div>
                <div className="text-white/60">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Features Grid */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mb-12">
        <h2 className="text-2xl font-black mb-6 text-center">Features</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {FEATURES.map((feature, i) => (
            <div key={i} className="flex items-start gap-4 p-4 bg-white/5 border border-white/10 rounded-xl">
              <feature.icon className="w-8 h-8 text-cyan-500 flex-shrink-0" />
              <div>
                <div className="font-bold">{feature.title}</div>
                <div className="text-sm text-white/60">{feature.description}</div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* CTA */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="text-center">
        <Link href="/dashboard">
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="px-8 py-4 bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7] rounded-xl font-bold text-lg">
            Start Voting Now
          </motion.button>
        </Link>
      </motion.div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Desktop Layout */}
      <div className="hidden md:flex h-screen">
        <div className="w-56 h-full flex flex-col py-4 px-3 border-r border-white/10">
          <Link href="/dashboard" className="flex items-center gap-2 px-3 py-2 mb-4">
            <span className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-[#3CF2FF] to-[#FF00C7]">AiMoviez</span>
          </Link>
          <Link href="/dashboard" className="mb-4">
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7] text-white font-bold shadow-lg">
              <Heart className="w-5 h-5" fill="white" /><span>Vote Now</span>
            </motion.div>
          </Link>
          <nav className="flex-1 space-y-1">
            <Link href="/story"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><BookOpen className="w-6 h-6" /><span>Story</span></div></Link>
            <Link href="/upload"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Plus className="w-6 h-6" /><span>Upload</span></div></Link>
            <Link href="/leaderboard"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Trophy className="w-6 h-6" /><span>Leaderboard</span></div></Link>
            <Link href="/profile"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><User className="w-6 h-6" /><span>Profile</span></div></Link>
          </nav>
        </div>
        <div className="flex-1 overflow-y-auto">{renderContent()}</div>
      </div>

      {/* Mobile Layout */}
      <div className="md:hidden pb-20">
        {renderContent()}
        <BottomNavigation />
      </div>
    </div>
  );
}
