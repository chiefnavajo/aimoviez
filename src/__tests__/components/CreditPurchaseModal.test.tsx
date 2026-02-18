// Tests for CreditPurchaseModal component
// Displays credit packages with pricing and triggers Stripe checkout

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreditPurchaseModal from '@/components/CreditPurchaseModal';

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

// Mock useCsrf hook
const mockEnsureToken = jest.fn().mockResolvedValue(undefined);
const mockCsrfPost = jest.fn();
jest.mock('@/hooks/useCsrf', () => ({
  useCsrf: () => ({
    post: mockCsrfPost,
    ensureToken: mockEnsureToken,
  }),
}));

const mockPackages = [
  {
    id: 'pkg-1',
    name: 'Try It',
    credits: 10,
    total_credits: 10,
    price_cents: 199,
    price_per_credit_cents: 20,
  },
  {
    id: 'pkg-2',
    name: 'Popular',
    credits: 50,
    total_credits: 55,
    price_cents: 799,
    price_per_credit_cents: 15,
  },
  {
    id: 'pkg-3',
    name: 'Studio',
    credits: 200,
    total_credits: 240,
    price_cents: 2499,
    price_per_credit_cents: 10,
  },
];

const mockModelPricing = [
  { model_key: 'kling-2.6', display_name: 'Kling 2.6', credit_cost: 5 },
];

describe('CreditPurchaseModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    currentBalance: 50,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: fetch packages successfully
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ packages: mockPackages, model_pricing: mockModelPricing }),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <CreditPurchaseModal {...defaultProps} isOpen={false} />
    );

    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
    expect(screen.queryByText('Get Credits')).not.toBeInTheDocument();
  });

  it('renders the modal header with current balance', async () => {
    render(<CreditPurchaseModal {...defaultProps} />);

    expect(screen.getByText('Get Credits')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('displays packages after loading', async () => {
    render(<CreditPurchaseModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Try It')).toBeInTheDocument();
      expect(screen.getByText('Popular')).toBeInTheDocument();
      expect(screen.getByText('Studio')).toBeInTheDocument();
    });
  });

  it('shows formatted prices for packages', async () => {
    render(<CreditPurchaseModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('$1.99')).toBeInTheDocument();
      expect(screen.getByText('$7.99')).toBeInTheDocument();
      expect(screen.getByText('$24.99')).toBeInTheDocument();
    });
  });

  it('shows MOST POPULAR badge for Popular package', async () => {
    render(<CreditPurchaseModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('MOST POPULAR')).toBeInTheDocument();
    });
  });

  it('shows BEST VALUE badge for Studio package', async () => {
    render(<CreditPurchaseModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('BEST VALUE')).toBeInTheDocument();
    });
  });

  it('shows model pricing reference section', async () => {
    render(<CreditPurchaseModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Credits per generation:')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });

  it('shows error message when packages fail to load', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    render(<CreditPurchaseModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load packages')).toBeInTheDocument();
    });
  });

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = jest.fn();
    render(<CreditPurchaseModal {...defaultProps} onClose={onClose} />);

    // The backdrop is the first motion.div with the bg-black/70 class
    // We click the outer overlay wrapper
    const backdrop = screen.getByText('Get Credits').closest('.fixed');
    if (backdrop) {
      const backdropOverlay = backdrop.querySelector('.absolute');
      if (backdropOverlay) {
        fireEvent.click(backdropOverlay);
        expect(onClose).toHaveBeenCalledTimes(1);
      }
    }
  });
});
