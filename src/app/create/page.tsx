'use client';

// ============================================================================
// AI CREATE PAGE
// Full-screen AI video generation experience.
// Redirects to /upload if ai_video_generation flag is disabled.
// ============================================================================

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, BookOpen, Heart, Trophy, User, Plus } from 'lucide-react';
import BottomNavigation from '@/components/BottomNavigation';
import { AuthGuard } from '@/hooks/useAuth';
import { useFeature } from '@/hooks/useFeatureFlags';
import AIGeneratePanel from '@/components/AIGeneratePanel';

function CreatePageContent() {
  const router = useRouter();
  const { enabled: aiEnabled, isLoading } = useFeature('ai_video_generation');

  // Redirect if AI is not enabled
  useEffect(() => {
    if (!isLoading && !aiEnabled) {
      router.replace('/upload');
    }
  }, [isLoading, aiEnabled, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!aiEnabled) return null;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Desktop Layout */}
      <div className="hidden md:flex h-screen">
        {/* Left Sidebar */}
        <div className="w-56 h-full flex flex-col py-4 px-3 border-r border-white/10">
          <Link href="/dashboard" className="flex items-center gap-2 px-3 py-2 mb-4">
            <span className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-[#3CF2FF] to-[#FF00C7]">AiMoviez</span>
          </Link>
          <Link href="/dashboard" className="mb-4">
            <div className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7] text-white font-bold shadow-lg">
              <Heart className="w-5 h-5" fill="white" /><span>Vote Now</span>
            </div>
          </Link>
          <nav className="flex-1 space-y-1">
            <Link href="/story"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><BookOpen className="w-6 h-6" /><span>Story</span></div></Link>
            <Link href="/upload"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Plus className="w-6 h-6" /><span>Upload</span></div></Link>
            <Link href="/create"><div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-purple-500/10 text-purple-300 border border-purple-500/20"><Sparkles className="w-6 h-6" /><span className="font-semibold">AI Create</span></div></Link>
            <Link href="/leaderboard"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Trophy className="w-6 h-6" /><span>Leaderboard</span></div></Link>
            <Link href="/profile"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><User className="w-6 h-6" /><span>Profile</span></div></Link>
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-6 py-8">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-500/10 border border-purple-500/20 rounded-full mb-4">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span className="text-sm text-purple-300 font-medium">AI Video Generator</span>
              </div>
              <h1 className="text-3xl font-black mb-2">Create with AI</h1>
              <p className="text-white/60">Describe your scene and let AI generate an 8-second video clip</p>
            </div>
            <AIGeneratePanel compact={false} />
          </div>
        </div>
      </div>

      {/* Mobile Layout */}
      <div className="md:hidden pb-20">
        <div className="max-w-2xl mx-auto px-4 pt-14 pb-8">
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-full mb-3">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-xs text-purple-300 font-medium">AI Video Generator</span>
            </div>
            <h1 className="text-2xl font-black mb-1">Create with AI</h1>
            <p className="text-sm text-white/60">Describe your scene and let AI create it</p>
          </div>
          <AIGeneratePanel compact={false} />
        </div>
        <BottomNavigation />
      </div>
    </div>
  );
}

export default function CreatePage() {
  return (
    <AuthGuard>
      <CreatePageContent />
    </AuthGuard>
  );
}
