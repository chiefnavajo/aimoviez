/**
 * Integration test: CreditPurchaseModal lifecycle.
 *
 * Tests the parent-controlled open/close lifecycle of CreditPurchaseModal,
 * including fetch races, Stripe redirect, error recovery, and rapid toggling.
 * Uses a TestParent wrapper to simulate real usage from a parent component.
 *
 * @jest-environment jsdom
 */

import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderWithUnmountTracking } from '../helpers/component-test-utils';
import CreditPurchaseModal from '@/components/CreditPurchaseModal';

// =============================================================================
// Mocks
// =============================================================================

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const {
        initial: _i,
        animate: _a,
        exit: _e,
        whileHover: _wh,
        whileTap: _wt,
        transition: _t,
        ...domProps
      } = props;
      return <div {...domProps}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

jest.mock('lucide-react', () => ({
  X: ({ className }: { className?: string }) => <span className={className}>X</span>,
  Coins: ({ className }: { className?: string }) => <span className={className}>Coins</span>,
  Sparkles: ({ className }: { className?: string }) => <span className={className}>Sparkles</span>,
  Loader2: ({ className }: { className?: string }) => (
    <span className={className} data-testid="loader-spinner">Loading...</span>
  ),
  Zap: ({ className }: { className?: string }) => <span className={className}>Zap</span>,
  Crown: ({ className }: { className?: string }) => <span className={className}>Crown</span>,
}));

const mockCsrfPost = jest.fn();
const mockEnsureToken = jest.fn().mockResolvedValue(undefined);
jest.mock('@/hooks/useCsrf', () => ({
  useCsrf: () => ({
    post: mockCsrfPost,
    ensureToken: mockEnsureToken,
  }),
}));

// =============================================================================
// Test data
// =============================================================================

const MOCK_PACKAGES = [
  {
    id: 'pkg-try',
    name: 'Try It',
    credits: 7,
    total_credits: 7,
    price_cents: 99,
    price_per_credit_cents: 14,
  },
  {
    id: 'pkg-starter',
    name: 'Starter',
    credits: 25,
    total_credits: 25,
    price_cents: 299,
    price_per_credit_cents: 12,
  },
  {
    id: 'pkg-popular',
    name: 'Popular',
    credits: 55,
    total_credits: 55,
    price_cents: 599,
    price_per_credit_cents: 11,
  },
];

const MOCK_MODEL_PRICING = [
  { model_key: 'kling-2.6', display_name: 'Kling 2.6', credit_cost: 7 },
];

function makePackagesResponse() {
  return {
    ok: true,
    json: () => Promise.resolve({ packages: MOCK_PACKAGES, model_pricing: MOCK_MODEL_PRICING }),
  };
}

// =============================================================================
// TestParent wrapper
// =============================================================================

function TestParent({ initialOpen = false }: { initialOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [balance, setBalance] = useState(50);
  return (
    <>
      <button data-testid="open-btn" onClick={() => setIsOpen(true)}>Open</button>
      <button data-testid="close-btn" onClick={() => setIsOpen(false)}>Close</button>
      <button data-testid="set-balance" onClick={() => setBalance(100)}>Set Balance</button>
      <CreditPurchaseModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        currentBalance={balance}
      />
    </>
  );
}

// =============================================================================
// Setup / Teardown
// =============================================================================

const originalLocation = window.location;

beforeEach(() => {
  jest.clearAllMocks();
  // Make window.location.href writable for Stripe redirect test
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...originalLocation, href: '' },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(window, 'location', {
    writable: true,
    value: originalLocation,
  });
});

// =============================================================================
// Tests
// =============================================================================

