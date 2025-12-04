import { render, screen } from '@testing-library/react';
import BottomNavigation from '@/components/BottomNavigation';

// Mock usePathname
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

import { usePathname } from 'next/navigation';

describe('BottomNavigation', () => {
  beforeEach(() => {
    (usePathname as jest.Mock).mockReturnValue('/dashboard');
  });

  it('renders all navigation items', () => {
    render(<BottomNavigation />);

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Watch')).toBeInTheDocument();
    expect(screen.getByText('Upload')).toBeInTheDocument();
    expect(screen.getByText('Ranks')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
  });

  it('has correct links', () => {
    render(<BottomNavigation />);

    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: /watch/i })).toHaveAttribute('href', '/watch');
    expect(screen.getByRole('link', { name: /upload/i })).toHaveAttribute('href', '/upload');
    expect(screen.getByRole('link', { name: /ranks/i })).toHaveAttribute('href', '/leaderboard');
    expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute('href', '/profile');
  });

  it('highlights the active route', () => {
    (usePathname as jest.Mock).mockReturnValue('/dashboard');
    const { container: _container } = render(<BottomNavigation />);

    // The dashboard link should have the active class (text-cyan-400)
    const homeLink = screen.getByRole('link', { name: /home/i });
    expect(homeLink).toHaveClass('text-cyan-400');
  });

  it('does not highlight inactive routes', () => {
    (usePathname as jest.Mock).mockReturnValue('/dashboard');
    render(<BottomNavigation />);

    // The profile link should not have the active class
    const profileLink = screen.getByRole('link', { name: /profile/i });
    expect(profileLink).not.toHaveClass('text-cyan-400');
  });

  it('updates active state when route changes', () => {
    (usePathname as jest.Mock).mockReturnValue('/profile');
    render(<BottomNavigation />);

    const profileLink = screen.getByRole('link', { name: /profile/i });
    expect(profileLink).toHaveClass('text-cyan-400');

    const homeLink = screen.getByRole('link', { name: /home/i });
    expect(homeLink).not.toHaveClass('text-cyan-400');
  });
});
