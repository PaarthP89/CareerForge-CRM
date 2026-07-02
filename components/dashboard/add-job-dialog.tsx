'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { Job, JobStream } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function AddJobDialog({
  onCreated,
}: {
  onCreated: (job: Job) => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [stream, setStream] = useState<JobStream>('internship');
  const [postedAt, setPostedAt] = useState('');

  function resetForm() {
    setCompany('');
    setTitle('');
    setUrl('');
    setStream('internship');
    setPostedAt('');
  }

  async function handleSubmit() {
    if (!company.trim() || !title.trim() || !url.trim()) {
      toast.error('Company, role, and URL are required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: company.trim(),
          title: title.trim(),
          url: url.trim(),
          stream,
          posted_at: postedAt ? new Date(postedAt).toISOString() : null,
        }),
      });

      const payload = (await res.json()) as { job?: Job; error?: string };

      if (!res.ok) {
        throw new Error(payload.error ?? 'Failed to add job');
      }

      onCreated(payload.job as Job);
      toast.success('Job added');
      resetForm();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add job');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Plus className="size-4" />
        Add Job
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Job</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="add-job-company">Company</Label>
            <Input
              id="add-job-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="add-job-title">Role</Label>
            <Input
              id="add-job-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="add-job-url">URL</Label>
            <Input
              id="add-job-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="add-job-stream">Stream</Label>
            <Select
              value={stream}
              onValueChange={(value) => setStream(value as JobStream)}
              disabled={submitting}
            >
              <SelectTrigger id="add-job-stream" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="internship">Internship</SelectItem>
                <SelectItem value="new_grad">New Grad</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="add-job-posted">Posted (optional)</Label>
            <Input
              id="add-job-posted"
              type="date"
              value={postedAt}
              onChange={(e) => setPostedAt(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Adding…' : 'Add Job'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