describe('CreditPurchaseModal lifecycle integration', () => {
  // --------------------------------------------------------------------------
  // 1. open -> fetch -> close before fetch completes: no unmount warning
  // --------------------------------------------------------------------------
  test('open -> fetch -> close before fetch completes: no unmount warning', async () => {
    // Create a fetch that we can resolve manually
    let resolveFetch!: (value: unknown) => void;
    const pendingFetch = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    global.fetch = jest.fn().mockReturnValue(pendingFetch);

    const { getUnmountWarnings, restoreConsole } = renderWithUnmountTracking(
      <TestParent />
    );

    // Open the modal
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn'));
    });

    // Modal is open, showing loading spinner
    expect(screen.getByText('Get Credits')).toBeInTheDocument();

    // Close the modal before fetch resolves
    await act(async () => {
      fireEvent.click(screen.getByTestId('close-btn'));
    });

    // Now resolve the fetch after modal is closed
    await act(async () => {
      resolveFetch(makePackagesResponse());
      // Give microtasks time to flush
      await new Promise((r) => setTimeout(r, 50));
    });

    // No unmount warnings should have been logged
    expect(getUnmountWarnings()).toHaveLength(0);

    restoreConsole();
  });

  // --------------------------------------------------------------------------
  // 2. open -> close -> re-open: packages fetched fresh
  // --------------------------------------------------------------------------
  test('open -> close -> re-open: packages fetched fresh', async () => {
    global.fetch = jest.fn().mockResolvedValue(makePackagesResponse());

    render(<TestParent />);

    // Open modal
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn'));
    });

    // Wait for packages to load
    await waitFor(() => {
      expect(screen.getByText('Try It')).toBeInTheDocument();
    });

    // Close modal
    await act(async () => {
      fireEvent.click(screen.getByTestId('close-btn'));
    });

    // Modal content should be gone
    expect(screen.queryByText('Get Credits')).not.toBeInTheDocument();

    // Re-open modal
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn'));
    });

    // Fetch should have been called at least twice (once per open)
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Wait for packages to load again
    await waitFor(() => {
      expect(screen.getByText('Try It')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // 3. purchase click -> Stripe redirect
  // --------------------------------------------------------------------------
  test('purchase click -> Stripe redirect', async () => {
    global.fetch = jest.fn().mockResolvedValue(makePackagesResponse());
    mockCsrfPost.mockResolvedValue({
      success: true,
      checkoutUrl: 'https://checkout.stripe.com/test-session-123',
    });

    render(<TestParent />);

    // Open modal
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn'));
    });

    // Wait for packages to load
    await waitFor(() => {
      expect(screen.getByText('Try It')).toBeInTheDocument();
    });

    // Click the first package
    await act(async () => {
      fireEvent.click(screen.getByText('Try It').closest('button')!);
    });

    // Assert ensureToken was called
    expect(mockEnsureToken).toHaveBeenCalled();

    // Assert csrfPost was called with correct args
    expect(mockCsrfPost).toHaveBeenCalledWith('/api/credits/purchase', {
      packageId: 'pkg-try',
    });

    // Assert redirect happened
    expect(window.location.href).toBe('https://checkout.stripe.com/test-session-123');
  });

  // --------------------------------------------------------------------------
  // 4. purchase click -> error: error displayed, loading cleared
  // --------------------------------------------------------------------------
  test('purchase click -> error: error displayed, loading cleared', async () => {
    global.fetch = jest.fn().mockResolvedValue(makePackagesResponse());
    mockCsrfPost.mockRejectedValue(new Error('Stripe session creation failed'));

    render(<TestParent />);

    // Open modal
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn'));
    });

    // Wait for packages to load
    await waitFor(() => {
      expect(screen.getByText('Try It')).toBeInTheDocument();
    });

    // Click a package
    await act(async () => {
      fireEvent.click(screen.getByText('Starter').closest('button')!);
    });

    // Error message should appear
    await waitFor(() => {
      expect(screen.getByText('Stripe session creation failed')).toBeInTheDocument();
    });

    // No loader spinner should be showing on any package button
    // (purchaseLoading should have been cleared to null)
    const spinners = screen.queryAllByTestId('loader-spinner');
    // Spinners within package buttons should be gone.
    // The only possible spinner is the global loading one, which is not present
    // because packages are already loaded. Filter to check none are inside buttons.
    const spinnersInButtons = spinners.filter(
      (spinner) => spinner.closest('button[class*="rounded-xl"]') !== null
    );
    expect(spinnersInButtons).toHaveLength(0);

    // Buttons should be re-enabled (purchaseLoading is null)
    const packageButtons = screen.getAllByRole('button').filter(
      (btn) => btn.classList.contains('rounded-xl') && btn.textContent?.includes('credits')
    );
    packageButtons.forEach((btn) => {
      expect(btn).not.toBeDisabled();
    });
  });

  // --------------------------------------------------------------------------
  // 5. rapid open/close/open: no race condition
  // --------------------------------------------------------------------------
  test('rapid open/close/open: no race condition', async () => {
    let fetchCallCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      fetchCallCount++;
      return Promise.resolve(makePackagesResponse());
    });

    render(<TestParent />);

    // Rapidly: open -> close -> open
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('close-btn'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn'));
    });

    // Wait for final state to stabilize
    await waitFor(() => {
      expect(screen.getByText('Get Credits')).toBeInTheDocument();
    });

    // Packages should eventually load correctly
    await waitFor(() => {
      expect(screen.getByText('Try It')).toBeInTheDocument();
      expect(screen.getByText('Starter')).toBeInTheDocument();
      expect(screen.getByText('Popular')).toBeInTheDocument();
    });

    // Fetch was called at least twice (first open + second open)
    expect(fetchCallCount).toBeGreaterThanOrEqual(2);

    // No error should be shown
    expect(screen.queryByText('Failed to load packages')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // 6. parent changes balance prop while open
  // --------------------------------------------------------------------------
  test('parent changes balance prop while open', async () => {
    global.fetch = jest.fn().mockResolvedValue(makePackagesResponse());

    render(<TestParent />);

    // Open modal
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn'));
    });

    // Wait for packages to load
    await waitFor(() => {
      expect(screen.getByText('Try It')).toBeInTheDocument();
    });

    // Balance should show 50
    expect(screen.getByText('50')).toBeInTheDocument();

    // Parent updates balance to 100
    await act(async () => {
      fireEvent.click(screen.getByTestId('set-balance'));
    });

    // Balance should now show 100
    expect(screen.getByText('100')).toBeInTheDocument();
    // 50 should no longer be displayed
    expect(screen.queryByText('50')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // 7. network error on fetch -> shows error -> retry on re-open
  // --------------------------------------------------------------------------
  test('network error on fetch -> shows error -> retry on re-open', async () => {
    // First call: network error
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network error'));

    render(<TestParent />);

    // Open modal
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn'));
    });

    // Error should be shown
    await waitFor(() => {
      expect(screen.getByText('Failed to load packages')).toBeInTheDocument();
    });

    // No packages should be visible
    expect(screen.queryByText('Try It')).not.toBeInTheDocument();

    // Close modal
    await act(async () => {
      fireEvent.click(screen.getByTestId('close-btn'));
    });

    // Mock fetch to succeed on next call
    (global.fetch as jest.Mock).mockResolvedValue(makePackagesResponse());

    // Re-open modal
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn'));
    });

    // Packages should load successfully this time
    await waitFor(() => {
      expect(screen.getByText('Try It')).toBeInTheDocument();
      expect(screen.getByText('Starter')).toBeInTheDocument();
    });

    // Error should be cleared
    expect(screen.queryByText('Failed to load packages')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // 8. backdrop click triggers full close chain
  // --------------------------------------------------------------------------
  test('backdrop click triggers full close chain', async () => {
    global.fetch = jest.fn().mockResolvedValue(makePackagesResponse());

    render(<TestParent />);

    // Open modal
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn'));
    });

    // Wait for modal to fully render with packages
    await waitFor(() => {
      expect(screen.getByText('Get Credits')).toBeInTheDocument();
    });

    // Find the backdrop element (div with bg-black/70 class)
    const backdrop = document.querySelector('.bg-black\\/70');
    expect(backdrop).toBeTruthy();

    // Click the backdrop
    await act(async () => {
      fireEvent.click(backdrop!);
    });

    // Modal should be fully removed from the DOM (AnimatePresence removes children)
    expect(screen.queryByText('Get Credits')).not.toBeInTheDocument();
    expect(screen.queryByText('Try It')).not.toBeInTheDocument();
  });
});
