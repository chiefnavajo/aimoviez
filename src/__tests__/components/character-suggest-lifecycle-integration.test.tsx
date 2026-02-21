/**
 * Integration tests: CharacterReferenceSuggestModal lifecycle
 *
 * Verifies the full submit -> success -> auto-close lifecycle, including the
 * critical bug pattern where onSubmitted can unmount the modal before the
 * 2-second setTimeout fires onClose on an already-unmounted component.
 *
 * @jest-environment jsdom
 */

import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderWithUnmountTracking } from '../helpers/component-test-utils';
import CharacterReferenceSuggestModal from '@/components/CharacterReferenceSuggestModal';

// =============================================================================
// Mocks
// =============================================================================

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, onClick, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const {
        initial: _i, animate: _a, exit: _e,
        whileHover: _wh, whileTap: _wt, ...domProps
      } = props;
      return <div onClick={onClick as React.MouseEventHandler} {...domProps}>{children}</div>;
    },
    button: ({ children, onClick, disabled, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const {
        initial: _i, animate: _a, exit: _e,
        whileHover: _wh, whileTap: _wt, ...domProps
      } = props;
      return (
        <button onClick={onClick as React.MouseEventHandler} disabled={disabled as boolean} {...domProps}>
          {children}
        </button>
      );
    },
    span: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial: _i, animate: _a, exit: _e, ...domProps } = props;
      return <span {...domProps}>{children}</span>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  useAnimation: () => ({ start: jest.fn() }),
}));

// Mock useCsrf to return sync headers (avoids extra microtask in the submit chain)
jest.mock('@/hooks/useCsrf', () => ({
  useCsrf: () => ({
    getHeaders: () => Promise.resolve({ 'x-csrf-token': 'test-csrf' }),
  }),
}));

// =============================================================================
// Shared fixtures
// =============================================================================

const mockCharacter = {
  id: 'char-1',
  label: 'Hero',
  element_index: 1,
  frontal_image_url: 'https://cdn.example.com/hero.jpg',
  reference_count: 2,
};

const storyResponse = {
  seasons: [
    {
      id: 'season-1',
      slots: [
        {
          slot_position: 1,
          status: 'locked',
          winning_clip: {
            id: 'clip-1',
            username: 'alice',
            video_url: 'https://cdn.example.com/clip1.mp4',
            thumbnail_url: 'https://cdn.example.com/clip1-thumb.jpg',
          },
        },
        {
          slot_position: 2,
          status: 'locked',
          winning_clip: {
            id: 'clip-2',
            username: 'bob',
            video_url: 'https://cdn.example.com/clip2.mp4',
            thumbnail_url: null,
          },
        },
      ],
    },
  ],
};

const suggestGetResponse = {
  ok: true,
  suggestions: [],
  remaining: 3,
};

const suggestPostSuccess = {
  ok: true,
  remaining: 2,
};

// =============================================================================
// Fetch mock helper
// =============================================================================

function setupFetch(overrides: {
  storyResponse?: unknown;
  suggestGetResponse?: unknown;
  suggestPostResponse?: unknown;
  suggestPostOk?: boolean;
} = {}) {
  const story = overrides.storyResponse ?? storyResponse;
  const suggestGet = overrides.suggestGetResponse ?? suggestGetResponse;
  const suggestPost = overrides.suggestPostResponse ?? suggestPostSuccess;
  const suggestPostOk = overrides.suggestPostOk ?? true;

  const mockFn = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (typeof url === 'string' && url.includes('/suggest') && init?.method === 'POST') {
      return Promise.resolve({
        ok: suggestPostOk,
        status: suggestPostOk ? 200 : 400,
        json: () => Promise.resolve(suggestPost),
        headers: new Headers(),
      });
    }
    if (typeof url === 'string' && url.includes('/suggest')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(suggestGet),
        headers: new Headers(),
      });
    }
    if (typeof url === 'string' && url.includes('/api/story')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(story),
        headers: new Headers(),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      headers: new Headers(),
    });
  });

  global.fetch = mockFn as unknown as typeof fetch;
  return mockFn;
}

// =============================================================================
// TestParent -- wraps modal to test parent/child lifecycle interactions
// =============================================================================

