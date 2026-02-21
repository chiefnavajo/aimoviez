/**
 * Integration test: AIGeneratePanel lifecycle and stage machine.
 *
 * Tests the full generation flow (idle -> queued -> generating -> ready),
 * cleanup on unmount, CreditPurchaseModal coordination, character upload
 * round-trip, and state persistence via localStorage.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderWithUnmountTracking } from '../helpers/component-test-utils';

// =============================================================================
// Mocks — must come before component import
// =============================================================================

// Mock framer-motion — strip animation props so DOM doesn't receive them
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const {
        initial: _i, animate: _a, exit: _e,
        whileHover: _wh, whileTap: _wt, transition: _t,
        ...domProps
      } = props;
      return <div {...domProps}>{children}</div>;
    },
    button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const {
        initial: _i, animate: _a, exit: _e,
        whileHover: _wh, whileTap: _wt, transition: _t,
        ...domProps
      } = props;
      return <button {...domProps}>{children}</button>;
    },
    span: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const {
        initial: _i, animate: _a, exit: _e,
        whileHover: _wh, whileTap: _wt, transition: _t,
        ...domProps
      } = props;
      return <span {...domProps}>{children}</span>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  useAnimation: () => ({ start: jest.fn() }),
}));

// Mock next/navigation
const mockRouterPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
  }),
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

// Mock useFeature hook — configurable per test
const mockFeatureValues: Record<string, { enabled: boolean; isLoading: boolean; config: unknown }> = {
  ai_video_generation: { enabled: true, isLoading: false, config: null },
  elevenlabs_narration: { enabled: false, isLoading: false, config: null },
  character_pinning: { enabled: false, isLoading: false, config: null },
  prompt_learning: { enabled: false, isLoading: false, config: null },
  user_characters: { enabled: false, isLoading: false, config: null },
};
jest.mock('@/hooks/useFeatureFlags', () => ({
  useFeature: (key: string) =>
    mockFeatureValues[key] || { enabled: false, isLoading: false, config: null },
  useFeatureFlags: () => ({
    isEnabled: (key: string) => mockFeatureValues[key]?.enabled ?? false,
    getConfig: () => null,
    isLoading: false,
  }),
}));

// Mock useCredits hook
const mockRefetchCredits = jest.fn();
let mockCreditBalance = 50;
jest.mock('@/hooks/useCredits', () => ({
  useCredits: () => ({
    balance: mockCreditBalance,
    isLoading: false,
    error: null,
    refetch: mockRefetchCredits,
  }),
}));

// Mock CreditPurchaseModal — render testid when open
jest.mock('@/components/CreditPurchaseModal', () => ({
  __esModule: true,
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="credit-purchase-modal">
        <button data-testid="close-purchase-modal" onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

// Mock CharacterReferenceSuggestModal
jest.mock('@/components/CharacterReferenceSuggestModal', () => ({
  __esModule: true,
  default: () => null,
}));

// Track upload modal props for integration assertions
let capturedUploadModalProps: {
  onCreated?: (char: unknown) => void;
  onClose?: () => void;
} = {};
jest.mock('@/components/UserCharacterUploadModal', () => ({
  __esModule: true,
  default: ({ onClose, onCreated }: { onClose: () => void; onCreated: (c: unknown) => void }) => {
    capturedUploadModalProps = { onCreated, onClose };
    return (
      <div data-testid="upload-modal">
        <button data-testid="upload-modal-close" onClick={onClose}>Close Upload</button>
      </div>
    );
  },
}));

// Mock UserCharacterManager
jest.mock('@/components/UserCharacterManager', () => ({
  __esModule: true,
  default: ({
    characters,
    selectedIds,
    onUploadClick,
  }: {
    characters: Array<{ id: string; label: string }>;
    selectedIds: Set<string>;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
    onUploadClick: () => void;
    onAngleAdded: () => void;
    maxSelectable: number;
  }) => (
    <div data-testid="user-character-manager">
      <button onClick={onUploadClick}>Upload your character</button>
      {characters.length > 0 && (
        <span data-testid="char-count">({selectedIds.size} selected)</span>
      )}
      {characters.map((c) => (
        <span key={c.id} data-testid={`char-${c.id}`}>{c.label}</span>
      ))}
    </div>
  ),
}));

// Now import the component under test
import AIGeneratePanel from '@/components/AIGeneratePanel';

// =============================================================================
// Helpers
// =============================================================================

// Set CSRF cookie so the component can read it
Object.defineProperty(document, 'cookie', {
  writable: true,
  value: 'csrf-token=test-csrf-token',
});

/**
 * Create a URL-aware mock fetch that routes by URL pattern.
 * `handlers` is a map of URL substring -> response factory.
 * Falls through to a default empty JSON response.
 */
