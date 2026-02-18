import { render, screen } from '@testing-library/react';
import BottomNavigation from '@/components/BottomNavigation';

// Mock usePathname
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

// Mock useFeatureFlags to avoid QueryClientProvider dependency
jest.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: {}, isLoading: false }),
  useFeature: () => ({ enabled: false, isLoading: false }),
}));

import { usePathname } from 'next/navigation';

describe('BottomNavigation', () => {
  beforeEach(() => {
    (usePathname as jest.Mock).mockReturnValue('/dashboard');
  });

  it('renders navigation items for dashboard', () => {
    render(<BottomNavigation />);

    // On /dashboard, first item is "Story" (not "Vote")
    expect(screen.getByText('Story')).toBeInTheDocument();
    expect(screen.getByText('Watch')).toBeInTheDocument();
    expect(screen.getByText('Upload')).toBeInTheDocument();
    expect(screen.getByText('Ranks')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
  });

  it('shows Vote instead of Story on non-dashboard pages', () => {
    (usePathname as jest.Mock).mockReturnValue('/watch');
    render(<BottomNavigation />);

    expect(screen.getByText('Vote')).toBeInTheDocument();
    expect(screen.queryByText('Story')).not.toBeInTheDocument();
  });

  it('has correct links on dashboard', () => {
    render(<BottomNavigation />);

    expect(screen.getByRole('link', { name: /story/i })).toHaveAttribute('href', '/story');
    expect(screen.getByRole('link', { name: /watch/i })).toHaveAttribute('href', '/watch');
    expect(screen.getByRole('link', { name: /upload/i })).toHaveAttribute('href', '/upload');
    expect(screen.getByRole('link', { name: /ranks/i })).toHaveAttribute('href', '/leaderboard');
    expect(screen.getByRole('link', { name: /team/i })).toHaveAttribute('href', '/team');
    expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute('href', '/profile');
  });

  it('highlights the active route with fuchsia', () => {
    (usePathname as jest.Mock).mockReturnValue('/profile');
    render(<BottomNavigation />);

    const profileLink = screen.getByRole('link', { name: /profile/i });
    expect(profileLink).toHaveClass('text-fuchsia-400');
  });

  it('does not highlight inactive routes', () => {
    (usePathname as jest.Mock).mockReturnValue('/profile');
    render(<BottomNavigation />);

    const watchLink = screen.getByRole('link', { name: /watch/i });
    expect(watchLink).not.toHaveClass('text-fuchsia-400');
  });
});
