/**
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Imports (no external dependencies to mock - pure utility module)
// ---------------------------------------------------------------------------

import {
  GENRES,
  LAUNCH_GENRES,
  GENRE_MAP,
  getGenreEmoji,
  getGenreLabel,
  isValidGenre,
  isLaunchGenre,
  getGenreCodes,
  getLaunchGenreCodes,
} from '@/lib/genres';

import type { GenreCode, LaunchGenreCode } from '@/lib/genres';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('genres', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // GENRES constant
  // =========================================================================
  describe('GENRES', () => {
    it('contains exactly 8 genres', () => {
      expect(GENRES).toHaveLength(8);
    });

    it('each genre has code, label, and emoji', () => {
      for (const genre of GENRES) {
        expect(typeof genre.code).toBe('string');
        expect(genre.code.length).toBeGreaterThan(0);
        expect(typeof genre.label).toBe('string');
        expect(genre.label.length).toBeGreaterThan(0);
        expect(typeof genre.emoji).toBe('string');
        expect(genre.emoji.length).toBeGreaterThan(0);
      }
    });

    it('contains expected genre codes', () => {
      const codes = GENRES.map((g) => g.code);
      expect(codes).toContain('action');
      expect(codes).toContain('comedy');
      expect(codes).toContain('horror');
      expect(codes).toContain('animation');
      expect(codes).toContain('thriller');
      expect(codes).toContain('sci-fi');
      expect(codes).toContain('romance');
      expect(codes).toContain('drama');
    });

    it('genre codes are all lowercase', () => {
      for (const genre of GENRES) {
        expect(genre.code).toBe(genre.code.toLowerCase());
      }
    });

    it('genre labels are capitalized', () => {
      for (const genre of GENRES) {
        expect(genre.label[0]).toBe(genre.label[0].toUpperCase());
      }
    });
  });

  // =========================================================================
  // LAUNCH_GENRES constant
  // =========================================================================
  describe('LAUNCH_GENRES', () => {
    it('contains 4 launch genres', () => {
      expect(LAUNCH_GENRES).toHaveLength(4);
    });

    it('includes action, comedy, horror, animation', () => {
      expect(LAUNCH_GENRES).toContain('action');
      expect(LAUNCH_GENRES).toContain('comedy');
      expect(LAUNCH_GENRES).toContain('horror');
      expect(LAUNCH_GENRES).toContain('animation');
    });

    it('all launch genres are also in GENRES', () => {
      const allCodes = GENRES.map((g) => g.code);
      for (const code of LAUNCH_GENRES) {
        expect(allCodes).toContain(code);
      }
    });
  });

  // =========================================================================
  // GENRE_MAP
  // =========================================================================
  describe('GENRE_MAP', () => {
    it('provides O(1) lookup by genre code', () => {
      expect(GENRE_MAP['action']).toBeDefined();
      expect(GENRE_MAP['action'].label).toBe('Action');
    });

    it('contains all genre codes as keys', () => {
      const keys = Object.keys(GENRE_MAP);
      expect(keys).toHaveLength(8);
      for (const genre of GENRES) {
        expect(GENRE_MAP[genre.code]).toEqual(genre);
      }
    });
  });

  // =========================================================================
  // getGenreEmoji
  // =========================================================================
  describe('getGenreEmoji', () => {
    it('returns correct emoji for known genres', () => {
      expect(getGenreEmoji('action')).toBe(GENRE_MAP['action'].emoji);
      expect(getGenreEmoji('horror')).toBe(GENRE_MAP['horror'].emoji);
      expect(getGenreEmoji('sci-fi')).toBe(GENRE_MAP['sci-fi'].emoji);
    });

    it('returns default movie emoji for unknown genre', () => {
      expect(getGenreEmoji('western')).toBe('\uD83C\uDFA5'); // camera emoji
    });

    it('returns default emoji for empty string', () => {
      expect(getGenreEmoji('')).toBe('\uD83C\uDFA5');
    });
  });

  // =========================================================================
  // getGenreLabel
  // =========================================================================
  describe('getGenreLabel', () => {
    it('returns correct label for known genres', () => {
      expect(getGenreLabel('action')).toBe('Action');
      expect(getGenreLabel('comedy')).toBe('Comedy');
      expect(getGenreLabel('sci-fi')).toBe('Sci-Fi');
    });

    it('returns the code itself for unknown genres', () => {
      expect(getGenreLabel('western')).toBe('western');
    });

    it('returns empty string for empty input', () => {
      expect(getGenreLabel('')).toBe('');
    });
  });

  // =========================================================================
  // isValidGenre
  // =========================================================================
  describe('isValidGenre', () => {
    it('returns true for all valid genre codes', () => {
      for (const genre of GENRES) {
        expect(isValidGenre(genre.code)).toBe(true);
      }
    });

    it('returns false for unknown genres', () => {
      expect(isValidGenre('western')).toBe(false);
      expect(isValidGenre('documentary')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isValidGenre('')).toBe(false);
    });

    it('is case-sensitive (uppercase should fail)', () => {
      expect(isValidGenre('ACTION')).toBe(false);
      expect(isValidGenre('Comedy')).toBe(false);
    });

    it('works as type guard', () => {
      const code = 'action';
      if (isValidGenre(code)) {
        // TypeScript should narrow the type to GenreCode
        const narrowed: GenreCode = code;
        expect(narrowed).toBe('action');
      }
    });
  });

  // =========================================================================
  // isLaunchGenre
  // =========================================================================
  describe('isLaunchGenre', () => {
    it('returns true for launch genres', () => {
      expect(isLaunchGenre('action')).toBe(true);
      expect(isLaunchGenre('comedy')).toBe(true);
      expect(isLaunchGenre('horror')).toBe(true);
      expect(isLaunchGenre('animation')).toBe(true);
    });

    it('returns false for non-launch genres', () => {
      expect(isLaunchGenre('thriller')).toBe(false);
      expect(isLaunchGenre('sci-fi')).toBe(false);
      expect(isLaunchGenre('romance')).toBe(false);
      expect(isLaunchGenre('drama')).toBe(false);
    });

    it('returns false for invalid genres', () => {
      expect(isLaunchGenre('western')).toBe(false);
    });

    it('works as type guard', () => {
      const code = 'comedy';
      if (isLaunchGenre(code)) {
        const narrowed: LaunchGenreCode = code;
        expect(narrowed).toBe('comedy');
      }
    });
  });

  // =========================================================================
  // getGenreCodes
  // =========================================================================
  describe('getGenreCodes', () => {
    it('returns all genre codes as an array', () => {
      const codes = getGenreCodes();
      expect(codes).toHaveLength(8);
      expect(codes).toContain('action');
      expect(codes).toContain('comedy');
      expect(codes).toContain('horror');
      expect(codes).toContain('animation');
      expect(codes).toContain('thriller');
      expect(codes).toContain('sci-fi');
      expect(codes).toContain('romance');
      expect(codes).toContain('drama');
    });

    it('returns codes in the same order as GENRES', () => {
      const codes = getGenreCodes();
      for (let i = 0; i < GENRES.length; i++) {
        expect(codes[i]).toBe(GENRES[i].code);
      }
    });
  });

  // =========================================================================
  // getLaunchGenreCodes
  // =========================================================================
  describe('getLaunchGenreCodes', () => {
    it('returns launch genre codes as an array', () => {
      const codes = getLaunchGenreCodes();
      expect(codes).toHaveLength(4);
      expect(codes).toContain('action');
      expect(codes).toContain('comedy');
      expect(codes).toContain('horror');
      expect(codes).toContain('animation');
    });

    it('returns a copy (not the original array)', () => {
      const codes1 = getLaunchGenreCodes();
      const codes2 = getLaunchGenreCodes();
      expect(codes1).not.toBe(codes2);
      expect(codes1).toEqual(codes2);
    });
  });
});
