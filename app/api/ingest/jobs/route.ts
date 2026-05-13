import { NextResponse } from 'next/server';
import { ingestQueueEnabled, listIngestQueueJobs } from '@/lib/jobs/ingest-queue';

export async function GET() {
  try {
    if (!ingestQueueEnabled()) {
      return NextResponse.json({ queueEnabled: false, jobs: [] as const });
    }
    const jobs = await listIngestQueueJobs();
    return NextResponse.json({ queueEnabled: true, jobs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, queueEnabled: true, jobs: [] }, { status: 500 });
  }
}
