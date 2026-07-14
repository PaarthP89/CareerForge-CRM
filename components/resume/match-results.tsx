'use client';

import { Fragment, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, ChevronDown, ChevronUp, ExternalLink, Trash2 } from 'lucide-react';
import type { Job } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import ResumeCell from '@/components/dashboard/resume-cell';
import JobComparePanel from '@/components/resume/job-compare-panel';

interface MatchRow {
  id: string;
  job_id: string;
  score: number;
  reasoning: string | null;
  matched_at: string;
  jobs: Job | null;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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

export default function MatchResults({ initialMatches }: { initialMatches: MatchRow[] }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [matches, setMatches] = useState(initialMatches);
  const [syncedInitialMatches, setSyncedInitialMatches] = useState(initialMatches);
  const [pendingIds, setPendingIds] = useState(new Set<string>());
  const inFlightRef = useRef(new Set<string>());

  if (initialMatches !== syncedInitialMatches) {
    setSyncedInitialMatches(initialMatches);
    setMatches(initialMatches);
  }

  function updateJob(jobId: string, patch: Partial<Job>) {
    setMatches((prev) =>
      prev.map((m) => (m.job_id === jobId && m.jobs ? { ...m, jobs: { ...m.jobs, ...patch } } : m))
    );
  }

  async function handleAppliedChange(jobId: string, newValue: boolean) {
    if (inFlightRef.current.has(jobId)) return;

    inFlightRef.current.add(jobId);
    setPendingIds((prev) => new Set([...prev, jobId]));
    updateJob(jobId, { applied: newValue });

    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applied: newValue }),
      });

      if (!res.ok) {
        const payload = (await res.json()) as { error?: string };
        throw new Error(payload.error ?? 'Update failed');
      }
    } catch (err) {
      updateJob(jobId, { applied: !newValue });
      toast.error(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      inFlightRef.current.delete(jobId);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  }

  function handleResumeUploaded(jobId: string, path: string) {
    updateJob(jobId, { resume_file_path: path });
  }

  async function handleDelete(match: MatchRow) {
    const jobId = match.job_id;
    if (inFlightRef.current.has(jobId)) return;
    inFlightRef.current.add(jobId);

    setMatches((prev) => prev.filter((m) => m.job_id !== jobId));

    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = (await res.json()) as { error?: string };
        throw new Error(payload.error ?? 'Delete failed');
      }
      toast.success('Job moved to trash', {
        action: { label: 'Undo', onClick: () => handleRestore(match) },
      });
    } catch (err) {
      setMatches((prev) => [match, ...prev]);
      toast.error(err instanceof Error ? err.message : 'Failed to delete job');
    } finally {
      inFlightRef.current.delete(jobId);
    }
  }

  async function handleRestore(match: MatchRow) {
    const jobId = match.job_id;
    if (inFlightRef.current.has(jobId)) return;
    inFlightRef.current.add(jobId);

    setMatches((prev) => [match, ...prev]);

    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restore: true }),
      });
      if (!res.ok) {
        const payload = (await res.json()) as { error?: string };
        throw new Error(payload.error ?? 'Restore failed');
      }
      toast.success('Job restored');
    } catch (err) {
      setMatches((prev) => prev.filter((m) => m.job_id !== jobId));
      toast.error(err instanceof Error ? err.message : 'Failed to restore job');
    } finally {
      inFlightRef.current.delete(jobId);
    }
  }

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

  function toggleExpanded(jobId: string) {
    setExpandedJobId((current) => (current === jobId ? null : jobId));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {matches.length} scored job{matches.length !== 1 ? 's' : ''}
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

      {matches.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          No matches yet. Save your resume above, then click &ldquo;Run Match&rdquo; to score
          your active jobs against it.
        </div>
      ) : (
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">Company</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-24">Posted</TableHead>
              <TableHead className="w-24">Discovered</TableHead>
              <TableHead className="w-20 text-center">Applied</TableHead>
              <TableHead className="w-32">Resume</TableHead>
              <TableHead className="w-10">Link</TableHead>
              <TableHead className="w-20">Score</TableHead>
              <TableHead>Reasoning</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {matches.map((match) => {
              const isExpanded = expandedJobId === match.job_id;
              const job = match.jobs;
              return (
                <Fragment key={match.id}>
                  <TableRow>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {job?.company ?? '—'}
                        {job?.url_quality === 'generic' && (
                          <Badge
                            variant="outline"
                            className="text-amber-600 border-amber-600/40 dark:text-amber-400 dark:border-amber-400/40"
                            title="Sweep found this link points to a generic careers page, not the specific posting"
                          >
                            Unverified link
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{job?.title ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDate(job?.posted_at ?? null)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDate(job?.discovered_at ?? null)}
                    </TableCell>
                    <TableCell className="text-center">
                      {job && (
                        <Checkbox
                          checked={job.applied}
                          onCheckedChange={(checked) => handleAppliedChange(match.job_id, checked)}
                          disabled={pendingIds.has(match.job_id)}
                          aria-label={`Mark ${job.title} at ${job.company} as applied`}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {job && <ResumeCell job={job} onUploaded={handleResumeUploaded} />}
                    </TableCell>
                    <TableCell>
                      {job && (
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={`Open ${job.title} at ${job.company} job listing`}
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={scoreBadgeVariant(match.score)}>{match.score}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {match.reasoning ?? '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-expanded={isExpanded}
                          aria-label="Deep-compare against this job"
                          title="Deep-compare against this job"
                          onClick={() => toggleExpanded(match.job_id)}
                        >
                          {isExpanded ? (
                            <ChevronUp className="size-4" />
                          ) : (
                            <ChevronDown className="size-4" />
                          )}
                        </Button>
                        {job && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            aria-label={`Delete ${job.title} at ${job.company}`}
                            onClick={() => handleDelete(match)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={10} className="bg-muted/30">
                        <JobComparePanel jobId={match.job_id} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
        </div>
      )}
    </div>
  );
}
