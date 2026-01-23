// Sound effects for voting interactions using Web Audio API
// No audio files required - sounds are generated programmatically

type SoundType = 'vote' | 'milestone' | 'error';

class SoundManager {
  private audioContext: AudioContext | null = null;
  private enabled: boolean = true;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (!this.audioContext) {
      try {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch {
        console.warn('Web Audio API not supported');
        return null;
      }
    }
    return this.audioContext;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (typeof window !== 'undefined') {
      localStorage.setItem('soundEffectsEnabled', String(enabled));
    }
  }

  isEnabled(): boolean {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('soundEffectsEnabled');
      if (stored !== null) {
        this.enabled = stored === 'true';
      }
    }
    return this.enabled;
  }

  private playTone(frequency: number, duration: number, type: OscillatorType = 'sine', gain: number = 0.3) {
    const ctx = this.getContext();
    if (!ctx || !this.isEnabled()) return;

    // Resume context if suspended (required for autoplay policy)
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

    // Fade in/out for smooth sound
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.02);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  }

  play(sound: SoundType) {
    if (!this.isEnabled()) return;

    switch (sound) {
      case 'vote':
        // Quick, satisfying pop sound
        this.playTone(880, 0.1, 'sine', 0.2);
        setTimeout(() => this.playTone(1100, 0.08, 'sine', 0.15), 50);
        break;

      case 'milestone':
        // Celebratory chime
        this.playTone(523, 0.15, 'sine', 0.25);
        setTimeout(() => this.playTone(659, 0.15, 'sine', 0.25), 100);
        setTimeout(() => this.playTone(784, 0.15, 'sine', 0.25), 200);
        setTimeout(() => this.playTone(1047, 0.25, 'sine', 0.3), 300);
        break;

      case 'error':
        // Low buzz for error
        this.playTone(200, 0.15, 'sawtooth', 0.15);
        setTimeout(() => this.playTone(150, 0.2, 'sawtooth', 0.1), 100);
        break;
    }
  }
}

// Singleton instance
export const sounds = new SoundManager();