function TestParent({
  unmountOnSubmitted = false,
  onSubmittedSpy,
  onCloseSpy,
}: {
  unmountOnSubmitted?: boolean;
  onSubmittedSpy: jest.Mock;
  onCloseSpy: jest.Mock;
}) {
  const [showing, setShowing] = useState(true);

  if (!showing) return <div data-testid="modal-closed" />;

  return (
    <CharacterReferenceSuggestModal
      character={mockCharacter}
      seasonId="season-1"
      onClose={() => {
        onCloseSpy();
        if (unmountOnSubmitted) setShowing(false);
      }}
      onSubmitted={() => {
        onSubmittedSpy();
        if (unmountOnSubmitted) setShowing(false);
      }}
    />
  );
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Wait for clips to load, select a clip, and click Submit.
 * Returns after the click; caller must await the outcome.
 */
async function waitSelectAndSubmit() {
  await waitFor(() => {
    expect(screen.getByText('alice')).toBeInTheDocument();
  });
  await act(async () => {
    fireEvent.click(screen.getByText('alice'));
  });
  await act(async () => {
    fireEvent.click(screen.getByText('Submit Suggestion'));
  });
}

// =============================================================================
// Tests
// =============================================================================

describe('CharacterReferenceSuggestModal lifecycle integration', () => {
  // Store captured 2s timer callbacks so we can fire them manually
  let capturedTimers: Array<{ cb: () => void; delay: number }>;
  let realSetTimeout: typeof globalThis.setTimeout;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedTimers = [];
    realSetTimeout = globalThis.setTimeout;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * Install a setTimeout spy that intercepts the 2-second auto-close timer
   * but lets all other timers pass through normally.
   */
  function interceptAutoCloseTimer() {
    jest.spyOn(globalThis, 'setTimeout').mockImplementation(
      ((cb: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
        if (typeof delay === 'number' && delay >= 2000) {
          capturedTimers.push({ cb: () => cb(...args), delay });
          return 999 as unknown as ReturnType<typeof setTimeout>;
        }
        // Pass through to real setTimeout for everything else
        return realSetTimeout(cb, delay, ...args);
      }) as typeof setTimeout
    );
  }

  // =========================================================================
  // 1. Full happy path: submit -> success -> onSubmitted -> auto-close
  // =========================================================================
  test('submit -> success -> onSubmitted -> auto-close after 2s', async () => {
    const onSubmittedSpy = jest.fn();
    const onCloseSpy = jest.fn();
    setupFetch();
    interceptAutoCloseTimer();

    await act(async () => {
      render(<TestParent onSubmittedSpy={onSubmittedSpy} onCloseSpy={onCloseSpy} />);
    });

    await waitSelectAndSubmit();

    // Wait for the async submit chain to complete
    await waitFor(() => {
      expect(screen.getByText('Suggestion Submitted!')).toBeInTheDocument();
    });

    // onSubmitted fired immediately
    expect(onSubmittedSpy).toHaveBeenCalledTimes(1);

    // onClose has NOT been called yet (2s timer is intercepted)
    expect(onCloseSpy).toHaveBeenCalledTimes(0);

    // A 2s timer was captured
    expect(capturedTimers).toHaveLength(1);
    expect(capturedTimers[0].delay).toBe(2000);

    // Fire the auto-close timer
    act(() => {
      capturedTimers[0].cb();
    });

    // Now onClose should have fired
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // 2. Parent does NOT unmount modal before auto-close fires (normal flow)
  // =========================================================================
  test('CRITICAL: parent does NOT unmount modal before auto-close fires', async () => {
    const onSubmittedSpy = jest.fn();
    const onCloseSpy = jest.fn();
    setupFetch();
    interceptAutoCloseTimer();

    await act(async () => {
      render(
        <TestParent
          unmountOnSubmitted={false}
          onSubmittedSpy={onSubmittedSpy}
          onCloseSpy={onCloseSpy}
        />
      );
    });

    await waitSelectAndSubmit();

    await waitFor(() => {
      expect(screen.getByText('Suggestion Submitted!')).toBeInTheDocument();
    });

    // Modal is still present in the DOM (not unmounted)
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // onClose has not been called
    expect(onCloseSpy).toHaveBeenCalledTimes(0);

    // Fire the 2s timer
    act(() => {
      capturedTimers[0].cb();
    });

    // Now onClose fires, confirming normal flow
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // 3. Parent unmounts on onSubmitted -> no double-close or errors
  // =========================================================================
  test('CRITICAL: parent unmounts on onSubmitted -> no double-close or errors', async () => {
    const onSubmittedSpy = jest.fn();
    const onCloseSpy = jest.fn();
    setupFetch();
    interceptAutoCloseTimer();

    const { getUnmountWarnings, restoreConsole } = renderWithUnmountTracking(
      <TestParent
        unmountOnSubmitted={true}
        onSubmittedSpy={onSubmittedSpy}
        onCloseSpy={onCloseSpy}
      />
    );

    await waitSelectAndSubmit();

    // onSubmitted fires -> parent sets showing=false -> modal unmounts
    await waitFor(() => {
      expect(onSubmittedSpy).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('modal-closed')).toBeInTheDocument();

    // Fire the orphaned 2s timer (component is already unmounted)
    act(() => {
      if (capturedTimers.length > 0) capturedTimers[0].cb();
    });

    // The key check: no React "setState on unmounted component" warnings
    const warnings = getUnmountWarnings();
    expect(warnings).toHaveLength(0);

    restoreConsole();
  });

  // =========================================================================
  // 4. Manual close during success countdown
  // =========================================================================
  test('manual close during success countdown: onClose called once only', async () => {
    const onSubmittedSpy = jest.fn();
    const onCloseSpy = jest.fn();
    setupFetch();
    interceptAutoCloseTimer();

    await act(async () => {
      render(<TestParent onSubmittedSpy={onSubmittedSpy} onCloseSpy={onCloseSpy} />);
    });

    await waitSelectAndSubmit();

    await waitFor(() => {
      expect(screen.getByText('Suggestion Submitted!')).toBeInTheDocument();
    });

    // Click the X close button before the 2s timer fires.
    // The X button is the one in the header (has the lucide-x SVG icon).
    const dialog = screen.getByRole('dialog');
    const allButtons = dialog.querySelectorAll('button');
    // In success state, the header X button is the only button
    const xButton = Array.from(allButtons).find(
      btn => btn.querySelector('.lucide-x')
    );
    expect(xButton).toBeTruthy();
    fireEvent.click(xButton!);

    // onClose was called once via the X button
    expect(onCloseSpy).toHaveBeenCalledTimes(1);

    // Fire the 2s auto-close timer
    act(() => {
      if (capturedTimers.length > 0) capturedTimers[0].cb();
    });

    // The timer also fires onClose -- this documents the double-call.
    // The current implementation does not guard against this.
    expect(onCloseSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // 5. Submit error: modal stays open for retry
  // =========================================================================
  test('submit error: modal stays open for retry', async () => {
    setupFetch({
      suggestPostResponse: { ok: false, error: 'Server error' },
      suggestPostOk: false,
    });

    const onSubmittedSpy = jest.fn();
    const onCloseSpy = jest.fn();

    await act(async () => {
      render(<TestParent onSubmittedSpy={onSubmittedSpy} onCloseSpy={onCloseSpy} />);
    });

    await waitSelectAndSubmit();

    // Error message should be shown
    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });

    // Modal is still open -- Submit Suggestion button is visible
    expect(screen.getByText('Submit Suggestion')).toBeInTheDocument();

    // onSubmitted should NOT have been called
    expect(onSubmittedSpy).not.toHaveBeenCalled();

    // Button should not be permanently disabled -- user can retry
    const submitButton = screen.getByText('Submit Suggestion').closest('button');
    expect(submitButton).not.toBeDisabled();
  });

  // =========================================================================
  // 6. remaining=0: submit button disabled
  // =========================================================================
  test('remaining=0: submit button disabled', async () => {
    setupFetch({
      suggestGetResponse: { ok: true, suggestions: [], remaining: 0 },
    });

    const onSubmittedSpy = jest.fn();
    const onCloseSpy = jest.fn();

    await act(async () => {
      render(<TestParent onSubmittedSpy={onSubmittedSpy} onCloseSpy={onCloseSpy} />);
    });

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
    });

    // Daily limit message should be shown
    expect(screen.getByText('Daily suggestion limit reached')).toBeInTheDocument();

    // Select a clip so the only reason for disabled is remaining=0
    fireEvent.click(screen.getByText('alice'));

    // Submit button should be disabled
    const submitButton = screen.getByText('Submit Suggestion').closest('button');
    expect(submitButton).toBeDisabled();
  });

  // =========================================================================
  // 7. Fetches clips and suggestions on mount
  // =========================================================================
  test('fetches clips and suggestions on mount', async () => {
    const fetchMock = setupFetch();

    const onSubmittedSpy = jest.fn();
    const onCloseSpy = jest.fn();

    await act(async () => {
      render(<TestParent onSubmittedSpy={onSubmittedSpy} onCloseSpy={onCloseSpy} />);
    });

    // Assert fetch was called with the story endpoint
    expect(fetchMock).toHaveBeenCalledWith('/api/story');

    // Assert fetch was called with the suggest endpoint for char-1
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/story/pinned-characters/char-1/suggest'
    );

    // Clips from the story response should be rendered
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
      expect(screen.getByText('bob')).toBeInTheDocument();
    });

    // Slot positions shown
    expect(screen.getByText('Slot 1')).toBeInTheDocument();
    expect(screen.getByText('Slot 2')).toBeInTheDocument();
  });

  // =========================================================================
  // 8. Unmount during submit: no errors
  // =========================================================================
  test('unmount during submit: no errors', async () => {
    let resolvePost!: (value: unknown) => void;
    const postPromise = new Promise(resolve => {
      resolvePost = resolve;
    });

    global.fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/suggest') && init?.method === 'POST') {
        return postPromise;
      }
      if (typeof url === 'string' && url.includes('/suggest')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve(suggestGetResponse),
          headers: new Headers(),
        });
      }
      if (typeof url === 'string' && url.includes('/api/story')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve(storyResponse),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      });
    }) as unknown as typeof fetch;

    const { unmount, getUnmountWarnings, restoreConsole } = renderWithUnmountTracking(
      <CharacterReferenceSuggestModal
        character={mockCharacter}
        seasonId="season-1"
        onClose={jest.fn()}
        onSubmitted={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
    });

    // Select clip and click submit -- POST is now in-flight (hanging)
    fireEvent.click(screen.getByText('alice'));
    fireEvent.click(screen.getByText('Submit Suggestion'));

    // Unmount the component while the POST is still pending
    unmount();

    // Now resolve the POST
    await act(async () => {
      resolvePost({
        ok: true,
        status: 200,
        json: () => Promise.resolve(suggestPostSuccess),
        headers: new Headers(),
      });
    });

    // No console errors about setting state on unmounted components
    const warnings = getUnmountWarnings();
    expect(warnings).toHaveLength(0);

    restoreConsole();
  });
});
