// Tests for DirectionVotingModal component
// Shows direction options for story voting with floating indicator

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DirectionVotingModal from '@/components/DirectionVotingModal';

// Mock framer-motion
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div {...props}>{children}</div>
    ),
    button: ({ children, onClick, disabled, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <button onClick={onClick as React.MouseEventHandler} disabled={disabled as boolean} {...props}>{children}</button>
    ),
    span: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <span {...props}>{children}</span>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  useAnimation: () => ({ start: jest.fn() }),
}));

// Mock useCoDirector hooks
const mockDirectionsData = {
  voting_open: true,
  directions: [
    {
      id: 'dir-1',
      title: 'The Chase Begins',
      description: 'A thrilling car chase through the city streets',
      mood: 'Intense',
      suggested_genre: 'Action',
      vote_count: 10,
      visual_hints: 'Fast cars, neon lights',
    },
    {
      id: 'dir-2',
      title: 'Quiet Revelation',
      description: 'A calm scene where the truth is finally revealed',
      mood: 'Thoughtful',
      suggested_genre: 'Drama',
      vote_count: 5,
      visual_hints: null,
    },
  ],
  total_votes: 15,
  slot_position: 3,
  voting_ends_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
};

const mockVoteStatus = {
  ok: true,
  has_voted: false,
  voted_for: null,
};

const mockCastVote = jest.fn();

jest.mock('@/hooks/useCoDirector', () => ({
  useDirections: () => ({
    data: mockDirectionsData,
    isLoading: false,
  }),
  useDirectionVoteStatus: () => ({
    data: mockVoteStatus,
    isLoading: false,
  }),
  useCastDirectionVote: () => ({
    mutate: mockCastVote,
    isPending: false,
  }),
}));

// Mock sessionStorage
const mockSessionStorage: Record<string, string> = {};
Object.defineProperty(window, 'sessionStorage', {
  value: {
    getItem: (key: string) => mockSessionStorage[key] || null,
    setItem: (key: string, value: string) => { mockSessionStorage[key] = value; },
    removeItem: (key: string) => { delete mockSessionStorage[key]; },
    clear: () => { Object.keys(mockSessionStorage).forEach(k => delete mockSessionStorage[k]); },
  },
  writable: true,
});

describe('DirectionVotingModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockSessionStorage).forEach(k => delete mockSessionStorage[k]);
    // Reset mocks to default
    mockDirectionsData.voting_open = true;
    mockDirectionsData.directions = [
      {
        id: 'dir-1',
        title: 'The Chase Begins',
        description: 'A thrilling car chase through the city streets',
        mood: 'Intense',
        suggested_genre: 'Action',
        vote_count: 10,
        visual_hints: 'Fast cars, neon lights',
      },
      {
        id: 'dir-2',
        title: 'Quiet Revelation',
        description: 'A calm scene where the truth is finally revealed',
        mood: 'Thoughtful',
        suggested_genre: 'Drama',
        vote_count: 5,
        visual_hints: null,
      },
    ];
    mockVoteStatus.has_voted = false;
    mockVoteStatus.voted_for = null;
  });

  it('renders nothing when voting is not open', () => {
    mockDirectionsData.voting_open = false;
    const { container } = render(<DirectionVotingModal />);

    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when there are no directions', () => {
    mockDirectionsData.directions = [];
    const { container } = render(<DirectionVotingModal />);

    expect(container.innerHTML).toBe('');
  });

  it('auto-opens the modal on first render when voting is open and user has not voted', () => {
    render(<DirectionVotingModal />);

    expect(screen.getByText('Choose the Story Direction')).toBeInTheDocument();
    expect(screen.getByText('Slot #3')).toBeInTheDocument();
  });

  it('renders all direction options with titles and descriptions', () => {
    render(<DirectionVotingModal />);

    expect(screen.getByText('The Chase Begins')).toBeInTheDocument();
    expect(screen.getByText('A thrilling car chase through the city streets')).toBeInTheDocument();
    expect(screen.getByText('Quiet Revelation')).toBeInTheDocument();
    expect(screen.getByText('A calm scene where the truth is finally revealed')).toBeInTheDocument();
  });

  it('shows mood and suggested genre badges', () => {
    render(<DirectionVotingModal />);

    expect(screen.getByText('Intense')).toBeInTheDocument();
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByText('Thoughtful')).toBeInTheDocument();
    expect(screen.getByText('Drama')).toBeInTheDocument();
  });

  it('shows "Select a direction to vote" when nothing is selected', () => {
    render(<DirectionVotingModal />);

    expect(screen.getByText('Select a direction to vote')).toBeInTheDocument();
  });

  it('shows "Submit Vote" after selecting a direction', () => {
    render(<DirectionVotingModal />);

    // Click the first direction
    fireEvent.click(screen.getByText('The Chase Begins'));

    expect(screen.getByText('Submit Vote')).toBeInTheDocument();
  });

  it('calls castVote when Submit Vote is clicked', () => {
    render(<DirectionVotingModal />);

    fireEvent.click(screen.getByText('The Chase Begins'));
    fireEvent.click(screen.getByText('Submit Vote'));

    expect(mockCastVote).toHaveBeenCalledWith('dir-1', expect.any(Object));
  });

  it('shows floating "Vote on Direction" indicator when modal is closed', () => {
    // Mark as already shown so it doesn't auto-open
    mockSessionStorage['direction_voting_shown_3'] = 'true';

    render(<DirectionVotingModal />);

    expect(screen.getByText('Vote on Direction')).toBeInTheDocument();
  });

  it('shows "Voted" indicator when user has already voted', () => {
    mockSessionStorage['direction_voting_shown_3'] = 'true';
    mockVoteStatus.has_voted = true;
    mockVoteStatus.voted_for = 'dir-1';

    render(<DirectionVotingModal />);

    expect(screen.getByText('Voted')).toBeInTheDocument();
  });
});
