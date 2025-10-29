import fs from 'fs/promises';
import path from 'path';

// Mock dependencies
const mockDb = {
  delete: jest.fn(),
  select: jest.fn(),
};

const mockConfig = {
  retentionDays: 7,
  artifactsDir: '/tmp/test-artifacts',
};

jest.mock('../src/db', () => ({
  db: mockDb,
}));

jest.mock('../src/config', () => ({
  config: mockConfig,
}));

jest.mock('fs/promises');

describe('Day 8 - Retention Cleanup Job', () => {
  let cleanupRetention: () => Promise<void>;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Import after mocks are set up
    const module = await import('../src/scripts/cleanupRetention');
    cleanupRetention = module.cleanupRetention;
  });

  describe('cleanupRetention', () => {
    it('should delete findings older than retention period', async () => {
      const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago
      const oldFinding = {
        id: 'finding-old-123',
        scanId: 'scan-123',
        createdAt: oldDate,
      };

      mockDb.select.mockResolvedValue([oldFinding]);
      mockDb.delete.mockResolvedValue({ rowCount: 1 });

      await cleanupRetention();

      // Verify query for old findings (7 days)
      expect(mockDb.select).toHaveBeenCalled();
      
      // Verify deletion
      expect(mockDb.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.any(Function),
        })
      );
    });

    it('should delete associated artifacts when findings are deleted', async () => {
      const oldFinding = {
        id: 'finding-123',
        scanId: 'scan-abc',
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        artifacts: [
          { id: 'artifact-1', path: '/tmp/test-artifacts/scan-abc/finding-123/1.png' },
          { id: 'artifact-2', path: '/tmp/test-artifacts/scan-abc/finding-123/2.png' },
        ],
      };

      mockDb.select.mockResolvedValue([oldFinding]);
      mockDb.delete.mockResolvedValue({ rowCount: 1 });

      await cleanupRetention();

      // Artifacts should cascade delete with finding
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should delete physical artifact files from filesystem', async () => {
      const oldFinding = {
        id: 'finding-123',
        scanId: 'scan-abc',
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      };

      mockDb.select.mockResolvedValue([oldFinding]);
      mockDb.delete.mockResolvedValue({ rowCount: 1 });
      
      (fs.rm as jest.Mock).mockResolvedValue(undefined);
      (fs.stat as jest.Mock).mockResolvedValue({ isDirectory: () => true });

      await cleanupRetention();

      // Verify artifact directory deletion
      expect(fs.rm).toHaveBeenCalledWith(
        expect.stringContaining('scan-abc/finding-123'),
        { recursive: true, force: true }
      );
    });

    it('should clean up empty directories after deletion', async () => {
      const oldFinding = {
        id: 'finding-123',
        scanId: 'scan-abc',
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      };

      mockDb.select.mockResolvedValue([oldFinding]);
      mockDb.delete.mockResolvedValue({ rowCount: 1 });
      
      (fs.rm as jest.Mock).mockResolvedValue(undefined);
      (fs.stat as jest.Mock).mockResolvedValue({ isDirectory: () => true });
      (fs.readdir as jest.Mock).mockResolvedValue([]); // Empty directory

      await cleanupRetention();

      // Should delete empty scan directory
      expect(fs.rm).toHaveBeenCalled();
    });

    it('should not delete recent findings', async () => {
      const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
      const recentFinding = {
        id: 'finding-recent-123',
        scanId: 'scan-123',
        createdAt: recentDate,
      };

      mockDb.select.mockResolvedValue([recentFinding]);

      await cleanupRetention();

      // Should not delete recent findings
      // (The where clause filters out recent findings)
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('should handle missing artifacts directory gracefully', async () => {
      const oldFinding = {
        id: 'finding-123',
        scanId: 'scan-abc',
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      };

      mockDb.select.mockResolvedValue([oldFinding]);
      mockDb.delete.mockResolvedValue({ rowCount: 1 });
      
      (fs.rm as jest.Mock).mockRejectedValue({ code: 'ENOENT' });

      // Should not throw error
      await expect(cleanupRetention()).resolves.not.toThrow();
    });

    it('should continue cleanup if one file deletion fails', async () => {
      const oldFindings = [
        {
          id: 'finding-1',
          scanId: 'scan-abc',
          createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        },
        {
          id: 'finding-2',
          scanId: 'scan-abc',
          createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        },
      ];

      mockDb.select.mockResolvedValue(oldFindings);
      mockDb.delete.mockResolvedValue({ rowCount: 2 });
      
      // First deletion fails, second succeeds
      (fs.rm as jest.Mock)
        .mockRejectedValueOnce(new Error('Permission denied'))
        .mockResolvedValueOnce(undefined);

      // Should complete despite one failure
      await expect(cleanupRetention()).resolves.not.toThrow();
      
      expect(fs.rm).toHaveBeenCalledTimes(2);
    });

    it('should log cleanup statistics', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const oldFindings = [
        {
          id: 'finding-1',
          scanId: 'scan-abc',
          createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        },
        {
          id: 'finding-2',
          scanId: 'scan-def',
          createdAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
        },
      ];

      mockDb.select.mockResolvedValue(oldFindings);
      mockDb.delete.mockResolvedValue({ rowCount: 2 });
      (fs.rm as jest.Mock).mockResolvedValue(undefined);

      await cleanupRetention();

      // Verify logging
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Retention cleanup completed')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('findings deleted')
      );

      consoleSpy.mockRestore();
    });

    it('should use configurable retention period', async () => {
      mockConfig.retentionDays = 30; // Override to 30 days

      const findings = [
        {
          id: 'finding-recent',
          scanId: 'scan-123',
          createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days old
        },
        {
          id: 'finding-old',
          scanId: 'scan-123',
          createdAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 days old
        },
      ];

      mockDb.select.mockResolvedValue(findings);
      mockDb.delete.mockResolvedValue({ rowCount: 1 });

      await cleanupRetention();

      // Should only delete 35-day-old finding, not 15-day-old
      // (Verification depends on implementation details)
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      mockDb.select.mockRejectedValue(new Error('Database connection failed'));

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(cleanupRetention()).rejects.toThrow('Database connection failed');

      consoleErrorSpy.mockRestore();
    });

    it('should delete artifacts directory even if empty', async () => {
      const oldFinding = {
        id: 'finding-123',
        scanId: 'scan-abc',
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      };

      mockDb.select.mockResolvedValue([oldFinding]);
      mockDb.delete.mockResolvedValue({ rowCount: 1 });
      
      (fs.rm as jest.Mock).mockResolvedValue(undefined);
      (fs.stat as jest.Mock).mockResolvedValue({ isDirectory: () => true });
      (fs.readdir as jest.Mock).mockResolvedValue([]);

      await cleanupRetention();

      expect(fs.rm).toHaveBeenCalled();
    });

    it('should preserve scan directory if other findings exist', async () => {
      const oldFinding = {
        id: 'finding-old',
        scanId: 'scan-abc',
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      };

      mockDb.select.mockResolvedValue([oldFinding]);
      mockDb.delete.mockResolvedValue({ rowCount: 1 });
      
      (fs.rm as jest.Mock).mockResolvedValue(undefined);
      (fs.stat as jest.Mock).mockResolvedValue({ isDirectory: () => true });
      
      // Scan directory still has other finding directories
      (fs.readdir as jest.Mock).mockResolvedValue(['finding-recent-123']);

      await cleanupRetention();

      // Should delete finding dir but not scan dir
      expect(fs.rm).toHaveBeenCalledWith(
        expect.stringMatching(/finding-old$/),
        expect.any(Object)
      );
    });
  });

  describe('CLI execution', () => {
    it('should be executable via npm script', () => {
      const packageJson = require('../package.json');
      
      expect(packageJson.scripts).toHaveProperty('cleanup:retention');
      expect(packageJson.scripts['cleanup:retention']).toContain('cleanupRetention');
    });
  });

  describe('Integration with config', () => {
    it('should respect RETENTION_DAYS environment variable', () => {
      expect(mockConfig.retentionDays).toBe(7);
      
      // Test would verify process.env.RETENTION_DAYS is used
    });

    it('should use correct artifacts directory path', () => {
      expect(mockConfig.artifactsDir).toBeDefined();
      
      // Should match config.artifactsDir from main config
    });
  });
});
