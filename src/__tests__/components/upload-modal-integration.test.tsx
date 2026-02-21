/**
 * Integration test: Upload modal Phase 2 guided capture stays open.
 *
 * Verifies that when a user uploads a character via AIGeneratePanel,
 * the modal transitions to Phase 2 (angle capture) without closing.
 * This catches the critical bug where parent's onCreated callback
 * unmounted the modal before Phase 2 could render.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AIGeneratePanel from '@/components/AIGeneratePanel';

// =============================================================================
// Mocks
// =============================================================================

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial: _i, animate: _a, exit: _e, whileHover: _wh, whileTap: _wt, ...domProps } = props;
      return <div {...domProps}>{children}</div>;
    },
    button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial: _i, animate: _a, exit: _e, whileHover: _wh, whileTap: _wt, ...domProps } = props;
      return <button {...domProps}>{children}</button>;
    },
    span: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial: _i, animate: _a, exit: _e, whileHover: _wh, whileTap: _wt, ...domProps } = props;
      return <span {...domProps}>{children}</span>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  useAnimation: () => ({ start: jest.fn() }),
}));

const mockEnsureToken = jest.fn().mockResolvedValue(undefined);
jest.mock('@/hooks/useCsrf', () => ({
  useCsrf: () => ({
    post: jest.fn(),
    ensureToken: mockEnsureToken,
  }),
}));

const mockFeatureValues: Record<string, { enabled: boolean; isLoading: boolean; config: unknown }> = {
  ai_video_generation: { enabled: true, isLoading: false, config: null },
  elevenlabs_narration: { enabled: false, isLoading: false, config: null },
  character_pinning: { enabled: false, isLoading: false, config: null },
  prompt_learning: { enabled: false, isLoading: false, config: null },
  user_characters: { enabled: true, isLoading: false, config: null },
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

jest.mock('@/hooks/useCredits', () => ({
  useCredits: () => ({
    balance: 50,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  }),
}));

jest.mock('@/components/CreditPurchaseModal', () => ({
  __esModule: true,
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="credit-purchase-modal">Purchase Modal</div> : null,
}));

jest.mock('@/components/CharacterReferenceSuggestModal', () => ({
  __esModule: true,
  default: () => null,
}));

// =============================================================================
// Image mock — simulate valid 512x512 image for dimension check
// =============================================================================

const OriginalImage = global.Image;

class MockImage {
  width = 512;
  height = 512;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';

  get src() {
    return this._src;
  }
  set src(val: string) {
    this._src = val;
    // Trigger onload async to simulate real Image behavior
    setTimeout(() => this.onload?.(), 0);
  }
}

// =============================================================================
// Helpers
// =============================================================================

Object.defineProperty(document, 'cookie', {
  writable: true,
  value: 'csrf-token=test-csrf-token',
});

let fetchCallIndex = 0;
const fetchResponses: Array<{ ok: boolean; json?: () => Promise<unknown>; blob?: () => Promise<Blob> }> = [];

function mockFetchSequence(responses: typeof fetchResponses) {
  fetchCallIndex = 0;
  fetchResponses.length = 0;
  fetchResponses.push(...responses);

  global.fetch = jest.fn().mockImplementation(() => {
    const response = fetchResponses[fetchCallIndex] || {
      ok: true,
      json: () => Promise.resolve({}),
    };
    fetchCallIndex++;
    return Promise.resolve(response);
  });
}

function makeJsonResponse(data: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(data) };
}

/** Simulate selecting a JPEG file via a hidden input */
function selectFile(input: HTMLInputElement) {
  const file = new File(['fake-image-data'], 'selfie.jpg', { type: 'image/jpeg' });
  Object.defineProperty(file, 'size', { value: 1024 * 100 }); // 100KB
  fireEvent.change(input, { target: { files: [file] } });
}

// =============================================================================
// Setup
// =============================================================================

beforeEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.Image = MockImage as any;
  global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-url');
  global.URL.revokeObjectURL = jest.fn();

  Storage.prototype.getItem = jest.fn().mockReturnValue(null);
  Storage.prototype.setItem = jest.fn();
  Storage.prototype.removeItem = jest.fn();

  // Reset feature flags
  mockFeatureValues.user_characters = { enabled: true, isLoading: false, config: null };
  mockFeatureValues.ai_video_generation = { enabled: true, isLoading: false, config: null };
});

