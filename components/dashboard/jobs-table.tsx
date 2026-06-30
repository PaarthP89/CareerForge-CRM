'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink } from 'lucide-react';
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
import ResumeCell from '@/components/dashboard/resume-cell';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function JobsTable({ initialJobs }: { initialJobs: Job[] }) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [activeTab, setActiveTab] = useState<JobStream>('internship');
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

  const internships = jobs.filter((j) => j.stream === 'internship');
  const newGrad = jobs.filter((j) => j.stream === 'new_grad');

  function renderTable(subset: Job[]) {
    if (subset.length === 0) {
      return (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          No jobs here yet. Seed via{' '}
          <code className="ml-1 font-mono text-xs bg-muted px-1 py-0.5 rounded">
            POST /api/seed?user_id=&lt;uuid&gt;
          </code>
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
            <TableHead className="w-20 text-center">Applied</TableHead>
            <TableHead className="w-32">Resume</TableHead>
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
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`Open ${job.title} at ${job.company} job listing`}
                >
                  <ExternalLink className="size-4" />
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Badge variant="secondary">
          {internships.length} internship{internships.length !== 1 ? 's' : ''}
        </Badge>
        <Badge variant="secondary">
          {newGrad.length} new grad{newGrad.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => value && setActiveTab(value as JobStream)}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="internship">Internships</TabsTrigger>
          <TabsTrigger value="new_grad">New Grad</TabsTrigger>
        </TabsList>

        <TabsContent value="internship">{renderTable(internships)}</TabsContent>
        <TabsContent value="new_grad">{renderTable(newGrad)}</TabsContent>
      </Tabs>
    </div>
  );
}
