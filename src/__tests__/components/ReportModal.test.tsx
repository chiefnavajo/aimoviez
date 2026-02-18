// Tests for ReportModal component
// Report form for clips, users, and comments with reason selection and submission

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReportModal from '@/components/ReportModal';

// Mock framer-motion
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, onClick, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div onClick={onClick as React.MouseEventHandler} {...props}>{children}</div>
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

// Mock useFocusTrap hook
jest.mock('@/hooks/useFocusTrap', () => ({
  useFocusTrap: () => React.createRef(),
}));

// Mock useCsrf hook
jest.mock('@/hooks/useCsrf', () => ({
  useCsrf: () => ({
    getHeaders: () => ({ 'Content-Type': 'application/json', 'x-csrf-token': 'test-token' }),
  }),
}));

describe('ReportModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    type: 'clip' as const,
    targetId: 'clip-123',
    targetName: 'Test Clip',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(<ReportModal {...defaultProps} isOpen={false} />);

    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
  });

  it('renders the report form with correct type label', () => {
    render(<ReportModal {...defaultProps} />);

    expect(screen.getByText('Report Clip')).toBeInTheDocument();
    expect(screen.getByText('"Test Clip"')).toBeInTheDocument();
  });

  it('renders "Report Comment" for comment type', () => {
    render(<ReportModal {...defaultProps} type="comment" targetId="comment-1" />);

    expect(screen.getByText('Report Comment')).toBeInTheDocument();
  });

  it('renders "Report User" for user type', () => {
    render(<ReportModal {...defaultProps} type="user" targetId="user-1" />);

    expect(screen.getByText('Report User')).toBeInTheDocument();
  });

  it('renders all five report reasons', () => {
    render(<ReportModal {...defaultProps} />);

    expect(screen.getByText('Inappropriate Content')).toBeInTheDocument();
    expect(screen.getByText('Spam')).toBeInTheDocument();
    expect(screen.getByText('Harassment')).toBeInTheDocument();
    expect(screen.getByText('Copyright Violation')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  it('disables submit button when no reason is selected', () => {
    render(<ReportModal {...defaultProps} />);

    // The Submit Report button should be disabled when no reason is selected
    const submitButton = screen.getByText('Submit Report').closest('button');
    expect(submitButton).toBeDisabled();
  });

  it('allows selecting a reason', () => {
    render(<ReportModal {...defaultProps} />);

    // Click the Spam reason button
    fireEvent.click(screen.getByText('Spam'));

    // After selection, the Spam button should have the selected bg class
    const spamButton = screen.getByText('Spam').closest('button');
    expect(spamButton).toBeTruthy();
    expect(spamButton!.className).toContain('bg-red-500/20');
  });

  it('submits report successfully and shows success message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    render(<ReportModal {...defaultProps} />);

    // Select a reason
    fireEvent.click(screen.getByText('Inappropriate Content'));

    // Type additional details
    const textarea = screen.getByPlaceholderText(/provide any additional context/i);
    fireEvent.change(textarea, { target: { value: 'Offensive content in clip' } });

    // Submit
    fireEvent.click(screen.getByText('Submit Report'));

    await waitFor(() => {
      expect(screen.getByText('Report Submitted')).toBeInTheDocument();
      expect(
        screen.getByText(/Thank you for helping keep our community safe/i)
      ).toBeInTheDocument();
    });
  });

  it('shows error message when submission fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Rate limit exceeded' }),
    });

    render(<ReportModal {...defaultProps} />);

    fireEvent.click(screen.getByText('Harassment'));
    fireEvent.click(screen.getByText('Submit Report'));

    await waitFor(() => {
      expect(screen.getByText('Rate limit exceeded')).toBeInTheDocument();
    });
  });

  it('calls onClose and resets state when Cancel button is clicked', () => {
    const onClose = jest.fn();
    render(<ReportModal {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByText('Cancel'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows false report warning', () => {
    render(<ReportModal {...defaultProps} />);

    expect(
      screen.getByText(/False reports may result in action against your account/i)
    ).toBeInTheDocument();
  });

  it('shows character count for additional details textarea', () => {
    render(<ReportModal {...defaultProps} />);

    expect(screen.getByText('0/1000')).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(/provide any additional context/i);
    fireEvent.change(textarea, { target: { value: 'Some text here' } });

    expect(screen.getByText('14/1000')).toBeInTheDocument();
  });
});
