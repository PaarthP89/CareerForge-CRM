'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, GitCompare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface MatchRow {
  id: string;
  job_id: string;
  score: number;
  reasoning: string | null;
  matched_at: string;
  jobs: { title: string; company: string } | null;
}

interface RunSummary {
  totalJobs: number;
  prefiltered: number;
  scored: number;
  failedBatches: number;
}

function scoreBadgeVariant(score: number): 'default' | 'secondary' | 'destructive' {
  if (score >= 70) return 'default';
  if (score >= 40) return 'secondary';
  return 'destructive';
}

export default function MatchesList({ initialMatches }: { initialMatches: MatchRow[] }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);

  async function handleRun() {
    setRunning(true);
    setError(null);
    setSummary(null);

    try {
      const res = await fetch('/api/resume/match', { method: 'POST' });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error ?? 'Match run failed');
      }
      setSummary(payload as RunSummary);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Match run failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {initialMatches.length} scored job{initialMatches.length !== 1 ? 's' : ''}
        </p>
        <Button size="sm" onClick={handleRun} disabled={running}>
          {running ? (
            <>
              <Loader2 className="size-4 animate-spin mr-1.5" />
              Running…
            </>
          ) : (
            'Run Match'
          )}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {summary && (
        <p className="text-xs text-muted-foreground">
          Scored {summary.scored} of {summary.totalJobs} active jobs ({summary.prefiltered}{' '}
          survived pre-filter{summary.failedBatches > 0 ? `, ${summary.failedBatches} batches failed` : ''}
          ).
        </p>
      )}

      {initialMatches.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          No matches yet. Click &ldquo;Run Match&rdquo; to score your active jobs against your
          resume.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">Company</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-24">Score</TableHead>
              <TableHead>Reasoning</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialMatches.map((match) => (
              <TableRow key={match.id}>
                <TableCell className="font-medium">{match.jobs?.company ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">
                  {match.jobs?.title ?? '—'}
                </TableCell>
                <TableCell>
                  <Badge variant={scoreBadgeVariant(match.score)}>{match.score}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {match.reasoning ?? '—'}
                </TableCell>
                <TableCell>
                  <a
                    href={`/resume?jobId=${match.job_id}`}
                    className="inline-flex text-muted-foreground hover:text-foreground transition-colors"
                    title="Deep-compare against this job"
                  >
                    <GitCompare className="size-4" />
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
