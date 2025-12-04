import { sounds } from '@/lib/sounds';

describe('SoundManager', () => {
  beforeEach(() => {
    // Reset localStorage before each test
    localStorage.clear();
    // Mock AudioContext
    (global as any).AudioContext = jest.fn().mockImplementation(() => ({
      state: 'running',
      resume: jest.fn().mockResolvedValue(undefined),
      createOscillator: jest.fn().mockReturnValue({
        connect: jest.fn(),
        type: 'sine',
        frequency: { setValueAtTime: jest.fn() },
        start: jest.fn(),
        stop: jest.fn(),
      }),
      createGain: jest.fn().mockReturnValue({
        connect: jest.fn(),
        gain: {
          setValueAtTime: jest.fn(),
          linearRampToValueAtTime: jest.fn(),
        },
      }),
      destination: {},
      currentTime: 0,
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isEnabled', () => {
    it('should return true by default', () => {
      expect(sounds.isEnabled()).toBe(true);
    });

    it('should return false when disabled via setEnabled', () => {
      sounds.setEnabled(false);
      expect(sounds.isEnabled()).toBe(false);
    });

    it('should persist enabled state to localStorage', () => {
      sounds.setEnabled(false);
      expect(localStorage.getItem('soundEffectsEnabled')).toBe('false');

      sounds.setEnabled(true);
      expect(localStorage.getItem('soundEffectsEnabled')).toBe('true');
    });

    it('should read enabled state from localStorage', () => {
      localStorage.setItem('soundEffectsEnabled', 'false');
      expect(sounds.isEnabled()).toBe(false);

      localStorage.setItem('soundEffectsEnabled', 'true');
      expect(sounds.isEnabled()).toBe(true);
    });
  });

  describe('play', () => {
    it('should not throw when playing vote sound', () => {
      expect(() => sounds.play('vote')).not.toThrow();
    });

    it('should not throw when playing superVote sound', () => {
      expect(() => sounds.play('superVote')).not.toThrow();
    });

    it('should not throw when playing megaVote sound', () => {
      expect(() => sounds.play('megaVote')).not.toThrow();
    });

    it('should not throw when playing milestone sound', () => {
      expect(() => sounds.play('milestone')).not.toThrow();
    });

    it('should not throw when playing error sound', () => {
      expect(() => sounds.play('error')).not.toThrow();
    });

    it('should not play sounds when disabled', () => {
      sounds.setEnabled(false);
      const audioContextSpy = jest.spyOn(global as any, 'AudioContext');

      sounds.play('vote');

      // AudioContext should not be instantiated when sounds are disabled
      expect(audioContextSpy).not.toHaveBeenCalled();
    });
  });
});
