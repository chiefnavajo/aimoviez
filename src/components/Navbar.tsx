'use client';

// Navbar with brand, scene indicator, countdown, and user menu

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import Image from 'next/image';
import { useCountdown } from '@/hooks/useCountdown';
import { Round } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, User } from 'lucide-react';

interface NavbarProps {
  round: Round;
  userName: string;
  userAvatar: string;
}

export default function Navbar({ round, userName, userAvatar }: NavbarProps) {
  const router = useRouter();
  const countdown = useCountdown(round.closesAt);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen]);

  return (
    <nav className="sticky top-0 z-50 bg-[#050510]/80 backdrop-blur-xl border-b border-white/10">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          
          {/* Left: Brand Logo */}
          <div className="flex-shrink-0">
            <h1 className="text-xl md:text-2xl font-bold">
              <span className="bg-gradient-to-r from-cyan-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                AiMoviez
              </span>
              <span className="text-white/60 text-sm md:text-base ml-2">
                | 8SEC MADNESS
              </span>
            </h1>
          </div>

          {/* Center: Scene & Countdown */}
          <div className="hidden md:flex items-center gap-6">
            <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-white/5 border border-white/10">
              <div className="text-center">
                <div className="text-xs text-white/60 uppercase tracking-wider">Scene</div>
                <div className="text-lg font-bold text-cyan-400">
                  {round.segmentNumber}/{round.totalSegments}
                </div>
              </div>
              
              <div className="w-px h-8 bg-white/20" />
              
              <div className="text-center">
                <div className="text-xs text-white/60 uppercase tracking-wider">Closes In</div>
                <div 
                  className={`text-lg font-bold font-mono ${
                    countdown.isExpired 
                      ? 'text-red-400' 
                      : countdown.hours === 0 && countdown.minutes < 30 
                        ? 'text-orange-400' 
                        : 'text-green-400'
                  }`}
                >
                  {countdown.formatted}
                </div>
              </div>
            </div>
          </div>

          {/* Mobile Scene/Countdown */}
          <div className="flex md:hidden items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <span className="text-xs font-bold text-cyan-400">
              {round.segmentNumber}/{round.totalSegments}
            </span>
            <span className="text-xs text-white/60">•</span>
            <span className={`text-xs font-mono font-bold ${
              countdown.isExpired ? 'text-red-400' : 'text-green-400'
            }`}>
              {countdown.formatted}
            </span>
          </div>

          {/* Right: User Menu */}
          <div className="flex-shrink-0 relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all duration-300 focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050510]"
              aria-label="User menu"
              aria-expanded={menuOpen}
            >
              <Image
                src={userAvatar}
                alt={userName}
                width={32}
                height={32}
                className="w-8 h-8 rounded-full border-2 border-cyan-400/40"
              />
              <span className="hidden sm:inline text-sm font-medium text-white/90">
                {userName}
              </span>
            </button>

            {/* Dropdown Menu */}
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="absolute right-0 mt-2 w-48 rounded-xl bg-[#0a0a18] border border-white/10 shadow-2xl overflow-hidden"
                >
                  <div className="p-2 space-y-1">
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        router.push('/profile');
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-white/80 hover:bg-white/5 hover:text-white transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-cyan-400"
                    >
                      <User size={18} />
                      <span className="text-sm">Profile</span>
                    </button>
                    
                    <button
                      onClick={async () => {
                        setMenuOpen(false);
                        // Clear cached profile before signing out
                        localStorage.removeItem('user_profile');
                        localStorage.setItem('hasUsedAppBefore', 'true');
                        // Wait for signOut to complete before redirecting to avoid race conditions
                        await signOut({ redirect: false });
                        window.location.href = '/?from=logout';
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-red-400"
                    >
                      <LogOut size={18} />
                      <span className="text-sm">Logout</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </nav>
  );
}
