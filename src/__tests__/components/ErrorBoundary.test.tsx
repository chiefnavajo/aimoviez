// Tests for ErrorBoundary component
// Class-based error boundary that catches render errors and shows fallback UI

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary, InlineError } from '@/components/ErrorBoundary';

// Suppress console.error for expected error throws during tests
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    if (
      msg.includes('ErrorBoundary caught') ||
      msg.includes('The above error occurred') ||
      msg.includes('Error: Uncaught')
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});
afterAll(() => {
  console.error = originalError;
});

// A component that always throws
function ThrowingComponent({ message = 'Test error' }: { message?: string }) {
  throw new Error(message);
}

// A component that renders normally
function GoodComponent() {
  return <div>Working correctly</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <GoodComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText('Working correctly')).toBeInTheDocument();
  });

  it('catches errors and shows default fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText('Oops! Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText(/Don't worry, this happens sometimes/i)
    ).toBeInTheDocument();
  });

  it('shows custom fallback when provided', () => {
    const customFallback = <div>Custom error page</div>;

    render(
      <ErrorBoundary fallback={customFallback}>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom error page')).toBeInTheDocument();
    expect(screen.queryByText('Oops! Something went wrong')).not.toBeInTheDocument();
  });

  it('calls onError callback when error occurs', () => {
    const onError = jest.fn();

    render(
      <ErrorBoundary onError={onError}>
        <ThrowingComponent message="Custom crash" />
      </ErrorBoundary>
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Custom crash' }),
      expect.objectContaining({ componentStack: expect.any(String) })
    );
  });

  it('renders Try Again button in the error UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText('Oops! Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();

    // Try Again should be a clickable button
    const tryAgainButton = screen.getByText('Try Again');
    expect(tryAgainButton.tagName).toBe('BUTTON');
  });

  it('renders Reload App and Go Home action buttons', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText('Reload App')).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
    expect(screen.getByText('Go Home')).toBeInTheDocument();
  });

  it('shows contact support message', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(
      screen.getByText('If this issue persists, please contact support')
    ).toBeInTheDocument();
  });
});

describe('InlineError', () => {
  it('renders the error message', () => {
    render(<InlineError message="Something went wrong" />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders retry button when onRetry is provided', () => {
    const onRetry = jest.fn();
    render(<InlineError message="Error" onRetry={onRetry} />);

    const retryButton = screen.getByText('Try again');
    expect(retryButton).toBeInTheDocument();

    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render retry button when onRetry is not provided', () => {
    render(<InlineError message="Error" />);

    expect(screen.queryByText('Try again')).not.toBeInTheDocument();
  });
});
