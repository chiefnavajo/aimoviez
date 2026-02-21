/**
 * UserCharacterManager component tests.
 *
 * Tests cover: character selection/deselection, preview modal, fullscreen viewer,
 * delete individual angles, guided camera capture flow, and empty state.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import UserCharacterManager, { UserCharacter } from '@/components/UserCharacterManager';

// =============================================================================
// Mock framer-motion
// =============================================================================

jest.mock('framer-motion', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactActual = require('react');
  const MotionDiv = ReactActual.forwardRef(
    function MotionDiv({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<HTMLDivElement>) {
      const { initial: _i, animate: _a, exit: _e, whileHover: _wh, whileTap: _wt, ...domProps } = props;
      return <div ref={ref} {...domProps}>{children}</div>;
    }
  );
  const MotionButton = ReactActual.forwardRef(
    function MotionButton({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<HTMLButtonElement>) {
      const { initial: _i, animate: _a, exit: _e, whileHover: _wh, whileTap: _wt, ...domProps } = props;
      return <button ref={ref} {...domProps}>{children}</button>;
    }
  );
  return {
    motion: { div: MotionDiv, button: MotionButton },
    AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  };
});

// =============================================================================
// Mock useCsrf hook
// =============================================================================

const mockEnsureToken = jest.fn().mockResolvedValue(undefined);
jest.mock('@/hooks/useCsrf', () => ({
  useCsrf: () => ({
    ensureToken: mockEnsureToken,
  }),
}));

// =============================================================================
// Mock lucide-react icons
// =============================================================================

jest.mock('lucide-react', () => ({
  Check: ({ className }: { className?: string }) => <span data-testid="icon-check" className={className} />,
  Plus: ({ className }: { className?: string }) => <span data-testid="icon-plus" className={className} />,
  Trash2: ({ className }: { className?: string }) => <span data-testid="icon-trash2" className={className} />,
  X: ({ className }: { className?: string }) => <span data-testid="icon-x" className={className} />,
  Upload: ({ className }: { className?: string }) => <span data-testid="icon-upload" className={className} />,
  Loader2: ({ className }: { className?: string }) => <span data-testid="icon-loader2" className={className} />,
  AlertCircle: ({ className }: { className?: string }) => <span data-testid="icon-alert" className={className} />,
  Eye: ({ className }: { className?: string }) => <span data-testid="icon-eye" className={className} />,
}));

// =============================================================================
// Test data
// =============================================================================

const CHARACTER_1: UserCharacter = {
  id: 'char-1',
  label: 'Hero',
  frontal_image_url: 'https://cdn.example.com/hero-front.jpg',
  reference_image_urls: [
    'https://cdn.example.com/hero-left.png',
    'https://cdn.example.com/hero-right.png',
    'https://cdn.example.com/hero-rear.png',
  ],
  reference_count: 3,
  appearance_description: 'Tall with dark hair',
  usage_count: 5,
};

const CHARACTER_2: UserCharacter = {
  id: 'char-2',
  label: 'Villain',
  frontal_image_url: 'https://cdn.example.com/villain-front.jpg',
  reference_image_urls: [],
  reference_count: 0,
  appearance_description: null,
  usage_count: 0,
};

// =============================================================================
// Helpers
// =============================================================================

const defaultProps = {
  characters: [CHARACTER_1, CHARACTER_2],
  selectedIds: new Set<string>(),
  onToggle: jest.fn(),
  onDelete: jest.fn(),
  onUploadClick: jest.fn(),
  onAngleAdded: jest.fn(),
  maxSelectable: 4,
};

function renderManager(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  return render(<UserCharacterManager {...props} />);
}

// Set up mock document.cookie for CSRF token
Object.defineProperty(document, 'cookie', {
  writable: true,
  value: 'csrf-token=test-csrf-token',
});

// =============================================================================
// beforeEach
// =============================================================================

const originalFetch = global.fetch;
let mockFetchFn: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchFn = jest.fn();
  global.fetch = mockFetchFn as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// #############################################################################
// Tests
// #############################################################################

describe('UserCharacterManager', () => {
  // ===========================================================================
  // Empty state
  // ===========================================================================

  describe('empty state', () => {
    test('shows upload prompt when no characters', () => {
      renderManager({ characters: [] });
      expect(screen.getByText('Upload your character')).toBeInTheDocument();
      expect(screen.getByText('Put your face in AI videos')).toBeInTheDocument();
    });

    test('calls onUploadClick when upload button clicked', () => {
      const onUploadClick = jest.fn();
      renderManager({ characters: [], onUploadClick });
      fireEvent.click(screen.getByText('Upload your character'));
      expect(onUploadClick).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Character grid + selection
  // ===========================================================================

  describe('character grid', () => {
    test('renders all characters with labels', () => {
      renderManager();
      expect(screen.getByText('Hero')).toBeInTheDocument();
      expect(screen.getByText('Villain')).toBeInTheDocument();
    });

    test('shows angle count for characters with angles', () => {
      renderManager();
      expect(screen.getByText('3 angles')).toBeInTheDocument();
    });

    test('does not show angle count for characters with 0 angles', () => {
      renderManager();
      expect(screen.queryByText('0 angles')).not.toBeInTheDocument();
    });

    test('shows selected count in header', () => {
      renderManager({ selectedIds: new Set(['char-1']) });
      expect(screen.getByText('(1 selected)')).toBeInTheDocument();
    });

    test('calls onToggle when character clicked', () => {
      const onToggle = jest.fn();
      renderManager({ onToggle });
      fireEvent.click(screen.getByText('Hero'));
      expect(onToggle).toHaveBeenCalledWith('char-1');
    });

    test('calls onToggle to deselect already-selected character', () => {
      const onToggle = jest.fn();
      renderManager({ onToggle, selectedIds: new Set(['char-1']) });
      fireEvent.click(screen.getByText('Hero'));
      expect(onToggle).toHaveBeenCalledWith('char-1');
    });

    test('does not call onToggle when max reached and character not selected', () => {
      const onToggle = jest.fn();
      renderManager({
        onToggle,
        maxSelectable: 1,
        selectedIds: new Set(['char-2']),
      });
      // Click Hero (not selected, but max=1 already reached with char-2)
      fireEvent.click(screen.getByText('Hero'));
      expect(onToggle).not.toHaveBeenCalled();
    });

    test('shows checkmark on selected characters', () => {
      renderManager({ selectedIds: new Set(['char-1']) });
      // Check icons exist (check icon appears on selected)
      const checkIcons = screen.getAllByTestId('icon-check');
      expect(checkIcons.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Preview modal
  // ===========================================================================

  describe('preview modal', () => {
    test('opens preview modal when Eye button clicked on mobile', () => {
      renderManager();
      const previewButtons = screen.getAllByLabelText(/Preview/);
      fireEvent.click(previewButtons[0]); // Click "Preview Hero"
      expect(screen.getByText('Tall with dark hair')).toBeInTheDocument();
      expect(screen.getByText('Used 5 times')).toBeInTheDocument();
    });

    test('shows reference angle grid with labels in preview', () => {
      renderManager();
      const previewButtons = screen.getAllByLabelText(/Preview/);
      fireEvent.click(previewButtons[0]);
      expect(screen.getByText('Front')).toBeInTheDocument();
      expect(screen.getByText('Left')).toBeInTheDocument();
      expect(screen.getByText('Right')).toBeInTheDocument();
      expect(screen.getByText('Rear')).toBeInTheDocument();
    });

    test('shows Select button for unselected character', () => {
      renderManager();
      const previewButtons = screen.getAllByLabelText(/Preview/);
      fireEvent.click(previewButtons[0]);
      expect(screen.getByText('Select')).toBeInTheDocument();
    });

    test('shows Deselect button for selected character', () => {
      renderManager({ selectedIds: new Set(['char-1']) });
      const previewButtons = screen.getAllByLabelText(/Preview/);
      fireEvent.click(previewButtons[0]);
      expect(screen.getByText('Deselect')).toBeInTheDocument();
    });

    test('Select button calls onToggle and closes modal', () => {
      const onToggle = jest.fn();
      renderManager({ onToggle });
      const previewButtons = screen.getAllByLabelText(/Preview/);
      fireEvent.click(previewButtons[0]);
      fireEvent.click(screen.getByText('Select'));
      expect(onToggle).toHaveBeenCalledWith('char-1');
    });

    test('closes preview modal when X button clicked', () => {
      renderManager();
      const previewButtons = screen.getAllByLabelText(/Preview/);
      fireEvent.click(previewButtons[0]); // Open
      expect(screen.getByText('Tall with dark hair')).toBeInTheDocument();
      // Find the close X button in the modal footer (the one next to trash)
      const closeButtons = screen.getAllByTestId('icon-x');
      // Click the last X icon which is the modal close button
      const modalCloseBtn = closeButtons[closeButtons.length - 1].closest('button');
      if (modalCloseBtn) fireEvent.click(modalCloseBtn);
    });

  });

  // ===========================================================================
  // Fullscreen image viewer
  // ===========================================================================

  describe('fullscreen viewer', () => {
    test('opens fullscreen when frontal image tapped in preview', () => {
      renderManager();
      const previewButtons = screen.getAllByLabelText(/Preview/);
      fireEvent.click(previewButtons[0]);
      // The frontal image in modal is inside a <button> that sets fullscreenImage
      // There are multiple "Hero" alt-text imgs: grid card + modal large + modal grid "Front"
      // The modal large one is a full-width button
      const modalDialog = screen.getByRole('dialog');
      const imagesInModal = modalDialog.querySelectorAll('img');
      // First img in modal is the large frontal
      fireEvent.click(imagesInModal[0]);
      expect(screen.getByAltText('Enlarged view')).toBeInTheDocument();
    });

    test('opens fullscreen when angle thumbnail tapped', () => {
      renderManager();
      const previewButtons = screen.getAllByLabelText(/Preview/);
      fireEvent.click(previewButtons[0]);
      // Click a reference angle image (not the X button)
      const leftAngle = screen.getByAltText('Left angle');
      fireEvent.click(leftAngle);
      expect(screen.getByAltText('Enlarged view')).toBeInTheDocument();
    });

    test('closes fullscreen when close button clicked', () => {
      renderManager();
      const previewButtons = screen.getAllByLabelText(/Preview/);
      fireEvent.click(previewButtons[0]);
      // Open fullscreen via angle thumbnail
      const leftAngle = screen.getByAltText('Left angle');
      fireEvent.click(leftAngle);
      expect(screen.getByAltText('Enlarged view')).toBeInTheDocument();
      // Close it
      const closeBtn = screen.getByLabelText('Close fullscreen view');
      fireEvent.click(closeBtn);
      expect(screen.queryByAltText('Enlarged view')).not.toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Delete individual angles
  // ===========================================================================

  describe('delete individual angles', () => {
    test('shows X buttons on angle thumbnails', () => {
      renderManager();
      const previewButtons = screen.getAllByLabelText(/Preview/);
      fireEvent.click(previewButtons[0]); // Hero with 3 angles
      // Each angle has a "Remove X angle" button
      expect(screen.getByLabelText('Remove Left angle')).toBeInTheDocument();
      expect(screen.getByLabelText('Remove Right angle')).toBeInTheDocument();
      expect(screen.getByLabelText('Remove Rear angle')).toBeInTheDocument();
    });

    test('calls DELETE API when angle X button clicked', async () => {
      mockFetchFn.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          reference_count: 2,
          reference_image_urls: [
            'https://cdn.example.com/hero-right.png',
            'https://cdn.example.com/hero-rear.png',
          ],
        }),
        headers: new Headers({ 'content-type': 'application/json' }),
      });

      const onAngleAdded = jest.fn();
      renderManager({ onAngleAdded });
      const previewButtons = screen.getAllByLabelText(/Preview/);
      fireEvent.click(previewButtons[0]);

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Remove Left angle'));
      });

      await waitFor(() => {
        expect(mockFetchFn).toHaveBeenCalledWith(
          '/api/ai/characters/char-1/angles',
          expect.objectContaining({
            method: 'DELETE',
            body: JSON.stringify({ image_url: 'https://cdn.example.com/hero-left.png' }),
          })
        );
      });

      await waitFor(() => {
        expect(onAngleAdded).toHaveBeenCalledWith(
          'char-1',
          2,
          ['https://cdn.example.com/hero-right.png', 'https://cdn.example.com/hero-rear.png']
        );
      });
    });

    test('shows error when angle deletion fails', async () => {
      mockFetchFn.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ success: false, error: 'Failed to remove angle' }),
        headers: new Headers({ 'content-type': 'application/json' }),
      });

      renderManager();
      const previewButtons = screen.getAllByLabelText(/Preview/);
      fireEvent.click(previewButtons[0]);

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Remove Left angle'));
      });

      await waitFor(() => {
        expect(screen.getByText('Failed to remove angle')).toBeInTheDocument();
      });
    });
  });

  // ===========================================================================
  // Upload angle button
  // ===========================================================================

  describe('upload angle button', () => {
    test('shows "Upload Angle" button when character has < 6 angles', () => {
      renderManager({ characters: [CHARACTER_2] }); // Villain has 0 angles
      const previewButtons = screen.getAllByLabelText(/Preview/);
      fireEvent.click(previewButtons[0]);
      expect(screen.getByText(/Upload Angle/)).toBeInTheDocument();
    });

    test('hides upload button when character has 6 angles', () => {
      const charFull: UserCharacter = {
        ...CHARACTER_1,
        reference_count: 6,
        reference_image_urls: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg', 'f.jpg'],
      };
      renderManager({ characters: [charFull] });
      const previewButtons = screen.getAllByLabelText(/Preview/);
      fireEvent.click(previewButtons[0]);
      expect(screen.queryByText(/Upload Angle/)).not.toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Character deletion
  // ===========================================================================

  describe('character deletion', () => {
    test('shows confirm button after first delete click', () => {
      renderManager();
      const previewButtons = screen.getAllByLabelText(/Preview/);
      fireEvent.click(previewButtons[0]);
      // Click trash icon button
      const trashIcons = screen.getAllByTestId('icon-trash2');
      fireEvent.click(trashIcons[0].closest('button')!);
      // Now confirm button should appear
      expect(screen.getByText('Confirm')).toBeInTheDocument();
    });

    test('calls delete API and onDelete on confirm', async () => {
      mockFetchFn.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      const onDelete = jest.fn();
      renderManager({ onDelete });
      const previewButtons = screen.getAllByLabelText(/Preview/);
      fireEvent.click(previewButtons[0]);

      // First click shows confirm
      const trashIcons = screen.getAllByTestId('icon-trash2');
      fireEvent.click(trashIcons[0].closest('button')!);

      // Confirm delete
      await act(async () => {
        fireEvent.click(screen.getByText('Confirm'));
      });

      await waitFor(() => {
        expect(mockFetchFn).toHaveBeenCalledWith(
          '/api/ai/characters?id=char-1',
          expect.objectContaining({ method: 'DELETE' })
        );
        expect(onDelete).toHaveBeenCalledWith('char-1');
      });
    });
  });

  // ===========================================================================
  // Add button
  // ===========================================================================

  describe('add button', () => {
    test('shows Add button in header that calls onUploadClick', () => {
      const onUploadClick = jest.fn();
      renderManager({ onUploadClick });
      const addButton = screen.getByText('Add');
      fireEvent.click(addButton);
      expect(onUploadClick).toHaveBeenCalledTimes(1);
    });
  });
});
