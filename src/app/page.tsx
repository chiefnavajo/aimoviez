'use client';

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [introSkipped, setIntroSkipped] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Check if intro was already skipped this session
    if (sessionStorage.getItem('introSkipped') === 'true') {
      setShowIntro(false);
      setIntroSkipped(true);
      return;
    }

    // Auto-hide intro after 3.5 seconds
    const timer = setTimeout(() => {
      setShowIntro(false);
      sessionStorage.setItem('introSkipped', 'true');
    }, 3500);

    return () => clearTimeout(timer);
  }, []);

  const skipIntro = () => {
    setShowIntro(false);
    setIntroSkipped(true);
    sessionStorage.setItem('introSkipped', 'true');
  };

  return (
    <main className="min-h-screen bg-black text-white overflow-hidden">
      {/* ============ INTRO OVERLAY ============ */}
      <AnimatePresence>
        {mounted && showIntro && !introSkipped && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="fixed inset-0 z-50 bg-black flex items-center justify-center"
          >
            {/* Skip Button */}
            <button
              onClick={skipIntro}
              className="absolute top-6 right-6 px-4 py-2 rounded-full bg-white/10 border border-white/20 text-white/60 text-sm hover:bg-white/20 hover:text-white transition-all z-10"
            >
              Skip →
            </button>

            {/* Scanlines */}
            <div 
              className="absolute inset-0 pointer-events-none opacity-30"
              style={{
                background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(60, 242, 255, 0.03) 2px, rgba(60, 242, 255, 0.03) 4px)'
              }}
            />

            {/* Grid */}
            <div 
              className="absolute inset-0 pointer-events-none opacity-50"
              style={{
                backgroundImage: 'linear-gradient(rgba(60, 242, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(60, 242, 255, 0.03) 1px, transparent 1px)',
                backgroundSize: '50px 50px'
              }}
            />

            {/* Logo Animation */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="text-center z-10"
            >
              <h1 className="text-5xl md:text-7xl font-black bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7] bg-clip-text text-transparent drop-shadow-[0_0_60px_rgba(60,242,255,0.5)]">
                AiMoviez
              </h1>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: 100 }}
                transition={{ duration: 0.5, delay: 0.8 }}
                className="h-0.5 bg-gradient-to-r from-transparent via-[#3CF2FF] to-transparent mx-auto my-4"
              />
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1 }}
                className="text-lg md:text-xl font-bold text-white/80 tracking-[0.3em] uppercase"
              >
                8SEC MADNESS
              </motion.p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============ MAIN CONTENT ============ */}
      <div
        className="min-h-screen relative flex items-center justify-center p-4 md:p-8 transition-opacity duration-500"
        style={{ opacity: !mounted || (showIntro && !introSkipped) ? 0 : 1 }}
      >
        {/* Background Grid - hidden on mobile for performance */}
        <div
          className="absolute inset-0 pointer-events-none hidden md:block"
          style={{
            backgroundImage: 'linear-gradient(rgba(60, 242, 255, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(60, 242, 255, 0.05) 1px, transparent 1px)',
            backgroundSize: '60px 60px'
          }}
        />

        {/* Glow Orbs - smaller on mobile for performance */}
        <div className="absolute top-[10%] left-[10%] w-[150px] h-[150px] md:w-[400px] md:h-[400px] rounded-full bg-[#3CF2FF] opacity-20 blur-[40px] md:blur-[80px]" />
        <div className="absolute bottom-[20%] right-[15%] w-[120px] h-[120px] md:w-[300px] md:h-[300px] rounded-full bg-[#A020F0] opacity-20 blur-[40px] md:blur-[80px]" />
        <div className="absolute top-[50%] right-[30%] w-[100px] h-[100px] md:w-[250px] md:h-[250px] rounded-full bg-[#FF00C7] opacity-15 blur-[40px] md:blur-[80px]" />

        {/* Content Container */}
        <div className="relative z-10 w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <h1 className="text-4xl md:text-5xl font-black bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7] bg-clip-text text-transparent">
              AiMoviez
            </h1>
            <div className="w-20 h-0.5 bg-gradient-to-r from-transparent via-[#3CF2FF] to-transparent mx-auto my-3" />
            <p className="text-xs md:text-sm font-semibold text-white/70 tracking-[0.25em] uppercase">
              8SEC MADNESS
            </p>
          </div>

          {/* Headline */}
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-extrabold mb-2">
              <span className="text-4xl md:text-5xl bg-gradient-to-r from-[#3CF2FF] to-[#FF00C7] bg-clip-text text-transparent animate-pulse">
                ∞
              </span>
              {' '}creators. 8 secs. 1 film.
            </h2>
            <p className="text-white/60 text-lg">let&apos;s make history.</p>
          </div>

          {/* Signup Card */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl">
            <h3 className="text-xl font-extrabold text-center mb-5 lowercase">
              join beta
            </h3>

            {/* Social Proof */}
            <div className="flex items-center justify-center gap-3 mb-3">
              <div className="flex -space-x-2">
                <div className="w-8 h-8 rounded-full bg-cyan-500/20 border-2 border-black flex items-center justify-center text-sm">🎬</div>
                <div className="w-8 h-8 rounded-full bg-purple-500/20 border-2 border-black flex items-center justify-center text-sm">🎭</div>
                <div className="w-8 h-8 rounded-full bg-pink-500/20 border-2 border-black flex items-center justify-center text-sm">🎥</div>
              </div>
              <p className="text-sm text-white/70">
                <span className="text-[#3CF2FF] font-bold">127</span> creators joined
              </p>
            </div>

            <p className="text-center text-sm text-white/50 mb-4">
              limited spots. move fast.
            </p>

            {/* Badges */}
            <div className="flex justify-center gap-2 mb-5 flex-wrap">
              <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-white/10 border border-white/20 animate-pulse">
                🔥 Trending
              </span>
              <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#FF00C7]/20 border border-[#FF00C7]/30 text-[#FF00C7]">
                ⚡ 247 joined today
              </span>
            </div>

            {/* Google Sign-in Button */}
            <motion.button
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
              className="w-full flex items-center justify-center gap-3 px-4 py-3.5 bg-white text-black rounded-xl font-semibold text-base hover:shadow-[0_10px_30px_rgba(255,255,255,0.2)] transition-shadow"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Continue with Google
            </motion.button>
          </div>

          {/* Footer text */}
          <p className="text-center text-xs text-white/30 mt-6">
            By joining, you agree to collaborate on the world&apos;s first AI-generated movie
          </p>
        </div>
      </div>
    </main>
  );
}