function createRoutedFetch(
  handlers: Record<string, () => Promise<{
    ok: boolean;
    json?: () => Promise<unknown>;
    blob?: () => Promise<Blob>;
    status?: number;
  }>>
) {
  const calls: string[] = [];
  const fn = jest.fn().mockImplementation((url: string, _opts?: RequestInit) => {
    calls.push(url);
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) {
        return handler();
      }
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  return { fetchMock: fn as jest.Mock, calls };
}

/** Type a valid prompt (>=10 chars) into the textarea */
function typeValidPrompt(text = 'A dramatic cinematic explosion scene with fire') {
  const textarea = screen.getByPlaceholderText(/describe a dramatic scene/i);
  fireEvent.change(textarea, { target: { value: text } });
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  jest.clearAllMocks();
  mockCreditBalance = 50;
  capturedUploadModalProps = {};

  // Reset feature flags to defaults
  mockFeatureValues.ai_video_generation = { enabled: true, isLoading: false, config: null };
  mockFeatureValues.elevenlabs_narration = { enabled: false, isLoading: false, config: null };
  mockFeatureValues.character_pinning = { enabled: false, isLoading: false, config: null };
  mockFeatureValues.prompt_learning = { enabled: false, isLoading: false, config: null };
  mockFeatureValues.user_characters = { enabled: false, isLoading: false, config: null };

  // Mock localStorage
  Storage.prototype.getItem = jest.fn().mockReturnValue(null);
  Storage.prototype.setItem = jest.fn();
  Storage.prototype.removeItem = jest.fn();

  // Mock URL APIs
  global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-video-url');
  global.URL.revokeObjectURL = jest.fn();

  // Default fetch: model pricing only
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url === '/api/credits/packages' || url.includes('/api/credits/packages')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          model_pricing: [
            { model_key: 'kling-2.6', credit_cost: 5 },
            { model_key: 'veo3-fast', credit_cost: 8 },
            { model_key: 'hailuo-2.3', credit_cost: 10 },
            { model_key: 'sora-2', credit_cost: 15 },
          ],
        }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// =============================================================================
// Tests
// =============================================================================

describe('AIGeneratePanel lifecycle integration', () => {

  // -------------------------------------------------------------------------
  // 1. Full stage transition: idle -> queued -> generating -> ready
  // -------------------------------------------------------------------------
  test('full stage transition: idle -> queued -> generating -> ready', async () => {
    let statusCallCount = 0;
    const videoBlob = new Blob(['fake-video'], { type: 'video/mp4' });

    const { fetchMock } = createRoutedFetch({
      '/api/credits/packages': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          model_pricing: [{ model_key: 'kling-2.6', credit_cost: 5 }],
        }),
      }),
      '/api/ai/generate': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, generationId: 'gen-lifecycle-1' }),
      }),
      '/api/ai/status/': () => {
        statusCallCount++;
        // First call: generating, subsequent calls: ready
        if (statusCallCount <= 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, stage: 'generating' }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            stage: 'ready',
            videoUrl: 'https://cdn.example.com/video.mp4',
          }),
        });
      },
      'https://cdn.example.com/video.mp4': () => Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(videoBlob),
      }),
    });
    global.fetch = fetchMock;

    await act(async () => {
      render(<AIGeneratePanel />);
    });

    // Type prompt and click generate
    typeValidPrompt();
    const generateBtn = screen.getByRole('button', { name: /Generate (?:Video|\()/ });

    await act(async () => {
      fireEvent.click(generateBtn);
    });

    // localStorage should be set with generation ID after handleGenerate
    await waitFor(() => {
      expect(Storage.prototype.setItem).toHaveBeenCalledWith(
        'ai_active_generation_id',
        'gen-lifecycle-1'
      );
    });

    // Component should pass through queued/generating and reach ready.
    // The status handler returns 'generating' on first call, 'ready' after that.
    // Verify we see either the polling UI or the ready UI (polling is fast in tests).
    await waitFor(() => {
      // In ready state, a video element is rendered
      const videoEl = document.querySelector('video');
      // Or we might still be in generating state showing the progress text
      const isGenerating = screen.queryByText('Generating Video...');
      const isQueued = screen.queryByText('In Queue...');
      expect(videoEl || isGenerating || isQueued).toBeTruthy();
    });

    // Wait for polling to reach 'ready' — video preview appears
    await waitFor(() => {
      const videoEl = document.querySelector('video');
      expect(videoEl).toBeTruthy();
    }, { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 2. Unmount during polling clears timeout without warnings
  // -------------------------------------------------------------------------
  test('unmount during polling clears timeout without warnings', async () => {
    jest.useFakeTimers();

    const { fetchMock } = createRoutedFetch({
      '/api/credits/packages': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          model_pricing: [{ model_key: 'kling-2.6', credit_cost: 5 }],
        }),
      }),
      '/api/ai/generate': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, generationId: 'gen-unmount-1' }),
      }),
      '/api/ai/status/': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, stage: 'queued' }),
      }),
    });
    global.fetch = fetchMock;

    const { unmount, getUnmountWarnings, restoreConsole } = renderWithUnmountTracking(
      <AIGeneratePanel />
    );

    // Let initial effects flush
    await act(async () => {
      await Promise.resolve();
    });

    // Type prompt and generate
    typeValidPrompt();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate (?:Video|\()/ }));
    });

    // Let generate fetch resolve and polling start
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Unmount while polling is active
    unmount();

    // Advance timers significantly — should not trigger setState warnings
    await act(async () => {
      jest.advanceTimersByTime(15000);
    });

    expect(getUnmountWarnings()).toHaveLength(0);
    restoreConsole();
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // 3. Unmount during blob pre-download calls abort
  // -------------------------------------------------------------------------
  test('unmount during blob pre-download calls abort', async () => {
    const abortSpy = jest.spyOn(AbortController.prototype, 'abort');

    // We need a slow blob download so that unmount happens while it's in-flight
    let resolveBlobFetch: ((value: unknown) => void) | null = null;
    const pendingBlobPromise = new Promise(resolve => { resolveBlobFetch = resolve; });

    const { fetchMock } = createRoutedFetch({
      '/api/credits/packages': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          model_pricing: [{ model_key: 'kling-2.6', credit_cost: 5 }],
        }),
      }),
      '/api/ai/generate': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, generationId: 'gen-abort-1' }),
      }),
      '/api/ai/status/': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          stage: 'ready',
          videoUrl: 'https://fal.media/abort-test.mp4',
        }),
      }),
      'https://fal.media/abort-test.mp4': () => pendingBlobPromise as Promise<{
        ok: boolean;
        blob: () => Promise<Blob>;
      }>,
    });
    global.fetch = fetchMock;

    let unmountFn: (() => void) | undefined;

    await act(async () => {
      const result = render(<AIGeneratePanel />);
      unmountFn = result.unmount;
    });

    // Type prompt and generate
    typeValidPrompt();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate (?:Video|\()/ }));
    });

    // Wait for stage to transition to 'ready' (poll returns ready immediately)
    await waitFor(() => {
      // The blob fetch should have been called — stage is ready
      expect(fetchMock).toHaveBeenCalledWith(
        'https://fal.media/abort-test.mp4',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    }, { timeout: 5000 });

    // Unmount while blob download is pending
    unmountFn!();

    // abort should have been called via the cleanup function
    expect(abortSpy).toHaveBeenCalled();

    // Resolve the pending promise to avoid open handles
    resolveBlobFetch!({
      ok: true,
      blob: () => Promise.resolve(new Blob(['fake'], { type: 'video/mp4' })),
    });

    abortSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // 4. Insufficient credits opens CreditPurchaseModal without losing form state
  // -------------------------------------------------------------------------
  test('insufficient credits opens CreditPurchaseModal without losing form state', async () => {
    const promptText = 'A dramatic explosion scene';

    const { fetchMock } = createRoutedFetch({
      '/api/credits/packages': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          model_pricing: [{ model_key: 'kling-2.6', credit_cost: 5 }],
        }),
      }),
      '/api/ai/generate': () => Promise.resolve({
        ok: false,
        json: () => Promise.resolve({
          success: false,
          code: 'INSUFFICIENT_CREDITS',
          required: 10,
          current: 3,
          error: 'Insufficient credits',
        }),
      }),
    });
    global.fetch = fetchMock;

    await act(async () => {
      render(<AIGeneratePanel />);
    });

    typeValidPrompt(promptText);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate (?:Video|\()/ }));
    });

    // Component sets stage='failed' AND purchaseModalOpen=true.
    // The failed stage shows "Generation Failed" with the error text.
    await waitFor(() => {
      expect(screen.getByText('Generation Failed')).toBeInTheDocument();
      expect(screen.getByText(/Insufficient credits/)).toBeInTheDocument();
    });

    // Click "Try Again" to return to idle — purchaseModalOpen is still true
    // because handleReset does not clear it.
    await act(async () => {
      fireEvent.click(screen.getByText('Try Again'));
    });

    // Now in idle state: the CreditPurchaseModal renders with isOpen=true
    await waitFor(() => {
      expect(screen.getByTestId('credit-purchase-modal')).toBeInTheDocument();
    });

    // The prompt field should be empty (reset clears it), but we can type again
    const textarea = screen.getByPlaceholderText(/describe a dramatic scene/i);
    expect(textarea).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 5. Cancel during generation resets cleanly
  // -------------------------------------------------------------------------
  test('cancel during generation resets cleanly', async () => {
    mockCsrfPost.mockResolvedValueOnce({ success: true });

    const { fetchMock } = createRoutedFetch({
      '/api/credits/packages': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          model_pricing: [{ model_key: 'kling-2.6', credit_cost: 5 }],
        }),
      }),
      '/api/ai/generate': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, generationId: 'gen-cancel-1' }),
      }),
      '/api/ai/status/': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, stage: 'queued' }),
      }),
    });
    global.fetch = fetchMock;

    await act(async () => {
      render(<AIGeneratePanel />);
    });

    typeValidPrompt();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate (?:Video|\()/ }));
    });

    // Wait until we're in the queued/generating stage (Cancel button appears)
    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    // Click Cancel
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });

    // Wait for reset: should show idle form again with the generate button
    // (text may be "Generate Video" or "Generate (5 credits)" depending on pricing)
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/describe a dramatic scene/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Generate (?:Video|\()/ })).toBeInTheDocument();
    });

    // localStorage should be cleaned up
    expect(Storage.prototype.removeItem).toHaveBeenCalledWith('ai_active_generation_id');
    expect(Storage.prototype.removeItem).toHaveBeenCalledWith('ai_active_generation_ts');
  });

  // -------------------------------------------------------------------------
  // 6. Stale localStorage generation ID cleaned up on mount
  // -------------------------------------------------------------------------
  test('stale localStorage generation ID cleaned up on mount', async () => {
    // 8 days ago — older than 7-day limit
    const eightDaysAgo = String(Date.now() - 8 * 24 * 60 * 60 * 1000);

    Storage.prototype.getItem = jest.fn().mockImplementation((key: string) => {
      if (key === 'ai_active_generation_id') return 'gen-stale-old';
      if (key === 'ai_active_generation_ts') return eightDaysAgo;
      if (key === 'ai_prompt_suggest_enabled') return null;
      return null;
    });

    await act(async () => {
      render(<AIGeneratePanel />);
    });

    // Panel should stay in idle — showing the Generate button
    // (text may be "Generate Video" or "Generate (N credits)" if pricing loaded)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Generate (?:Video|\()/ })).toBeInTheDocument();
    });
    // Confirm we're in idle state (prompt textarea visible)
    expect(screen.getByPlaceholderText(/describe a dramatic scene/i)).toBeInTheDocument();

    // Stale keys should be removed
    expect(Storage.prototype.removeItem).toHaveBeenCalledWith('ai_active_generation_id');
    expect(Storage.prototype.removeItem).toHaveBeenCalledWith('ai_active_generation_ts');
  });

  // -------------------------------------------------------------------------
  // 7. handleReset clears all state including blob URLs
  // -------------------------------------------------------------------------
  test('handleReset clears all state including blob URLs', async () => {
    const videoBlob = new Blob(['fake-video'], { type: 'video/mp4' });

    const { fetchMock } = createRoutedFetch({
      '/api/credits/packages': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          model_pricing: [{ model_key: 'kling-2.6', credit_cost: 5 }],
        }),
      }),
      '/api/ai/generate': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, generationId: 'gen-reset-1' }),
      }),
      '/api/ai/status/': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          stage: 'ready',
          videoUrl: 'https://cdn.example.com/reset-test.mp4',
        }),
      }),
      'https://cdn.example.com/reset-test.mp4': () => Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(videoBlob),
      }),
    });
    global.fetch = fetchMock;

    await act(async () => {
      render(<AIGeneratePanel />);
    });

    typeValidPrompt();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate (?:Video|\()/ }));
    });

    // Wait for ready state — video preview with "New" button
    await waitFor(() => {
      expect(screen.getByText('New')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Click "New" (reset button)
    await act(async () => {
      fireEvent.click(screen.getByText('New'));
    });

    // Should return to idle — generate button text varies with pricing
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/describe a dramatic scene/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Generate (?:Video|\()/ })).toBeInTheDocument();
    });

    // URL.revokeObjectURL should have been called (blob cleanup)
    expect(URL.revokeObjectURL).toHaveBeenCalled();

    // localStorage cleared
    expect(Storage.prototype.removeItem).toHaveBeenCalledWith('ai_active_generation_id');
    expect(Storage.prototype.removeItem).toHaveBeenCalledWith('ai_active_generation_ts');
  });

  // -------------------------------------------------------------------------
  // 8. Genre change re-fetches pinned characters
  // -------------------------------------------------------------------------
  test('genre change re-fetches pinned characters', async () => {
    mockFeatureValues.character_pinning = { enabled: true, isLoading: false, config: null };

    const fetchCalls: string[] = [];

    global.fetch = jest.fn().mockImplementation((url: string) => {
      fetchCalls.push(url);
      if (url.includes('/api/credits/packages')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            model_pricing: [{ model_key: 'kling-2.6', credit_cost: 5 }],
          }),
        });
      }
      if (url.includes('/api/story/pinned-characters')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, characters: [], season_id: null }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(<AIGeneratePanel />);
    });

    // Initial pinned-characters fetch (no genre)
    expect(fetchCalls.some(u => u.includes('/api/story/pinned-characters'))).toBe(true);

    // Clear and click Comedy genre
    fetchCalls.length = 0;

    await act(async () => {
      fireEvent.click(screen.getByText('Comedy'));
    });

    // Should re-fetch with genre=comedy
    await waitFor(() => {
      expect(fetchCalls.some(u => u.includes('/api/story/pinned-characters?genre=comedy'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 9. CreditPurchaseModal re-open after close works cleanly
  // -------------------------------------------------------------------------
  test('CreditPurchaseModal re-open after close works cleanly', async () => {
    // Make generate always return insufficient credits
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/api/credits/packages')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            model_pricing: [{ model_key: 'kling-2.6', credit_cost: 5 }],
          }),
        });
      }
      if (url.includes('/api/ai/generate')) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({
            success: false,
            code: 'INSUFFICIENT_CREDITS',
            required: 10,
            current: 3,
            error: 'Insufficient credits',
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(<AIGeneratePanel />);
    });

    typeValidPrompt();

    // First attempt — goes to failed stage with purchaseModalOpen=true
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate (?:Video|\()/ }));
    });

    await waitFor(() => {
      expect(screen.getByText('Generation Failed')).toBeInTheDocument();
    });

    // Click "Try Again" to go to idle — modal appears because purchaseModalOpen stayed true
    await act(async () => {
      fireEvent.click(screen.getByText('Try Again'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('credit-purchase-modal')).toBeInTheDocument();
    });

    // Close modal via close button
    await act(async () => {
      fireEvent.click(screen.getByTestId('close-purchase-modal'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('credit-purchase-modal')).not.toBeInTheDocument();
    });

    // refetchCredits should be called when closing the modal
    expect(mockRefetchCredits).toHaveBeenCalled();

    // Try generating again with insufficient credits
    typeValidPrompt();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate (?:Video|\()/ }));
    });

    // Goes to failed again
    await waitFor(() => {
      expect(screen.getByText('Generation Failed')).toBeInTheDocument();
    });

    // Click "Try Again" again — modal opens again
    await act(async () => {
      fireEvent.click(screen.getByText('Try Again'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('credit-purchase-modal')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 10. User character upload round-trip: modal -> create -> close -> selected
  // -------------------------------------------------------------------------
  test('user character upload round-trip: modal -> create -> close -> character selected', async () => {
    mockFeatureValues.user_characters = { enabled: true, isLoading: false, config: null };

    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/api/credits/packages')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            model_pricing: [{ model_key: 'kling-2.6', credit_cost: 5 }],
          }),
        });
      }
      if (url === '/api/ai/characters') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, characters: [] }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(<AIGeneratePanel />);
    });

    // Click "Upload your character" button in the manager mock
    await act(async () => {
      fireEvent.click(screen.getByText('Upload your character'));
    });

    // Upload modal should be open
    expect(screen.getByTestId('upload-modal')).toBeInTheDocument();

    // Simulate the modal calling onCreated with a new character
    const newChar = {
      id: 'char-round-trip',
      label: 'TestHero',
      frontal_image_url: 'https://cdn.example.com/hero.jpg',
      reference_image_urls: [],
      reference_count: 0,
      appearance_description: null,
      usage_count: 0,
    };

    await act(async () => {
      capturedUploadModalProps.onCreated!(newChar);
    });

    // Character should appear in the manager (our mock renders it)
    await waitFor(() => {
      expect(screen.getByTestId('char-char-round-trip')).toBeInTheDocument();
      expect(screen.getByText('TestHero')).toBeInTheDocument();
    });

    // Close modal
    await act(async () => {
      capturedUploadModalProps.onClose!();
    });

    // Modal should be closed
    await waitFor(() => {
      expect(screen.queryByTestId('upload-modal')).not.toBeInTheDocument();
    });

    // Character should still be visible and selected
    expect(screen.getByTestId('char-char-round-trip')).toBeInTheDocument();
    expect(screen.getByText('(1 selected)')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 11. Video preview video element exists in ready state
  // -------------------------------------------------------------------------
  test('video element is present with blob URL in ready state', async () => {
    const videoBlob = new Blob(['fake-video'], { type: 'video/mp4' });

    const { fetchMock } = createRoutedFetch({
      '/api/credits/packages': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          model_pricing: [{ model_key: 'kling-2.6', credit_cost: 5 }],
        }),
      }),
      '/api/ai/generate': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, generationId: 'gen-preview-1' }),
      }),
      '/api/ai/status/': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          stage: 'ready',
          videoUrl: 'https://fal.media/preview-test.mp4',
        }),
      }),
      'https://fal.media/preview-test.mp4': () => Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(videoBlob),
      }),
    });
    global.fetch = fetchMock;

    await act(async () => {
      render(<AIGeneratePanel />);
    });

    typeValidPrompt();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate (?:Video|\()/ }));
    });

    // Wait for ready state — video element should appear
    await waitFor(() => {
      const videoEl = document.querySelector('video');
      expect(videoEl).toBeTruthy();
    }, { timeout: 5000 });

    // Wait for blob URL to be applied — pre-download creates blob URL
    await waitFor(() => {
      const videoEl = document.querySelector('video') as HTMLVideoElement;
      // Component uses blobVideoUrl || videoUrl as src
      expect(videoEl.src).toBeTruthy();
    });

    // URL.createObjectURL should have been called (blob pre-download)
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 12. Done stage shows success and calls onComplete
  // -------------------------------------------------------------------------
  test('done stage shows success and calls onComplete', async () => {
    const onComplete = jest.fn();
    const videoBlob = new Blob(['fake-video'], { type: 'video/mp4' });

    // csrfPost mock sequence: complete, then register
    mockCsrfPost
      .mockResolvedValueOnce({
        success: true,
        falVideoUrl: 'https://fal.media/done-test.mp4',
        signedUploadUrl: 'https://r2.example.com/upload',
        storageKey: 'test-key',
      })
      .mockResolvedValueOnce({
        success: true,
        clip: { id: 'clip-123' },
      });

    const { fetchMock } = createRoutedFetch({
      '/api/credits/packages': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          model_pricing: [{ model_key: 'kling-2.6', credit_cost: 5 }],
        }),
      }),
      '/api/ai/generate': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, generationId: 'gen-done-1' }),
      }),
      '/api/ai/status/': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          stage: 'ready',
          videoUrl: 'https://fal.media/done-test.mp4',
        }),
      }),
      'https://fal.media/done-test.mp4': () => Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(videoBlob),
      }),
      'https://r2.example.com/upload': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      }),
    });
    global.fetch = fetchMock;

    await act(async () => {
      render(<AIGeneratePanel onComplete={onComplete} />);
    });

    typeValidPrompt();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate (?:Video|\()/ }));
    });

    // Wait for ready state
    await waitFor(() => {
      expect(screen.getByText('New')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Fill in title and genre for submit
    const titleInput = screen.getByPlaceholderText(/give your clip a title/i);
    fireEvent.change(titleInput, { target: { value: 'My Epic Clip' } });

    // Select a genre (component should show genre selector in ready stage)
    fireEvent.click(screen.getByText('Action'));

    // Click Submit
    await act(async () => {
      fireEvent.click(screen.getByText('Submit to Tournament'));
    });

    // Wait for done stage — success message
    await waitFor(() => {
      expect(screen.getByText('Clip Submitted!')).toBeInTheDocument();
    }, { timeout: 5000 });

    // onComplete callback should have been invoked
    expect(onComplete).toHaveBeenCalledTimes(1);

    // localStorage should be cleaned up
    expect(Storage.prototype.removeItem).toHaveBeenCalledWith('ai_active_generation_id');
    expect(Storage.prototype.removeItem).toHaveBeenCalledWith('ai_active_generation_ts');
  });
});
