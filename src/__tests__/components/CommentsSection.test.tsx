// Tests for CommentsSection component
// TikTok-style comment panel with real-time comments, likes, replies, delete

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CommentsSection from '@/components/CommentsSection';

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

// Mock useCsrf hook
jest.mock('@/hooks/useCsrf', () => ({
  useCsrf: () => ({
    getHeaders: () => ({ 'Content-Type': 'application/json', 'x-csrf-token': 'test-token' }),
  }),
}));

// Mock useRealtimeComments hook
jest.mock('@/hooks/useRealtimeComments', () => ({
  useRealtimeComments: jest.fn(),
}));

// Mock react-hot-toast
jest.mock('react-hot-toast', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

// Mock ReportModal
jest.mock('@/components/ReportModal', () => ({
  __esModule: true,
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="report-modal">Report Modal</div> : null,
}));

// Helper to create mock comments
const createComment = (overrides: Record<string, unknown> = {}) => ({
  id: 'comment-1',
  clip_id: 'clip-1',
  user_key: 'user-1',
  username: 'testuser',
  avatar_url: 'https://example.com/avatar.jpg',
  comment_text: 'Great clip!',
  likes_count: 5,
  created_at: new Date().toISOString(),
  is_own: false,
  is_liked: false,
  replies: [],
  ...overrides,
});

describe('CommentsSection', () => {
  const defaultProps = {
    clipId: 'clip-1',
    isOpen: true,
    onClose: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: fetch returns empty comments
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ comments: [], total: 0, has_more: false }),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the comments panel when open', () => {
    render(<CommentsSection {...defaultProps} />);

    expect(screen.getByText('0 Comments')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<CommentsSection {...defaultProps} isOpen={false} />);

    expect(screen.queryByText('Comments')).not.toBeInTheDocument();
  });

  it('shows empty state when there are no comments', async () => {
    render(<CommentsSection {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No comments yet')).toBeInTheDocument();
      expect(screen.getByText('Be the first to comment!')).toBeInTheDocument();
    });
  });

  it('renders fetched comments', async () => {
    const mockComments = [
      createComment({ id: 'c1', username: 'alice', comment_text: 'Amazing!' }),
      createComment({ id: 'c2', username: 'bob', comment_text: 'Love it!' }),
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ comments: mockComments, total: 2, has_more: false }),
    });

    render(<CommentsSection {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Amazing!')).toBeInTheDocument();
      expect(screen.getByText('Love it!')).toBeInTheDocument();
    });
  });

  it('renders the comment input field with placeholder', () => {
    render(<CommentsSection {...defaultProps} />);

    expect(screen.getByPlaceholderText('Add a comment...')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = jest.fn();
    render(<CommentsSection {...defaultProps} onClose={onClose} />);

    const closeButton = screen.getByLabelText('Close comments');
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submits a new comment on Enter key', async () => {
    const fetchMock = jest.fn()
      // Initial comments fetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ comments: [], total: 0, has_more: false }),
      })
      // POST comment
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            comment: createComment({ id: 'new-1', comment_text: 'Hello world', is_own: true }),
          }),
      });

    global.fetch = fetchMock;
    const onCommentAdded = jest.fn();

    render(<CommentsSection {...defaultProps} onCommentAdded={onCommentAdded} />);

    const input = screen.getByPlaceholderText('Add a comment...');
    fireEvent.change(input, { target: { value: 'Hello world' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      // Verify POST was called
      const postCall = fetchMock.mock.calls.find(
        (call: unknown[]) => call[1]?.method === 'POST'
      );
      expect(postCall).toBeTruthy();
    });
  });

  it('shows character count when comment is longer than 400 chars', () => {
    render(<CommentsSection {...defaultProps} />);

    const input = screen.getByPlaceholderText('Add a comment...');
    const longText = 'a'.repeat(410);
    fireEvent.change(input, { target: { value: longText } });

    expect(screen.getByText('410/500')).toBeInTheDocument();
  });
});
