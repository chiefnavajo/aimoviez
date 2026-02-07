// lib/utils.ts
// Utility functions

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names with Tailwind CSS conflict resolution
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format number with K/M suffix
 */
export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const past = new Date(date);
  const diffMs = now.getTime() - past.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return past.toLocaleDateString();
}

/**
 * Truncate text with ellipsis
 */
export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + '...';
}

/**
 * Generate initials from name
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(part => part.length > 0)
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Sleep/delay utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// AVATAR UTILITIES
// ============================================================================

/**
 * Allowed domains for avatar URLs to prevent XSS
 * Only allow trusted image hosting services
 */
const ALLOWED_AVATAR_DOMAINS = [
  'api.dicebear.com',
  'lh3.googleusercontent.com', // Google profile pics
  'dxixqdmqomqzhilmdfzg.supabase.co', // Supabase storage
];

/**
 * Validates that an avatar URL is safe
 * Prevents XSS by only allowing HTTPS URLs from trusted domains
 */
export function isValidAvatarUrl(url: string | null | undefined): boolean {
  if (!url || url.trim() === '') return false;

  try {
    const parsed = new URL(url);
    // Must be HTTPS
    if (parsed.protocol !== 'https:') return false;
    // Must be from an allowed domain
    const isAllowedDomain = ALLOWED_AVATAR_DOMAINS.some(
      domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
    );
    return isAllowedDomain;
  } catch {
    return false;
  }
}

/**
 * Get avatar URL for a user
 * Returns existing avatar URL (if valid) or generates a DiceBear fallback
 * SECURITY: Only allows URLs from trusted domains to prevent XSS
 * @param avatarUrl - Existing avatar URL (can be null/undefined)
 * @param seed - Seed for generating fallback avatar (username, id, etc.)
 * @param style - DiceBear style (default: 'avataaars')
 */
export function getAvatarUrl(
  avatarUrl: string | null | undefined,
  seed: string = 'default',
  style: 'avataaars' | 'shapes' | 'bottts' | 'identicon' = 'avataaars'
): string {
  // Only use the provided URL if it's from a trusted domain
  if (isValidAvatarUrl(avatarUrl)) {
    return avatarUrl!;
  }
  // Fallback to generated DiceBear avatar
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

/**
 * Generate a DiceBear avatar URL directly
 * @param seed - Seed for avatar generation
 * @param style - DiceBear style
 */
export function generateAvatarUrl(
  seed: string,
  style: 'avataaars' | 'shapes' | 'bottts' | 'identicon' = 'avataaars'
): string {
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

// ============================================================================
// VIDEO URL VALIDATION
// ============================================================================

/**
 * Validates that a video URL is safe to use
 * Only allows HTTPS URLs from trusted Supabase storage
 */
export function isValidVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    // Must be HTTPS
    if (parsed.protocol !== 'https:') return false;
    // Must be from Supabase storage
    if (!parsed.hostname.includes('supabase.co') &&
        !parsed.hostname.includes('supabase.in')) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns a safe video URL or fallback placeholder
 */
export function getSafeVideoUrl(url: string | null | undefined, fallback = '/placeholder-video.mp4'): string {
  return isValidVideoUrl(url) ? url! : fallback;
}
