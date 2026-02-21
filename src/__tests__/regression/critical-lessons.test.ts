/**
 * @jest-environment node
 *
 * CRITICAL LESSONS REGRESSION TESTS
 * Each test encodes a specific lesson learned from deep code analysis.
 * Tests document the bug, root cause, and the pattern to watch for.
 *
 * These tests focus on patterns that unit tests cannot catch:
 *   - Parent-child callback contracts
 *   - Async lifecycle hazards
 *   - React state timing issues
 *   - Database query gotchas
 */

// ============================================================================
// LESSON 1: Parent callback must not unmount child mid-async-flow
// ============================================================================
/**
 * Bug: UserCharacterUploadModal had Phase 2 (guided angle capture) that was
 * dead code — it never rendered because the parent's onCreated callback
 * called setShowUploadModal(false), unmounting the modal before Phase 2.
 *
 * Root cause: Parent state update in callback removed child from render tree.
 * Discovery: Opus deep code analysis (unit tests passed because they mocked
 *   the parent, so onCreated was a no-op jest.fn())
 * Pattern to watch: Any modal/child that calls onCreated/onSubmit/onSave
 *   DURING its flow (not at the end) where parent might close it.
 *
 * Fix: onCreated does update-or-insert without closing. Child controls its
 *   own lifecycle via onClose.
 */

// ============================================================================
// LESSON 2: setTimeout after callback creates double-unmount risk
// ============================================================================
/**
 * Bug: CharacterReferenceSuggestModal calls onSubmitted() then
 * setTimeout(() => onClose(), 2000). If parent's onSubmitted handler
 * unmounts the modal, the timeout fires on an unmounted component.
 *
 * Root cause: Two separate unmount triggers — callback + delayed cleanup.
 * Discovery: Opus pattern analysis
 * Pattern to watch: Any code that does callback() + setTimeout(cleanup, N)
 *   where callback could trigger parent unmount.
 *
 * Fix: The pattern is safe only if: (a) parent doesn't unmount on callback,
 *   or (b) setTimeout is cleared on unmount via useEffect cleanup.
 */

// ============================================================================
// LESSON 3: useEffect([]) captures stale state for cleanup
// ============================================================================
/**
 * Bug: useEffect(() => { return () => URL.revokeObjectURL(previewUrl); }, [])
 * captures the initial null value of previewUrl. On unmount, it revokes null
 * instead of the actual URL, causing a memory leak.
 *
 * Root cause: Empty dependency array means cleanup closure sees initial state.
 * Discovery: Opus analysis of UserCharacterUploadModal
 * Pattern to watch: Any useEffect with [] deps that references state in cleanup.
 *
 * Fix: Track the value in a ref (previewUrlRef) and revoke via ref in cleanup.
 *   Refs are mutable — the cleanup always sees the latest value.
 */

// ============================================================================
// TESTS
// ============================================================================

// Lightweight mocks for pattern verification
const mockCreateClient = jest.fn();
jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));

import { createSupabaseChain } from '../helpers/api-test-utils';

