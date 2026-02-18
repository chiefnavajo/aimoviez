// Tests for useCountdown hook
// Verifies countdown logic, expiry, formatted output, null target

import { renderHook, act } from '@testing-library/react';
import { useCountdown } from '@/hooks/useCountdown';

describe('useCountdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns correct countdown for a future date', () => {
    // Target is 2 hours, 30 minutes, 15 seconds from now
    const now = Date.now();
    const target = new Date(now + 2 * 60 * 60 * 1000 + 30 * 60 * 1000 + 15 * 1000);

    const { result } = renderHook(() => useCountdown(target));

    expect(result.current.isExpired).toBe(false);
    expect(result.current.hours).toBe(2);
    expect(result.current.minutes).toBe(30);
    expect(result.current.seconds).toBe(15);
  });

  it('returns expired for a past date', () => {
    const pastDate = new Date(Date.now() - 10000);

    const { result } = renderHook(() => useCountdown(pastDate));

    expect(result.current.isExpired).toBe(true);
    expect(result.current.hours).toBe(0);
    expect(result.current.minutes).toBe(0);
    expect(result.current.seconds).toBe(0);
    expect(result.current.formatted).toBe('00:00:00');
  });

  it('returns expired for null target', () => {
    const { result } = renderHook(() => useCountdown(null));

    expect(result.current.isExpired).toBe(true);
    expect(result.current.formatted).toBe('00:00:00');
  });

  it('produces formatted output in HH:MM:SS', () => {
    const now = Date.now();
    // 1 hour, 5 minutes, 9 seconds
    const target = new Date(now + 1 * 60 * 60 * 1000 + 5 * 60 * 1000 + 9 * 1000);

    const { result } = renderHook(() => useCountdown(target));

    expect(result.current.formatted).toBe('01:05:09');
  });

  it('counts down when time advances', () => {
    const now = Date.now();
    // 1 minute and 30 seconds from now
    const target = new Date(now + 90 * 1000);

    const { result } = renderHook(() => useCountdown(target));

    // Initially: 0 hours, 1 minute, 30 seconds
    expect(result.current.minutes).toBe(1);
    expect(result.current.seconds).toBe(30);
    expect(result.current.isExpired).toBe(false);

    // Advance time by 30 seconds
    act(() => {
      jest.advanceTimersByTime(30 * 1000);
    });

    // Should be 0 hours, 1 minute, 0 seconds
    expect(result.current.minutes).toBe(1);
    expect(result.current.seconds).toBe(0);
    expect(result.current.isExpired).toBe(false);

    // Advance past expiry (61 more seconds)
    act(() => {
      jest.advanceTimersByTime(61 * 1000);
    });

    expect(result.current.isExpired).toBe(true);
    expect(result.current.formatted).toBe('00:00:00');
  });
});
