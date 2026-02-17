'use client';

import { Infinity, Play, Upload, Trophy, User, Clapperboard, Sparkles, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useFeature } from '@/hooks/useFeatureFlags';

export default function BottomNavigation() {
  const pathname = usePathname();
  const { enabled: aiEnabled } = useFeature('ai_video_generation');

  // On dashboard, show Story button instead of Home
  const isDashboard = pathname === '/dashboard';

  const navItems = [
    isDashboard
      ? { href: '/story', icon: Clapperboard, label: 'Story' }
      : { href: '/dashboard', icon: Infinity, label: 'Vote' },
    { href: '/watch', icon: Play, label: 'Watch' },
    { href: '/upload', icon: Upload, label: 'Upload' },
    ...(aiEnabled ? [{ href: '/create', icon: Sparkles, label: 'Create' }] : []),
    { href: '/leaderboard', icon: Trophy, label: 'Ranks' },
    { href: '/team', icon: Users, label: 'Team' },
    { href: '/profile', icon: User, label: 'Profile' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-black/80 md:bg-black/50 md:backdrop-blur-sm border-t border-fuchsia-500/30 safe-area-bottom" data-tour="bottom-nav">
      {/* Safe area spacer for devices with home indicator */}
      <div className="flex justify-around items-center h-14 md:h-16 px-1 pb-safe">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center flex-1 py-1.5 min-w-0 transition-colors ${
                isActive
                  ? 'text-fuchsia-400'
                  : 'text-cyan-300/60 active:text-cyan-300 hover:text-cyan-300'
              }`}
            >
              <Icon className={`w-5 h-5 md:w-6 md:h-6 shrink-0 ${isActive ? 'text-fuchsia-400' : ''}`} />
              <span className="text-[10px] md:text-xs mt-0.5 truncate max-w-full">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