describe('Critical Lessons — Pattern Regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  // --------------------------------------------------------------------------
  // LESSON 1: Update-or-insert pattern for onCreated (no unmount)
  // --------------------------------------------------------------------------
  test('LESSON: update-or-insert pattern does not duplicate on re-call with same ID', () => {
    /**
     * The fix for the parent-child unmount bug uses this pattern:
     *   setCharacters(prev => {
     *     const exists = prev.some(c => c.id === newChar.id);
     *     if (exists) return prev.map(c => c.id === newChar.id ? newChar : c);
     *     return [newChar, ...prev];
     *   });
     *
     * This test verifies the pattern works correctly when called multiple
     * times with the same character ID (which happens during Phase 2 angle uploads).
     */
    const updateOrInsert = (
      prev: Array<{ id: string; name: string; refs: number }>,
      newChar: { id: string; name: string; refs: number }
    ) => {
      const exists = prev.some(c => c.id === newChar.id);
      if (exists) return prev.map(c => c.id === newChar.id ? newChar : c);
      return [newChar, ...prev];
    };

    // First call: insert
    let chars: Array<{ id: string; name: string; refs: number }> = [];
    chars = updateOrInsert(chars, { id: 'char-1', name: 'Hero', refs: 0 });
    expect(chars).toHaveLength(1);
    expect(chars[0]).toEqual({ id: 'char-1', name: 'Hero', refs: 0 });

    // Second call with same ID: update (not duplicate)
    chars = updateOrInsert(chars, { id: 'char-1', name: 'Hero', refs: 1 });
    expect(chars).toHaveLength(1); // Still 1, not 2
    expect(chars[0].refs).toBe(1);

    // Third call with same ID: update again
    chars = updateOrInsert(chars, { id: 'char-1', name: 'Hero', refs: 2 });
    expect(chars).toHaveLength(1);
    expect(chars[0].refs).toBe(2);

    // Different ID: insert
    chars = updateOrInsert(chars, { id: 'char-2', name: 'Villain', refs: 0 });
    expect(chars).toHaveLength(2);
  });

  // --------------------------------------------------------------------------
  // LESSON 2: setTimeout + callback double-fire safety
  // --------------------------------------------------------------------------
  test('LESSON: setTimeout after callback can double-fire if not guarded', () => {
    /**
     * Pattern from CharacterReferenceSuggestModal:
     *   onSubmitted();           // fires immediately
     *   setTimeout(() => onClose(), 2000);  // fires after 2s
     *
     * If both onSubmitted and onClose trigger the same parent action
     * (e.g., setShowing(false)), the action fires twice. This test
     * verifies a proper guard pattern.
     */
    jest.useFakeTimers();

    let closedCount = 0;
    let unmounted = false;

    const onSubmitted = () => {
      // Parent might unmount on this callback
      unmounted = true;
    };

    const onClose = () => {
      // Guard: only count if still mounted
      if (!unmounted) closedCount++;
    };

    // Simulate the pattern
    onSubmitted();
    setTimeout(() => onClose(), 2000);

    jest.advanceTimersByTime(2000);

    // onClose should NOT have incremented because unmounted is true
    expect(closedCount).toBe(0);

    jest.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // LESSON 3: Ref-based cleanup vs state-based cleanup
  // --------------------------------------------------------------------------
  test('LESSON: ref tracks latest value for cleanup while state closure is stale', () => {
    /**
     * Bug pattern:
     *   const [url, setUrl] = useState<string | null>(null);
     *   useEffect(() => {
     *     return () => { if (url) URL.revokeObjectURL(url); };
     *   }, []);  // url is captured as null forever
     *
     * Fix pattern:
     *   const urlRef = useRef<string | null>(null);
     *   const [url, setUrl] = useState<string | null>(null);
     *   // When setting:
     *   urlRef.current = newUrl; setUrl(newUrl);
     *   // Cleanup:
     *   useEffect(() => {
     *     return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
     *   }, []);
     */
    // Simulate the stale closure problem
    let capturedUrl: string | null = null;

    // Simulate useEffect with [] capturing initial state
    const setupEffect = (initialUrl: string | null) => {
      capturedUrl = initialUrl; // Closure captures initial value
      return () => capturedUrl; // Cleanup sees captured value
    };

    const cleanup = setupEffect(null);

    // "State" changes later, but closure still has null
    // (This is what happens with useState in a [] effect)
    expect(cleanup()).toBeNull(); // BUG: should revoke the URL but got null

    // Simulate the ref fix
    const ref = { current: null as string | null };
    ref.current = 'blob:new-url'; // Ref always has latest value

    // Cleanup via ref always sees the latest
    expect(ref.current).toBe('blob:new-url'); // FIXED: ref has the real URL
  });

  // --------------------------------------------------------------------------
  // LESSON 4: useRef for double-click guard, not useState
  // --------------------------------------------------------------------------
  test('LESSON: useRef provides synchronous guard while useState is async', () => {
    /**
     * Bug: Rapid double-tap on Save could create two identical characters
     * because useState updates are batched and async.
     *
     *   const [submitting, setSubmitting] = useState(false);
     *   handleSubmit() {
     *     if (submitting) return;  // First click: false, passes
     *     setSubmitting(true);     // Scheduled, not yet applied
     *     // Second click arrives before re-render: still false, passes!
     *     ...
     *   }
     *
     * Fix: submittingRef = useRef(false)
     *   handleSubmit() {
     *     if (submittingRef.current) return; // Synchronous check
     *     submittingRef.current = true;       // Immediate update
     *     ...
     *   }
     */
    // Simulate useState behavior (async)
    let stateValue = false;
    const setState = (v: boolean) => {
      // In React, this doesn't update immediately
      // Simulated: will update on next "render"
      Promise.resolve().then(() => { stateValue = v; });
    };

    // Simulate useRef behavior (synchronous)
    const ref = { current: false };

    // First "click" — both allow
    expect(stateValue).toBe(false); // state: not yet submitting
    expect(ref.current).toBe(false); // ref: not yet submitting

    setState(true);
    ref.current = true;

    // Second "click" before re-render
    // STATE is still false (async update hasn't happened)
    expect(stateValue).toBe(false); // BUG: would allow double submit!
    // REF is already true (synchronous)
    expect(ref.current).toBe(true); // FIXED: blocks double submit
  });

  // --------------------------------------------------------------------------
  // LESSON 5: Polling setTimeout must be cleared on unmount
  // --------------------------------------------------------------------------
  test('LESSON: clearTimeout in useEffect cleanup prevents zombie polls', () => {
    /**
     * Bug: AIGeneratePanel's polling loop uses setTimeout for adaptive intervals.
     * Without cleanup, the timeout fires after unmount, calling setStage on
     * an unmounted component.
     *
     * Pattern:
     *   const pollRef = useRef<NodeJS.Timeout | null>(null);
     *   useEffect(() => {
     *     pollRef.current = setTimeout(schedulePoll, interval);
     *     return () => { if (pollRef.current) clearTimeout(pollRef.current); };
     *   }, [generationId, stage]);
     */
    jest.useFakeTimers();

    const pollRef = { current: null as NodeJS.Timeout | null };
    let unmounted = false;
    let pollCount = 0;

    const schedulePoll = () => {
      if (unmounted) return; // Guard in production
      pollCount++;
      pollRef.current = setTimeout(schedulePoll, 1000);
    };

    // Start polling
    pollRef.current = setTimeout(schedulePoll, 1000);

    // Poll fires twice
    jest.advanceTimersByTime(2500);
    expect(pollCount).toBe(2);

    // Simulate unmount cleanup
    unmounted = true;
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;

    // Advance time — no more polls
    jest.advanceTimersByTime(5000);
    expect(pollCount).toBe(2); // Still 2, no zombie polls

    jest.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // LESSON 6: AbortController must abort in useEffect cleanup
  // --------------------------------------------------------------------------
  test('LESSON: AbortController.abort() cancels in-flight fetch on unmount', async () => {
    /**
     * Bug: Pre-download video blob fetch continues after unmount, creating
     * a zombie blob URL that's never revoked.
     *
     * Fix:
     *   useEffect(() => {
     *     const controller = new AbortController();
     *     fetch(url, { signal: controller.signal }).then(...);
     *     return () => { controller.abort(); };
     *   }, [url]);
     */
    const controller = new AbortController();
    let fetchCompleted = false;

    const fetchPromise = new Promise<void>((resolve, reject) => {
      controller.signal.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
      setTimeout(() => {
        fetchCompleted = true;
        resolve();
      }, 5000);
    });

    // Simulate unmount — abort the fetch
    controller.abort();

    try {
      await fetchPromise;
    } catch (e) {
      expect(e).toBeInstanceOf(DOMException);
    }

    // Fetch did NOT complete
    expect(fetchCompleted).toBe(false);
  });

  // --------------------------------------------------------------------------
  // LESSON 7: .maybeSingle() returns null with multiple results
  // --------------------------------------------------------------------------
  test('LESSON: .maybeSingle() silently returns null when 2+ rows match', () => {
    /**
     * Bug: When 2 active seasons exist (one per genre), queries like:
     *   .from('seasons').eq('status', 'active').maybeSingle()
     * return null instead of an error. This silently breaks "find the
     * active season" queries.
     *
     * Fix: Use .limit(1) with explicit ordering:
     *   .from('seasons').eq('status', 'active')
     *   .order('created_at', { ascending: false }).limit(1)
     */
    // Simulate maybeSingle behavior
    const maybeSingle = (rows: unknown[]) => {
      if (rows.length === 0) return { data: null, error: null };
      if (rows.length === 1) return { data: rows[0], error: null };
      // 2+ rows: returns null (NOT an error!)
      return { data: null, error: null };
    };

    const twoSeasons = [
      { id: 'season-1', genre: 'action' },
      { id: 'season-2', genre: 'comedy' },
    ];

    // BUG: 2 rows → null
    const result = maybeSingle(twoSeasons);
    expect(result.data).toBeNull();
    expect(result.error).toBeNull(); // No error to catch!

    // FIX: limit(1) always works
    const limitOne = (rows: unknown[]) => {
      if (rows.length === 0) return { data: [], error: null };
      return { data: [rows[0]], error: null };
    };

    const fixedResult = limitOne(twoSeasons);
    expect(fixedResult.data).toHaveLength(1);
    expect(fixedResult.data![0]).toEqual({ id: 'season-1', genre: 'action' });
  });

  // --------------------------------------------------------------------------
  // LESSON 8: requireCsrf() is async — must await
  // --------------------------------------------------------------------------
  test('LESSON: unawaited async function returns truthy Promise, blocking all requests', () => {
    /**
     * Bug: requireCsrf() returns Promise<NextResponse | null>.
     * Without await:
     *   const csrfError = requireCsrf(req);  // Promise object (truthy!)
     *   if (csrfError) return csrfError;      // ALWAYS returns early
     *
     * This blocked ALL POST/DELETE requests on suggestion routes.
     *
     * Fix: const csrfError = await requireCsrf(req);
     */
    const asyncFn = async (): Promise<string | null> => {
      return null; // Function returns null (no error)
    };

    // BUG: Without await, the variable is a Promise (truthy)
    const withoutAwait = asyncFn();
    expect(!!withoutAwait).toBe(true); // Promise is truthy!

    // A naive if-check would always trigger
    let blocked = false;
    if (withoutAwait) {
      blocked = true; // Always executes — BUG!
    }
    expect(blocked).toBe(true);

    // FIX: With await, null is falsy
    const withAwait = async () => {
      const result = await asyncFn();
      return !!result;
    };

    return withAwait().then(result => {
      expect(result).toBe(false); // null is falsy — FIXED
    });
  });
});
