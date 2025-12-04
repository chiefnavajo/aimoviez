'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';

interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  level: number;
}

interface UseAuthReturn {
  isLoading: boolean;
  isAuthenticated: boolean;
  hasProfile: boolean;
  user: UserProfile | null;
  session: any;
  hasMounted: boolean;
}

// Pages that don't require authentication
const PUBLIC_PAGES = ['/', '/about'];

// Pages that are part of onboarding flow
const ONBOARDING_PAGES = ['/onboarding'];

export function useAuth(): UseAuthReturn {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const [hasProfile, setHasProfile] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [hasMounted, setHasMounted] = useState(false);

  // Check localStorage immediately after mount (client-side only)
  useEffect(() => {
    setHasMounted(true);
    try {
      const cached = localStorage.getItem('user_profile');
      if (cached) {
        const profile = JSON.parse(cached);
        setHasProfile(true);
        setUserProfile(profile);
        setIsChecking(false);
      }
    } catch {
      // Invalid cache, continue with normal flow
    }
  }, []);

  useEffect(() => {
    const checkProfile = async () => {
      // If not logged in, no need to check profile
      if (status === 'unauthenticated') {
        setIsChecking(false);
        return;
      }

      // Still loading session
      if (status === 'loading') {
        return;
      }

      // FAST PATH 1: Check localStorage first (instant, no network)
      const cachedProfile = localStorage.getItem('user_profile');
      if (cachedProfile) {
        try {
          const profile = JSON.parse(cachedProfile);
          setHasProfile(true);
          setUserProfile(profile);
          setIsChecking(false);
          return;
        } catch {
          localStorage.removeItem('user_profile');
        }
      }

      // FAST PATH 2: Check if session already has profile info
      if (session?.user?.hasProfile && session?.user?.username) {
        const profile = {
          id: session.user.userId || '',
          username: session.user.username || '',
          display_name: session.user.name || session.user.username || '',
          avatar_url: session.user.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user.username}`,
          level: 1,
        };
        setHasProfile(true);
        setUserProfile(profile);
        localStorage.setItem('user_profile', JSON.stringify(profile));
        setIsChecking(false);
        return;
      }

      // SLOW PATH: Fetch profile from API (only if no cache)
      try {
        const res = await fetch('/api/user/profile');
        const data = await res.json();

        if (data.exists && data.user) {
          setHasProfile(true);
          setUserProfile(data.user);
          localStorage.setItem('user_profile', JSON.stringify(data.user));
        } else {
          setHasProfile(false);
        }
      } catch (err) {
        console.error('Failed to check profile:', err);
        setHasProfile(false);
      }

      setIsChecking(false);
    };

    checkProfile();
  }, [session, status]);

  // Handle redirects
  useEffect(() => {
    if (isChecking || status === 'loading') return;

    const isPublicPage = PUBLIC_PAGES.includes(pathname);
    const isOnboardingPage = ONBOARDING_PAGES.includes(pathname);

    // If authenticated but no profile, redirect to onboarding
    if (status === 'authenticated' && !hasProfile && !isOnboardingPage && !isPublicPage) {
      router.push('/onboarding');
      return;
    }

    // If has profile and on onboarding page, redirect to dashboard
    if (hasProfile && isOnboardingPage) {
      router.push('/dashboard');
      return;
    }
  }, [isChecking, status, hasProfile, pathname, router]);

  return {
    isLoading: status === 'loading' || isChecking,
    isAuthenticated: status === 'authenticated',
    hasProfile,
    user: userProfile,
    session,
    hasMounted,
  };
}

// Simple wrapper component for protected pages
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, hasProfile, hasMounted } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // If done loading and not authenticated, redirect to home
    if (!isLoading && !isAuthenticated) {
      router.push(`/?callbackUrl=${encodeURIComponent(pathname)}`);
    }
  }, [isLoading, isAuthenticated, router, pathname]);

  // Always show loading screen on server and before mount to prevent hydration mismatch
  // After mount, if user has cached profile, render content immediately
  if (!hasMounted || isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4">
        {/* Animated logo */}
        <div
          className="text-5xl font-black bg-clip-text text-transparent bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7] animate-pulse"
          style={{ textShadow: '0 0 30px rgba(60, 242, 255, 0.5)' }}
        >
          ∞
        </div>
        <div className="text-white/60 text-sm">Loading...</div>
        {/* Spinner */}
        <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
