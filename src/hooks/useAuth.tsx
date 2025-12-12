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

  useEffect(() => {
    const abortController = new AbortController();

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

      // Check if session already has profile info
      if (session?.user?.hasProfile && session?.user?.username) {
        setHasProfile(true);
        setUserProfile({
          id: session.user.userId || '',
          username: session.user.username || '',
          display_name: session.user.name || session.user.username || '',
          avatar_url: session.user.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user.username}`,
          level: 1,
        });
        // Mark that user has used the app (persists through logout for intro skip)
        localStorage.setItem('hasUsedAppBefore', 'true');
        setIsChecking(false);
        return;
      }

      // Check localStorage for cached profile
      const cachedProfile = localStorage.getItem('user_profile');
      if (cachedProfile) {
        try {
          const profile = JSON.parse(cachedProfile);
          setHasProfile(true);
          setUserProfile(profile);
          // Mark that user has used the app (persists through logout for intro skip)
          localStorage.setItem('hasUsedAppBefore', 'true');
          setIsChecking(false);
          return;
        } catch {
          localStorage.removeItem('user_profile');
        }
      }

      // Fetch profile from API with abort signal
      try {
        const res = await fetch('/api/user/profile', {
          signal: abortController.signal,
        });

        // Don't update state if request was aborted
        if (abortController.signal.aborted) return;

        const data = await res.json();

        if (data.exists && data.user) {
          setHasProfile(true);
          setUserProfile(data.user);
          localStorage.setItem('user_profile', JSON.stringify(data.user));
          // Mark that user has used the app (persists through logout for intro skip)
          localStorage.setItem('hasUsedAppBefore', 'true');
        } else {
          setHasProfile(false);
        }
      } catch (err) {
        // Ignore abort errors
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Failed to check profile:', err);
        setHasProfile(false);
      }

      setIsChecking(false);
    };

    checkProfile();

    // Cleanup: abort fetch on unmount or dependency change
    return () => {
      abortController.abort();
    };
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
  };
}

// Simple wrapper component for protected pages
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, hasProfile: _hasProfile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // If done loading and not authenticated, redirect to home
    if (!isLoading && !isAuthenticated) {
      router.push(`/?callbackUrl=${encodeURIComponent(pathname)}`);
    }
  }, [isLoading, isAuthenticated, router, pathname]);

  // Show loading while checking auth - improved with gradient background
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#050510] via-[#0a0a18] to-[#050510] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-white/60 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  // Don't render children if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#050510] via-[#0a0a18] to-[#050510] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-white/60 text-sm">Redirecting...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
