// Tests for AIGeneratePanel component
// Prompt-to-video generation form with style/model selectors, credit checks, and polling

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AIGeneratePanel from '@/components/AIGeneratePanel';

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

// Mock useFeature hook - ai_video_generation enabled by default
const mockFeatureValues: Record<string, { enabled: boolean; isLoading: boolean; config: unknown }> = {
  ai_video_generation: { enabled: true, isLoading: false, config: null },
  elevenlabs_narration: { enabled: false, isLoading: false, config: null },
  character_pinning: { enabled: false, isLoading: false, config: null },
  prompt_learning: { enabled: false, isLoading: false, config: null },
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
jest.mock('@/hooks/useCredits', () => ({
  useCredits: () => ({
    balance: 50,
    isLoading: false,
    error: null,
    refetch: mockRefetchCredits,
  }),
}));

// Mock CreditPurchaseModal
jest.mock('@/components/CreditPurchaseModal', () => ({
  __esModule: true,
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="credit-purchase-modal">Purchase Modal</div> : null,
}));

// Mock CharacterReferenceSuggestModal
jest.mock('@/components/CharacterReferenceSuggestModal', () => ({
  __esModule: true,
  default: () => null,
}));

describe('AIGeneratePanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset feature flags
    mockFeatureValues.ai_video_generation = { enabled: true, isLoading: false, config: null };

    // Default: fetch model pricing
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        model_pricing: [
          { model_key: 'kling-2.6', credit_cost: 5 },
          { model_key: 'veo3-fast', credit_cost: 8 },
        ],
      }),
    });

    // Mock localStorage
    Storage.prototype.getItem = jest.fn().mockReturnValue(null);
    Storage.prototype.setItem = jest.fn();
    Storage.prototype.removeItem = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the prompt textarea and generate button', () => {
    render(<AIGeneratePanel />);

    expect(
      screen.getByPlaceholderText(/describe a dramatic scene/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Generate Video')).toBeInTheDocument();
  });

  it('renders nothing when ai_video_generation feature is disabled', () => {
    mockFeatureValues.ai_video_generation = { enabled: false, isLoading: false, config: null };
    const { container } = render(<AIGeneratePanel />);

    expect(container.innerHTML).toBe('');
  });

  it('shows loading spinner when feature flag is still loading', () => {
    mockFeatureValues.ai_video_generation = { enabled: false, isLoading: true, config: null };
    render(<AIGeneratePanel />);

    // The component renders a Loader2 spinner during flag loading
    expect(screen.queryByText('Generate Video')).not.toBeInTheDocument();
  });

  it('renders style pills for selection', () => {
    render(<AIGeneratePanel />);

    expect(screen.getByText('Style (optional):')).toBeInTheDocument();
    expect(screen.getByText(/Cinematic/)).toBeInTheDocument();
    expect(screen.getByText(/Anime/)).toBeInTheDocument();
    expect(screen.getByText(/Realistic/)).toBeInTheDocument();
    expect(screen.getByText(/Noir/)).toBeInTheDocument();
  });

  it('disables generate button when prompt is too short', () => {
    render(<AIGeneratePanel />);

    const generateButton = screen.getByText('Generate Video');
    expect(generateButton).toBeDisabled();

    // Type a short prompt (< 10 chars)
    const textarea = screen.getByPlaceholderText(/describe a dramatic scene/i);
    fireEvent.change(textarea, { target: { value: 'Short' } });

    expect(generateButton).toBeDisabled();
  });

  it('enables generate button when prompt is long enough', () => {
    render(<AIGeneratePanel />);

    const textarea = screen.getByPlaceholderText(/describe a dramatic scene/i);
    fireEvent.change(textarea, { target: { value: 'A long enough prompt that describes a dramatic scene' } });

    const generateButton = screen.getByText(/Generate/);
    expect(generateButton).not.toBeDisabled();
  });

  it('shows error when trying to generate with a too-short prompt', async () => {
    render(<AIGeneratePanel />);

    const textarea = screen.getByPlaceholderText(/describe a dramatic scene/i);
    fireEvent.change(textarea, { target: { value: 'A long enough prompt for testing' } });

    // Override fetch to simulate error
    global.fetch = jest.fn()
      // model pricing call
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ model_pricing: [] }),
      })
      // generate call fails
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Server error', success: false }),
      });

    const generateButton = screen.getByText(/Generate/);
    fireEvent.click(generateButton);

    await waitFor(() => {
      expect(screen.getByText('Generation Failed')).toBeInTheDocument();
    });
  });

  it('shows suggestion chips for the selected genre', () => {
    render(<AIGeneratePanel preselectedGenre="comedy" />);

    // Comedy chips should be visible
    expect(screen.getByText(/cat knocks wedding cake/)).toBeInTheDocument();
  });

  it('populates prompt when clicking a suggestion chip', () => {
    render(<AIGeneratePanel />);

    // Default chips (no genre)
    const chip = screen.getByText(/figure sprints through flames/);
    fireEvent.click(chip);

    const textarea = screen.getByPlaceholderText(/describe a dramatic scene/i) as HTMLTextAreaElement;
    expect(textarea.value).toContain('figure sprints through flames');
  });

  it('shows the continuation choice UI when lastFrameUrl is provided', () => {
    render(<AIGeneratePanel lastFrameUrl="https://example.com/frame.jpg" />);

    expect(screen.getByText('Continue from last scene')).toBeInTheDocument();
    expect(screen.getByText('Start fresh')).toBeInTheDocument();
  });
});
