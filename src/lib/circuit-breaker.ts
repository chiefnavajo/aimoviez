// lib/circuit-breaker.ts
// ============================================================================
// CIRCUIT BREAKER UTILITY
// Generic circuit breaker for external service calls (Redis, APIs, etc.)
// When a dependency fails repeatedly, stops calling it and uses fallback.
// ============================================================================

import type { CircuitState } from '@/types/vote-queue';

export type { CircuitState };

// ============================================================================
// TYPES
// ============================================================================

export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold: number;
  /** Time (ms) to stay in OPEN state before trying HALF-OPEN (default: 30000) */
  resetTimeoutMs: number;
  /** Number of successful test calls in HALF-OPEN before closing (default: 3) */
  halfOpenMaxAttempts: number;
}

export interface CircuitBreakerOptions {
  /** Unique name for this circuit breaker (used in log prefix) */
  name: string;
  /** Configuration overrides (partial, merged with defaults) */
  config?: Partial<CircuitBreakerConfig>;
  /** Callback invoked when the circuit state changes */
  onStateChange?: (from: CircuitState, to: CircuitState, name: string) => void;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenMaxAttempts: 3,
};

// ============================================================================
// CIRCUIT BREAKER CLASS
// ============================================================================

export class CircuitBreaker {
  private readonly name: string;
  private readonly config: CircuitBreakerConfig;
  private readonly onStateChange?: (from: CircuitState, to: CircuitState, name: string) => void;

  private state: CircuitState = 'closed';
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenSuccessCount: number = 0;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.onStateChange = options.onStateChange;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  getState(): CircuitState {
    // Lazy OPEN -> HALF-OPEN transition (serverless-safe, no timers)
    if (this.state === 'open' && this.shouldAttemptReset()) {
      this.transitionTo('half-open');
    }
    return this.state;
  }

  async execute<T>(
    fn: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'open') {
      this.log('Circuit OPEN, rejecting call');
      if (fallback) {
        return fallback();
      }
      throw new CircuitBreakerError(
        `[CircuitBreaker:${this.name}] Circuit is OPEN — service unavailable`,
        this.name
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();

      if (fallback) {
        this.log('Call failed, using fallback');
        return fallback();
      }
      throw error;
    }
  }

  /** Reset the circuit breaker to its initial CLOSED state */
  reset(): void {
    this.failureCount = 0;
    this.halfOpenSuccessCount = 0;
    this.lastFailureTime = 0;
    if (this.state !== 'closed') {
      this.transitionTo('closed');
    }
  }

  /** Get current statistics for monitoring */
  getStats(): {
    state: CircuitState;
    failureCount: number;
    lastFailureTime: number;
    halfOpenSuccessCount: number;
  } {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      halfOpenSuccessCount: this.halfOpenSuccessCount,
    };
  }

  // --------------------------------------------------------------------------
  // Internal state management
  // --------------------------------------------------------------------------

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.halfOpenSuccessCount++;
      this.log(`HALF-OPEN success ${this.halfOpenSuccessCount}/${this.config.halfOpenMaxAttempts}`);

      if (this.halfOpenSuccessCount >= this.config.halfOpenMaxAttempts) {
        this.failureCount = 0;
        this.halfOpenSuccessCount = 0;
        this.transitionTo('closed');
      }
    } else if (this.state === 'closed') {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      this.halfOpenSuccessCount = 0;
      this.log('HALF-OPEN failure, reopening circuit');
      this.transitionTo('open');
    } else if (this.state === 'closed') {
      this.log(`Failure ${this.failureCount}/${this.config.failureThreshold}`);
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionTo('open');
      }
    }
  }

  private shouldAttemptReset(): boolean {
    return Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs;
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    if (newState === 'half-open') {
      this.halfOpenSuccessCount = 0;
    }

    this.log(`State transition: ${oldState} -> ${newState}`);

    if (this.onStateChange) {
      this.onStateChange(oldState, newState, this.name);
    }
  }

  private log(message: string): void {
    console.log(`[CircuitBreaker:${this.name}] ${message}`);
  }
}

// ============================================================================
// ERROR CLASS
// ============================================================================

export class CircuitBreakerError extends Error {
  public readonly circuitName: string;

  constructor(message: string, circuitName: string) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.circuitName = circuitName;
  }
}
