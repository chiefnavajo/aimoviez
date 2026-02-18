// Tests for StoryTimeline component
// Displays 75-segment timeline with progress bar, segment states, and detail modal

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import StoryTimeline from '@/components/StoryTimeline';
import { TimelineSegment } from '@/types';

// Mock framer-motion to avoid animation issues in tests
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

// Mock GenreBadge
jest.mock('@/lib/genre', () => ({
  GenreBadge: ({ genre }: { genre: string }) => (
    <span data-testid="genre-badge">{genre}</span>
  ),
}));

// Mock lucide-react icons to simple spans
jest.mock('lucide-react', () => ({
  Film: ({ size, ...props }: Record<string, unknown>) => <span data-testid="film-icon" {...props} />,
  X: ({ size, ...props }: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
}));

describe('StoryTimeline', () => {
  const createSegments = (
    doneCount: number,
    openCount: number,
    upcomingCount: number
  ): TimelineSegment[] => {
    const segments: TimelineSegment[] = [];
    let idx = 1;

    for (let i = 0; i < doneCount; i++) {
      segments.push({
        segment: idx++,
        status: 'done',
        thumbUrl: `https://example.com/thumb-${idx}.jpg`,
      });
    }
    for (let i = 0; i < openCount; i++) {
      segments.push({
        segment: idx++,
        status: 'open',
      });
    }
    for (let i = 0; i < upcomingCount; i++) {
      segments.push({
        segment: idx++,
        status: 'upcoming',
      });
    }
    return segments;
  };

  it('renders the Story Timeline heading', () => {
    const segments = createSegments(5, 1, 69);
    render(<StoryTimeline segments={segments} />);

    expect(screen.getByText('Story Timeline')).toBeInTheDocument();
  });

  it('displays correct completed count and total', () => {
    const segments = createSegments(10, 1, 64);
    render(<StoryTimeline segments={segments} />);

    expect(screen.getByText('10 of 75 scenes complete')).toBeInTheDocument();
  });

  it('displays correct progress percentage', () => {
    const segments = createSegments(15, 1, 59);
    render(<StoryTimeline segments={segments} />);

    // 15 / 75 = 20.0%
    expect(screen.getByText('20.0% complete')).toBeInTheDocument();
  });

  it('renders all segment buttons', () => {
    const segments = createSegments(3, 1, 6);
    render(<StoryTimeline segments={segments} />);

    // Each segment should have an aria-label
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      expect(
        screen.getByLabelText(`Segment ${seg.segment}: ${seg.status}`)
      ).toBeInTheDocument();
    }
  });

  it('shows legend with Complete, Active, and Upcoming labels', () => {
    const segments = createSegments(1, 1, 1);
    render(<StoryTimeline segments={segments} />);

    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
  });

  it('opens detail modal when clicking a done segment', () => {
    const segments = createSegments(2, 0, 0);
    render(<StoryTimeline segments={segments} />);

    const firstSegment = screen.getByLabelText('Segment 1: done');
    fireEvent.click(firstSegment);

    expect(screen.getByText('Scene 1')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('opens detail modal when clicking an open segment', () => {
    const segments: TimelineSegment[] = [
      { segment: 1, status: 'open' },
    ];
    render(<StoryTimeline segments={segments} />);

    fireEvent.click(screen.getByLabelText('Segment 1: open'));

    expect(screen.getByText('Scene 1')).toBeInTheDocument();
    expect(screen.getByText('Currently Active')).toBeInTheDocument();
  });

  it('does NOT open modal when clicking an upcoming segment', () => {
    const segments: TimelineSegment[] = [
      { segment: 1, status: 'upcoming' },
    ];
    render(<StoryTimeline segments={segments} />);

    fireEvent.click(screen.getByLabelText('Segment 1: upcoming'));

    // Modal title "Scene 1" should NOT be present
    expect(screen.queryByText('Scene 1')).not.toBeInTheDocument();
  });

  it('closes detail modal when clicking the close button', () => {
    const segments: TimelineSegment[] = [
      { segment: 1, status: 'done', thumbUrl: 'https://example.com/t.jpg' },
    ];
    render(<StoryTimeline segments={segments} />);

    fireEvent.click(screen.getByLabelText('Segment 1: done'));
    expect(screen.getByText('Scene 1')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Close modal'));
    expect(screen.queryByText('Scene 1')).not.toBeInTheDocument();
  });
});
