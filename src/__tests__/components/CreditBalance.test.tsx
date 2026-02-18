// Tests for CreditBalance component
// Compact credit display in Navbar with purchase modal trigger

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CreditBalance from '@/components/CreditBalance';

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

// Mock useCredits hook
const mockRefetch = jest.fn();
let mockCreditState = { balance: 100, isLoading: false, error: null };
jest.mock('@/hooks/useCredits', () => ({
  useCredits: () => ({
    ...mockCreditState,
    refetch: mockRefetch,
  }),
}));

// Mock useFeature hook
let mockFeatureState = { enabled: true, isLoading: false, config: null };
jest.mock('@/hooks/useFeatureFlags', () => ({
  useFeature: () => mockFeatureState,
  useFeatureFlags: () => ({
    isEnabled: () => true,
    getConfig: () => null,
    isLoading: false,
  }),
}));

// Mock CreditPurchaseModal
jest.mock('@/components/CreditPurchaseModal', () => ({
  __esModule: true,
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="purchase-modal">
        <button onClick={onClose}>Close Modal</button>
      </div>
    ) : null,
}));

describe('CreditBalance', () => {
  beforeEach(() => {
    mockCreditState = { balance: 100, isLoading: false, error: null };
    mockFeatureState = { enabled: true, isLoading: false, config: null };
    mockRefetch.mockClear();
  });

  it('renders the credit balance when feature is enabled', () => {
    render(<CreditBalance />);

    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('renders nothing when credit system is disabled', () => {
    mockFeatureState = { enabled: false, isLoading: false, config: null };
    const { container } = render(<CreditBalance />);

    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when feature flag is still loading', () => {
    mockFeatureState = { enabled: false, isLoading: true, config: null };
    const { container } = render(<CreditBalance />);

    expect(container.innerHTML).toBe('');
  });

  it('displays loading indicator when balance is loading', () => {
    mockCreditState = { balance: 0, isLoading: true, error: null };
    render(<CreditBalance />);

    expect(screen.getByText('...')).toBeInTheDocument();
  });

  it('displays zero balance correctly', () => {
    mockCreditState = { balance: 0, isLoading: false, error: null };
    render(<CreditBalance />);

    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('has correct aria-label with balance', () => {
    render(<CreditBalance />);

    expect(
      screen.getByLabelText('100 credits. Click to buy more.')
    ).toBeInTheDocument();
  });

  it('opens purchase modal when balance button is clicked', () => {
    render(<CreditBalance />);

    const balanceButton = screen.getByLabelText('100 credits. Click to buy more.');
    fireEvent.click(balanceButton);

    expect(screen.getByTestId('purchase-modal')).toBeInTheDocument();
  });

  it('calls refetch when purchase modal is closed', () => {
    render(<CreditBalance />);

    // Open modal
    fireEvent.click(screen.getByLabelText('100 credits. Click to buy more.'));
    expect(screen.getByTestId('purchase-modal')).toBeInTheDocument();

    // Close modal
    fireEvent.click(screen.getByText('Close Modal'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});
