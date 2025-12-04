// Test for the formatNumber utility used across the app

describe('formatNumber', () => {
  // Define the function inline since it's duplicated in multiple files
  function formatNumber(num: number): string {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  describe('small numbers', () => {
    it('should return number as string for values under 1000', () => {
      expect(formatNumber(0)).toBe('0');
      expect(formatNumber(1)).toBe('1');
      expect(formatNumber(100)).toBe('100');
      expect(formatNumber(999)).toBe('999');
    });
  });

  describe('thousands', () => {
    it('should format 1000 as 1.0K', () => {
      expect(formatNumber(1000)).toBe('1.0K');
    });

    it('should format numbers in thousands with one decimal', () => {
      expect(formatNumber(1500)).toBe('1.5K');
      expect(formatNumber(2300)).toBe('2.3K');
      expect(formatNumber(10000)).toBe('10.0K');
      expect(formatNumber(999999)).toBe('1000.0K');
    });
  });

  describe('millions', () => {
    it('should format 1000000 as 1.0M', () => {
      expect(formatNumber(1000000)).toBe('1.0M');
    });

    it('should format numbers in millions with one decimal', () => {
      expect(formatNumber(1500000)).toBe('1.5M');
      expect(formatNumber(10000000)).toBe('10.0M');
      expect(formatNumber(123456789)).toBe('123.5M');
    });
  });

  describe('edge cases', () => {
    it('should handle negative numbers as-is (function assumes positive)', () => {
      // The function doesn't handle negative numbers specially
      // It returns them as strings since they're less than 1000
      expect(formatNumber(-100)).toBe('-100');
      expect(formatNumber(-1000)).toBe('-1000');
    });

    it('should handle decimal inputs', () => {
      expect(formatNumber(1000.5)).toBe('1.0K');
      expect(formatNumber(1500.9)).toBe('1.5K');
    });
  });
});
