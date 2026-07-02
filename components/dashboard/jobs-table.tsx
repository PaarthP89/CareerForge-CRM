'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, Trash2, RotateCcw } from 'lucide-react';
import type { Job, JobStream } from '@/types';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import ResumeCell from '@/components/dashboard/resume-cell';
import AddJobDialog from '@/components/dashboard/add-job-dialog';

type ViewTab = JobStream | 'trash';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function JobsTable({
  initialJobs,
  initialTrash,
}: {
  initialJobs: Job[];
  initialTrash: Job[];
}) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [trash, setTrash] = useState<Job[]>(initialTrash);
  const [activeTab, setActiveTab] = useState<ViewTab>('internship');
  const [pendingIds, setPendingIds] = useState(new Set<string>());
  const inFlightRef = useRef(new Set<string>());

  async function handleAppliedChange(jobId: string, newValue: boolean) {
    if (inFlightRef.current.has(jobId)) return;

    inFlightRef.current.add(jobId);
    setPendingIds((prev) => new Set([...prev, jobId]));
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, applied: newValue } : j))
    );

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
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, applied: !newValue } : j))
      );
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
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, resume_file_path: path } : j))
    );
  }

  async function handleDelete(job: Job) {
    if (inFlightRef.current.has(job.id)) return;
    inFlightRef.current.add(job.id);

    setJobs((prev) => prev.filter((j) => j.id !== job.id));
    setTrash((prev) => [{ ...job, deleted_at: new Date().toISOString() }, ...prev]);

    try {
      const res = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = (await res.json()) as { error?: string };
        throw new Error(payload.error ?? 'Delete failed');
      }
      toast.success('Job moved to trash', {
        action: { label: 'Undo', onClick: () => handleRestore(job) },
      });
    } catch (err) {
      setTrash((prev) => prev.filter((j) => j.id !== job.id));
      setJobs((prev) => [job, ...prev]);
      toast.error(err instanceof Error ? err.message : 'Failed to delete job');
    } finally {
      inFlightRef.current.delete(job.id);
    }
  }

  async function handleRestore(job: Job) {
    if (inFlightRef.current.has(job.id)) return;
    inFlightRef.current.add(job.id);

    setTrash((prev) => prev.filter((j) => j.id !== job.id));
    setJobs((prev) => [{ ...job, deleted_at: null }, ...prev]);

    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
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
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      setTrash((prev) => [job, ...prev]);
      toast.error(err instanceof Error ? err.message : 'Failed to restore job');
    } finally {
      inFlightRef.current.delete(job.id);
    }
  }

  function handleCreated(job: Job) {
    setJobs((prev) => [job, ...prev]);
    setActiveTab(job.stream);
  }

  const internships = jobs.filter((j) => j.stream === 'internship');
  const newGrad = jobs.filter((j) => j.stream === 'new_grad');

  function renderTable(subset: Job[], mode: 'active' | 'trash') {
    if (subset.length === 0) {
      return (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          {mode === 'trash' ? (
            'Nothing in the trash.'
          ) : (
            <>
              No jobs here yet. Seed via{' '}
              <code className="ml-1 font-mono text-xs bg-muted px-1 py-0.5 rounded">
                POST /api/seed?user_id=&lt;uuid&gt;
              </code>
            </>
          )}
        </div>
      );
    }

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-36">Company</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="w-28">Posted</TableHead>
            <TableHead className="w-28">Discovered</TableHead>
            {mode === 'active' && (
              <>
                <TableHead className="w-20 text-center">Applied</TableHead>
                <TableHead className="w-32">Resume</TableHead>
              </>
            )}
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {subset.map((job) => (
            <TableRow key={job.id}>
              <TableCell className="font-medium">{job.company}</TableCell>
              <TableCell className="text-muted-foreground">{job.title}</TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {formatDate(job.posted_at)}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {formatDate(job.discovered_at)}
              </TableCell>
              {mode === 'active' ? (
                <>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={job.applied}
                      onCheckedChange={(checked) =>
                        handleAppliedChange(job.id, checked)
                      }
                      disabled={pendingIds.has(job.id)}
                      aria-label={`Mark ${job.title} at ${job.company} as applied`}
                    />
                  </TableCell>
                  <TableCell>
                    <ResumeCell job={job} onUploaded={handleResumeUploaded} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={`Open ${job.title} at ${job.company} job listing`}
                      >
                        <ExternalLink className="size-4" />
                      </a>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${job.title} at ${job.company}`}
                        onClick={() => handleDelete(job)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </>
              ) : (
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    aria-label={`Restore ${job.title} at ${job.company}`}
                    onClick={() => handleRestore(job)}
                  >
                    <RotateCcw className="size-4" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            {internships.length} internship{internships.length !== 1 ? 's' : ''}
          </Badge>
          <Badge variant="secondary">
            {newGrad.length} new grad{newGrad.length !== 1 ? 's' : ''}
          </Badge>
        </div>
        <AddJobDialog onCreated={handleCreated} />
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => value && setActiveTab(value as ViewTab)}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="internship">Internships</TabsTrigger>
          <TabsTrigger value="new_grad">New Grad</TabsTrigger>
          <TabsTrigger value="trash">Trash</TabsTrigger>
        </TabsList>

        <TabsContent value="internship">{renderTable(internships, 'active')}</TabsContent>
        <TabsContent value="new_grad">{renderTable(newGrad, 'active')}</TabsContent>
        <TabsContent value="trash">{renderTable(trash, 'trash')}</TabsContent>
      </Tabs>
    </div>
  );
}
