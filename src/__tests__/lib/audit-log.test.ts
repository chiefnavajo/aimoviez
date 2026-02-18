/**
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE imports
// ---------------------------------------------------------------------------

const mockInsert = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockGte = jest.fn();
const mockLte = jest.fn();
const mockOrder = jest.fn();
const mockRange = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table: string) => {
      if (table === 'audit_logs') {
        return {
          insert: mockInsert,
          select: jest.fn(() => {
            const chain: Record<string, jest.Mock> = {};
            chain.order = mockOrder.mockImplementation(() => chain);
            chain.eq = mockEq.mockImplementation(() => chain);
            chain.gte = mockGte.mockImplementation(() => chain);
            chain.lte = mockLte.mockImplementation(() => chain);
            chain.range = mockRange.mockImplementation(() =>
              Promise.resolve({ data: [], error: null, count: 0 }),
            );
            return chain;
          }),
        };
      }
      return { insert: jest.fn(), select: jest.fn() };
    }),
  })),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { logAdminAction, getAuditLogs, AuditLogEntry } from '@/lib/audit-log';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  headers: Record<string, string> = {},
): NextRequest {
  const req = new NextRequest(new URL('http://localhost:3000/api/admin/test'), {
    headers: new Headers({
      'user-agent': 'TestAgent/1.0',
      ...headers,
    }),
  });
  return req;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
});

describe('audit-log', () => {
  // -----------------------------------------------------------------------
  // logAdminAction
  // -----------------------------------------------------------------------

  describe('logAdminAction', () => {
    it('inserts a log entry with correct fields', async () => {
      mockInsert.mockResolvedValueOnce({ error: null });

      const entry: AuditLogEntry = {
        action: 'approve_clip',
        resourceType: 'clip',
        resourceId: 'clip-42',
        adminId: 'admin-1',
      };

      await logAdminAction(makeRequest(), entry);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      const inserted = mockInsert.mock.calls[0][0];

      expect(inserted.action).toBe('approve_clip');
      expect(inserted.resource_type).toBe('clip');
      expect(inserted.resource_id).toBe('clip-42');
      expect(inserted.admin_id).toBe('admin-1');
      // When adminId is set, admin_email should be null
      expect(inserted.admin_email).toBeNull();
    });

    it('extracts IP from x-forwarded-for header and hashes it', async () => {
      mockInsert.mockResolvedValueOnce({ error: null });

      const req = makeRequest({ 'x-forwarded-for': '203.0.113.50, 10.0.0.1' });

      await logAdminAction(req, {
        action: 'ban_user',
        resourceType: 'user',
        adminId: 'admin-1',
      });

      const inserted = mockInsert.mock.calls[0][0];
      // IP should be hashed (16 hex chars), not the raw IP
      expect(inserted.ip_address).toHaveLength(16);
      expect(inserted.ip_address).not.toBe('203.0.113.50');
    });

    it('truncates user-agent to 200 characters', async () => {
      mockInsert.mockResolvedValueOnce({ error: null });

      const longUA = 'A'.repeat(300);
      const req = makeRequest({ 'user-agent': longUA });

      await logAdminAction(req, {
        action: 'toggle_feature',
        resourceType: 'feature_flag',
        adminId: 'admin-1',
      });

      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.user_agent.length).toBeLessThanOrEqual(200);
    });

    it('redacts sensitive detail fields (adminNotes, reason, email)', async () => {
      mockInsert.mockResolvedValueOnce({ error: null });

      await logAdminAction(makeRequest(), {
        action: 'ban_user',
        resourceType: 'user',
        adminId: 'admin-1',
        details: {
          adminNotes: 'The user sent abusive messages containing PII',
          reason: 'Spam account targeting minors',
          email: 'user@example.com',
          safeField: 'this stays',
        },
      });

      const inserted = mockInsert.mock.calls[0][0];
      const details = inserted.details;

      // adminNotes replaced with hash + length
      expect(details.adminNotes).toBeUndefined();
      expect(details.adminNotes_hash).toBeDefined();
      expect(details.adminNotes_hash).toHaveLength(16);
      expect(details.adminNotes_length).toBe('The user sent abusive messages containing PII'.length);

      // reason replaced with hash + length
      expect(details.reason).toBeUndefined();
      expect(details.reason_hash).toBeDefined();

      // email removed
      expect(details.email).toBeUndefined();

      // safe field preserved
      expect(details.safeField).toBe('this stays');
    });

    it('uses adminEmail when adminId is not provided', async () => {
      mockInsert.mockResolvedValueOnce({ error: null });

      await logAdminAction(makeRequest(), {
        action: 'advance_slot',
        resourceType: 'slot',
        adminEmail: 'admin@example.com',
      });

      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.admin_id).toBeNull();
      expect(inserted.admin_email).toBe('admin@example.com');
    });

    it('does not throw when Supabase insert fails', async () => {
      mockInsert.mockResolvedValueOnce({ error: { message: 'DB error' } });

      await expect(
        logAdminAction(makeRequest(), {
          action: 'delete_clip',
          resourceType: 'clip',
          adminId: 'admin-1',
        }),
      ).resolves.toBeUndefined();
    });

    it('does not throw when an unexpected error occurs', async () => {
      mockInsert.mockRejectedValueOnce(new Error('Network failure'));

      await expect(
        logAdminAction(makeRequest(), {
          action: 'delete_clip',
          resourceType: 'clip',
          adminId: 'admin-1',
        }),
      ).resolves.toBeUndefined();
    });

    it('stores empty object for details when none provided', async () => {
      mockInsert.mockResolvedValueOnce({ error: null });

      await logAdminAction(makeRequest(), {
        action: 'advance_slot',
        resourceType: 'slot',
        adminId: 'admin-1',
      });

      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.details).toEqual({});
    });
  });

  // -----------------------------------------------------------------------
  // getAuditLogs
  // -----------------------------------------------------------------------

  describe('getAuditLogs', () => {
    it('returns logs with default limit of 50', async () => {
      const resolved = { data: [{ id: 1 }], error: null, count: 1 };
      mockRange.mockReturnValueOnce(Promise.resolve(resolved));

      const result = await getAuditLogs();

      expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(mockRange).toHaveBeenCalledWith(0, 49); // offset 0, limit 50
      expect(result.logs).toEqual([{ id: 1 }]);
      expect(result.total).toBe(1);
    });

    it('caps limit at 100 and offset at 10000', async () => {
      mockRange.mockReturnValueOnce(
        Promise.resolve({ data: [], error: null, count: 0 }),
      );

      await getAuditLogs({ limit: 9999, offset: 999999 });

      // limit capped to 100, offset capped to 10000
      expect(mockRange).toHaveBeenCalledWith(10000, 10099);
    });

    it('applies action and resourceType filters', async () => {
      mockRange.mockReturnValueOnce(
        Promise.resolve({ data: [], error: null, count: 0 }),
      );

      await getAuditLogs({ action: 'ban_user', resourceType: 'user' });

      expect(mockEq).toHaveBeenCalledWith('action', 'ban_user');
      expect(mockEq).toHaveBeenCalledWith('resource_type', 'user');
    });

    it('applies date range filters', async () => {
      mockRange.mockReturnValueOnce(
        Promise.resolve({ data: [], error: null, count: 0 }),
      );

      const start = new Date('2026-01-01');
      const end = new Date('2026-01-31');
      await getAuditLogs({ startDate: start, endDate: end });

      expect(mockGte).toHaveBeenCalledWith('created_at', start.toISOString());
      expect(mockLte).toHaveBeenCalledWith('created_at', end.toISOString());
    });

    it('returns empty array when Supabase query fails', async () => {
      mockRange.mockReturnValueOnce(
        Promise.resolve({ data: null, error: { message: 'DB error' }, count: null }),
      );

      const result = await getAuditLogs();
      expect(result).toEqual({ logs: [], total: 0 });
    });
  });
});
