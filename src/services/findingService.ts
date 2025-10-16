import { eq, desc } from 'drizzle-orm';
import { db, findings, type Finding, type NewFinding } from '../db';

export class FindingService {
  async createFinding(url: string): Promise<Finding> {
    const newFinding: NewFinding = {
      url,
      status: 'pending',
    };

    const [result] = await db.insert(findings).values(newFinding).returning();
    return result;
  }

  async getFindingById(id: string): Promise<Finding | undefined> {
    const [result] = await db.select().from(findings).where(eq(findings.id, id));
    return result;
  }

  async updateFindingStatus(id: string, status: string): Promise<void> {
    await db.update(findings).set({ status, updatedAt: new Date() }).where(eq(findings.id, id));
  }

  async listFindings(limit = 100, offset = 0): Promise<Finding[]> {
    const results = await db
      .select()
      .from(findings)
      .orderBy(desc(findings.createdAt))
      .limit(limit)
      .offset(offset);

    return results;
  }
}

export const findingService = new FindingService();
