// Tests for VideoCard component
// Core voting UI component

import { render, screen, fireEvent } from '@testing-library/react';
import VideoCard from '@/components/VideoCard';

// Mock framer-motion to avoid animation issues in tests
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// Mock next/image
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, ...props }: { src: string; alt: string; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}));

// Mock genre badge
jest.mock('@/lib/genre', () => ({
  GenreBadge: ({ genre }: { genre: string }) => (
    <span data-testid="genre-badge">{genre}</span>
  ),
}));

describe('VideoCard', () => {
  const mockClip = {
    id: 'clip-123',
    title: 'Amazing Sunset',
    thumbnailUrl: 'https://example.com/thumb.jpg',
    videoUrl: 'https://example.com/video.mp4',
    genre: 'NATURE',
    duration: 8,
    votes: 150,
    user: {
      id: 'user-1',
      name: 'John Creator',
      avatar: 'https://example.com/avatar.jpg',
    },
  };

  const mockOnVote = jest.fn();

  beforeEach(() => {
    mockOnVote.mockClear();
  });

  it('renders clip information correctly', () => {
    render(
      <VideoCard clip={mockClip} onVote={mockOnVote} isAuthenticated={true} />
    );

    expect(screen.getByText('Amazing Sunset')).toBeInTheDocument();
    expect(screen.getByText('John Creator')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('8s')).toBeInTheDocument();
    expect(screen.getByTestId('genre-badge')).toHaveTextContent('NATURE');
  });

  it('renders thumbnail image', () => {
    render(
      <VideoCard clip={mockClip} onVote={mockOnVote} isAuthenticated={true} />
    );

    const thumbnail = screen.getByAltText('Amazing Sunset');
    expect(thumbnail).toHaveAttribute('src', 'https://example.com/thumb.jpg');
  });

  it('renders creator avatar', () => {
    render(
      <VideoCard clip={mockClip} onVote={mockOnVote} isAuthenticated={true} />
    );

    const avatar = screen.getByAltText('John Creator');
    expect(avatar).toHaveAttribute('src', 'https://example.com/avatar.jpg');
  });

  it('shows Vote button when not voted', () => {
    render(
      <VideoCard clip={mockClip} onVote={mockOnVote} isAuthenticated={true} />
    );

    expect(screen.getByText('Vote')).toBeInTheDocument();
    expect(screen.queryByText('Voted')).not.toBeInTheDocument();
  });

  it('calls onVote when authenticated user clicks Vote', () => {
    render(
      <VideoCard clip={mockClip} onVote={mockOnVote} isAuthenticated={true} />
    );

    const voteButton = screen.getByRole('button', { name: /vote for/i });
    fireEvent.click(voteButton);

    expect(mockOnVote).toHaveBeenCalledWith('clip-123');
    expect(mockOnVote).toHaveBeenCalledTimes(1);
  });

  it('shows Voted after clicking Vote', () => {
    render(
      <VideoCard clip={mockClip} onVote={mockOnVote} isAuthenticated={true} />
    );

    const voteButton = screen.getByRole('button', { name: /vote for/i });
    fireEvent.click(voteButton);

    expect(screen.getByText('Voted')).toBeInTheDocument();
    expect(screen.queryByText('Vote')).not.toBeInTheDocument();
  });

  it('disables vote button after voting', () => {
    render(
      <VideoCard clip={mockClip} onVote={mockOnVote} isAuthenticated={true} />
    );

    const voteButton = screen.getByRole('button', { name: /vote for/i });
    fireEvent.click(voteButton);

    expect(voteButton).toBeDisabled();
  });

  it('does not call onVote twice when clicked multiple times', () => {
    render(
      <VideoCard clip={mockClip} onVote={mockOnVote} isAuthenticated={true} />
    );

    const voteButton = screen.getByRole('button', { name: /vote for/i });
    fireEvent.click(voteButton);
    fireEvent.click(voteButton);
    fireEvent.click(voteButton);

    expect(mockOnVote).toHaveBeenCalledTimes(1);
  });

  it('does not call onVote when not authenticated', () => {
    render(
      <VideoCard clip={mockClip} onVote={mockOnVote} isAuthenticated={false} />
    );

    const voteButton = screen.getByRole('button', { name: /vote for/i });
    fireEvent.click(voteButton);

    expect(mockOnVote).not.toHaveBeenCalled();
  });

  it('has correct aria-label for accessibility', () => {
    render(
      <VideoCard clip={mockClip} onVote={mockOnVote} isAuthenticated={true} />
    );

    const card = screen.getByRole('article');
    expect(card).toHaveAttribute(
      'aria-label',
      'Amazing Sunset by John Creator'
    );
  });

  it('handles keyboard Enter to vote', () => {
    render(
      <VideoCard clip={mockClip} onVote={mockOnVote} isAuthenticated={true} />
    );

    const card = screen.getByRole('article');
    fireEvent.keyDown(card, { key: 'Enter' });

    expect(mockOnVote).toHaveBeenCalledWith('clip-123');
  });

  it('handles keyboard Space to vote', () => {
    render(
      <VideoCard clip={mockClip} onVote={mockOnVote} isAuthenticated={true} />
    );

    const card = screen.getByRole('article');
    fireEvent.keyDown(card, { key: ' ' });

    expect(mockOnVote).toHaveBeenCalledWith('clip-123');
  });

  it('formats large vote counts with comma separators', () => {
    const clipWithManyVotes = {
      ...mockClip,
      votes: 1500000,
    };

    render(
      <VideoCard
        clip={clipWithManyVotes}
        onVote={mockOnVote}
        isAuthenticated={true}
      />
    );

    expect(screen.getByText('1,500,000')).toBeInTheDocument();
  });
});
