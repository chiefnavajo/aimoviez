// Tests for Leaderboard component
// Displays ranked creators with tabs for Daily/Weekly/All-Time

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Leaderboard from '@/components/Leaderboard';
import { Leader } from '@/types';

// Mock framer-motion
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div {...props}>{children}</div>
    ),
    button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <button {...props}>{children}</button>
    ),
    span: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <span {...props}>{children}</span>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  useAnimation: () => ({ start: jest.fn() }),
}));

// Mock next/image
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, ...props }: { src: string; alt: string; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img src={src} alt={alt} {...props} />
  ),
}));

const createLeader = (overrides: Partial<Leader> = {}): Leader => ({
  id: 'leader-1',
  user: {
    id: 'user-1',
    name: 'Alice',
    avatar: 'https://example.com/alice.jpg',
  },
  votesTotal: 1500,
  rank: 1,
  badges: ['Top Creator'],
  xp: 3200,
  ...overrides,
});

describe('Leaderboard', () => {
  it('renders the Creator Leaderboard heading', () => {
    render(<Leaderboard leaders={[]} />);

    expect(screen.getByText('Creator Leaderboard')).toBeInTheDocument();
    expect(screen.getByText('Top contributors this period')).toBeInTheDocument();
  });

  it('shows empty state when no leaders', () => {
    render(<Leaderboard leaders={[]} />);

    expect(screen.getByText('No creators yet. Be the first!')).toBeInTheDocument();
  });

  it('renders leader items with name and vote count', () => {
    const leaders = [
      createLeader({ id: '1', rank: 1, user: { id: 'u1', name: 'Alice', avatar: 'https://example.com/a.jpg' }, votesTotal: 1500 }),
      createLeader({ id: '2', rank: 2, user: { id: 'u2', name: 'Bob', avatar: 'https://example.com/b.jpg' }, votesTotal: 1200 }),
    ];

    render(<Leaderboard leaders={leaders} />);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('1,500')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
  });

  it('displays XP for each leader', () => {
    const leaders = [
      createLeader({ id: '1', rank: 1, xp: 3200 }),
    ];

    render(<Leaderboard leaders={leaders} />);

    expect(screen.getByText('3,200 XP')).toBeInTheDocument();
  });

  it('displays badges for leaders', () => {
    const leaders = [
      createLeader({ id: '1', rank: 1, badges: ['Top Creator', 'Streak Master'] }),
    ];

    render(<Leaderboard leaders={leaders} />);

    expect(screen.getByText('Top Creator')).toBeInTheDocument();
    expect(screen.getByText('Streak Master')).toBeInTheDocument();
  });

  it('renders all three tab buttons', () => {
    render(<Leaderboard leaders={[]} />);

    expect(screen.getByText('Daily')).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByText('All-Time')).toBeInTheDocument();
  });

  it('allows switching between tabs', () => {
    render(<Leaderboard leaders={[]} />);

    const weeklyTab = screen.getByText('Weekly');
    fireEvent.click(weeklyTab);

    // Verify the tab is now active by checking class
    expect(weeklyTab.className).toContain('from-cyan-500');
  });

  it('renders medal emojis for top 3 ranks', () => {
    const leaders = [
      createLeader({ id: '1', rank: 1 }),
      createLeader({ id: '2', rank: 2, user: { id: 'u2', name: 'Bob', avatar: 'https://example.com/b.jpg' } }),
      createLeader({ id: '3', rank: 3, user: { id: 'u3', name: 'Carol', avatar: 'https://example.com/c.jpg' } }),
    ];

    render(<Leaderboard leaders={leaders} />);

    // getRankEmoji returns medal emojis for top 3
    expect(screen.getAllByText(/\u{1F947}/u).length).toBeGreaterThanOrEqual(1); // gold
    expect(screen.getAllByText(/\u{1F948}/u).length).toBeGreaterThanOrEqual(1); // silver
    expect(screen.getAllByText(/\u{1F949}/u).length).toBeGreaterThanOrEqual(1); // bronze
  });
});