afterEach(() => {
  global.Image = OriginalImage;
  jest.restoreAllMocks();
});

// =============================================================================
// Tests
// =============================================================================

describe('Upload modal integration — Phase 2 stays open', () => {
  test('modal transitions to Phase 2 guided capture after character save', async () => {
    // Setup fetch responses:
    // 1. Model pricing (initial render)
    // 2. User characters GET (initial render)
    // 3. POST /api/ai/characters/upload-url
    // 4. PUT signed URL
    // 5. POST /api/ai/characters
    mockFetchSequence([
      makeJsonResponse({ model_pricing: [{ model_key: 'kling-2.6', credit_cost: 5 }] }),
      makeJsonResponse([]), // empty user characters
      makeJsonResponse({ success: true, signedUrl: 'https://r2.example.com/upload', publicUrl: 'https://cdn.example.com/face.jpg' }),
      makeJsonResponse(null), // PUT response (ignored)
      makeJsonResponse({ ok: true, character: { id: 'char-new', label: 'MyFace', frontal_image_url: 'https://cdn.example.com/face.jpg', appearance_description: null } }),
    ]);

    await act(async () => {
      render(<AIGeneratePanel />);
    });

    // "My Characters" section should be visible with upload button
    expect(screen.getByText('Upload your character')).toBeInTheDocument();

    // Click to open upload modal
    fireEvent.click(screen.getByText('Upload your character'));

    // Phase 1: Upload modal is open
    expect(screen.getByText('Upload Character')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Character name (required)')).toBeInTheDocument();

    // Select a photo via the gallery input (the one without capture attribute)
    const fileInputs = document.querySelectorAll('input[type="file"][accept="image/jpeg,image/png,image/webp"]');
    // Find the gallery input (no capture attribute) inside the modal
    const galleryInput = Array.from(fileInputs).find(
      input => !input.hasAttribute('capture') && input.closest('[role="dialog"]')
    ) as HTMLInputElement;
    expect(galleryInput).toBeTruthy();

    await act(async () => {
      selectFile(galleryInput);
      // Wait for MockImage.onload to fire
      await new Promise(r => setTimeout(r, 10));
    });

    // Enter character name
    const nameInput = screen.getByPlaceholderText('Character name (required)');
    fireEvent.change(nameInput, { target: { value: 'MyFace' } });

    // Click Save Character
    const saveButton = screen.getByText('Save Character');
    expect(saveButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(saveButton);
      // Let all promises resolve
      await new Promise(r => setTimeout(r, 50));
    });

    // CRITICAL ASSERTION: Modal is STILL OPEN and shows Phase 2
    await waitFor(() => {
      expect(screen.getByText('Add Reference Angles')).toBeInTheDocument();
    });

    // Phase 2 shows step 1
    expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument();
    expect(screen.getByText('Take Photo')).toBeInTheDocument();
    expect(screen.getByText('Gallery')).toBeInTheDocument();

    // Skip button is visible
    expect(screen.getByText(/Skip/)).toBeInTheDocument();
  });

  test('modal closes when user clicks Skip in Phase 2', async () => {
    mockFetchSequence([
      makeJsonResponse({ model_pricing: [{ model_key: 'kling-2.6', credit_cost: 5 }] }),
      makeJsonResponse([]),
      makeJsonResponse({ success: true, signedUrl: 'https://r2.example.com/upload', publicUrl: 'https://cdn.example.com/face.jpg' }),
      makeJsonResponse(null),
      makeJsonResponse({ ok: true, character: { id: 'char-new', label: 'MyFace', frontal_image_url: 'https://cdn.example.com/face.jpg', appearance_description: null } }),
    ]);

    await act(async () => {
      render(<AIGeneratePanel />);
    });

    fireEvent.click(screen.getByText('Upload your character'));

    const fileInputs = document.querySelectorAll('input[type="file"][accept="image/jpeg,image/png,image/webp"]');
    const galleryInput = Array.from(fileInputs).find(
      input => !input.hasAttribute('capture') && input.closest('[role="dialog"]')
    ) as HTMLInputElement;

    await act(async () => {
      selectFile(galleryInput);
      await new Promise(r => setTimeout(r, 10));
    });

    fireEvent.change(screen.getByPlaceholderText('Character name (required)'), { target: { value: 'MyFace' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Character'));
      await new Promise(r => setTimeout(r, 50));
    });

    // Phase 2 is showing
    await waitFor(() => {
      expect(screen.getByText('Add Reference Angles')).toBeInTheDocument();
    });

    // Click Skip
    fireEvent.click(screen.getByText(/Skip/));

    // Modal should be closed
    await waitFor(() => {
      expect(screen.queryByText('Add Reference Angles')).not.toBeInTheDocument();
    });
  });

  test('character appears in list after upload even while modal is in Phase 2', async () => {
    mockFetchSequence([
      makeJsonResponse({ model_pricing: [{ model_key: 'kling-2.6', credit_cost: 5 }] }),
      makeJsonResponse([]),
      makeJsonResponse({ success: true, signedUrl: 'https://r2.example.com/upload', publicUrl: 'https://cdn.example.com/face.jpg' }),
      makeJsonResponse(null),
      makeJsonResponse({ ok: true, character: { id: 'char-new', label: 'TestChar', frontal_image_url: 'https://cdn.example.com/face.jpg', appearance_description: null } }),
    ]);

    await act(async () => {
      render(<AIGeneratePanel />);
    });

    fireEvent.click(screen.getByText('Upload your character'));

    const fileInputs = document.querySelectorAll('input[type="file"][accept="image/jpeg,image/png,image/webp"]');
    const galleryInput = Array.from(fileInputs).find(
      input => !input.hasAttribute('capture') && input.closest('[role="dialog"]')
    ) as HTMLInputElement;

    await act(async () => {
      selectFile(galleryInput);
      await new Promise(r => setTimeout(r, 10));
    });

    fireEvent.change(screen.getByPlaceholderText('Character name (required)'), { target: { value: 'TestChar' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Character'));
      await new Promise(r => setTimeout(r, 50));
    });

    // Phase 2 is showing (modal still open)
    await waitFor(() => {
      expect(screen.getByText('Add Reference Angles')).toBeInTheDocument();
    });

    // Skip to close modal
    fireEvent.click(screen.getByText(/Skip/));

    await waitFor(() => {
      expect(screen.queryByText('Add Reference Angles')).not.toBeInTheDocument();
    });

    // Character should now appear in the manager (selected, since auto-select is on)
    expect(screen.getByText('(1 selected)')).toBeInTheDocument();
  });

  test('onCreated with same character ID updates instead of duplicating', async () => {
    mockFetchSequence([
      makeJsonResponse({ model_pricing: [{ model_key: 'kling-2.6', credit_cost: 5 }] }),
      makeJsonResponse([]),
      makeJsonResponse({ success: true, signedUrl: 'https://r2.example.com/upload', publicUrl: 'https://cdn.example.com/face.jpg' }),
      makeJsonResponse(null),
      makeJsonResponse({ ok: true, character: { id: 'char-new', label: 'Hero', frontal_image_url: 'https://cdn.example.com/face.jpg', appearance_description: null } }),
    ]);

    await act(async () => {
      render(<AIGeneratePanel />);
    });

    fireEvent.click(screen.getByText('Upload your character'));

    const fileInputs = document.querySelectorAll('input[type="file"][accept="image/jpeg,image/png,image/webp"]');
    const galleryInput = Array.from(fileInputs).find(
      input => !input.hasAttribute('capture') && input.closest('[role="dialog"]')
    ) as HTMLInputElement;

    await act(async () => {
      selectFile(galleryInput);
      await new Promise(r => setTimeout(r, 10));
    });

    fireEvent.change(screen.getByPlaceholderText('Character name (required)'), { target: { value: 'Hero' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Character'));
      await new Promise(r => setTimeout(r, 50));
    });

    await waitFor(() => {
      expect(screen.getByText('Add Reference Angles')).toBeInTheDocument();
    });

    // Skip and close
    fireEvent.click(screen.getByText(/Skip/));

    await waitFor(() => {
      expect(screen.queryByText('Add Reference Angles')).not.toBeInTheDocument();
    });

    // Should have exactly 1 character selected, not duplicated
    expect(screen.getByText('(1 selected)')).toBeInTheDocument();
  });
});
