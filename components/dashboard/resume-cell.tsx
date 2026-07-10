'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import type { Job } from '@/types';
import { Button } from '@/components/ui/button';

const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export default function ResumeCell({
  job,
  onUploaded,
}: {
  job: Job;
  onUploaded: (jobId: string, path: string) => void;
}) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'downloading'>('idle');
  const inFlightRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const label = `resume for ${job.title} at ${job.company}`;

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.type !== 'application/pdf') {
      toast.error('Resume must be a PDF file');
      return;
    }
    if (file.size > MAX_RESUME_BYTES) {
      toast.error('Resume must be 5MB or smaller');
      return;
    }
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setStatus('uploading');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`/api/jobs/${job.id}/resume`, {
        method: 'POST',
        body: formData,
      });

      const payload = (await res.json()) as { error?: string; path?: string };
      if (!res.ok || !payload.path) {
        throw new Error(payload.error ?? 'Upload failed');
      }

      onUploaded(job.id, payload.path);
      toast.success('Resume uploaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload resume');
    } finally {
      inFlightRef.current = false;
      setStatus('idle');
    }
  }

  async function handleDownload() {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setStatus('downloading');

    try {
      const res = await fetch(`/api/jobs/${job.id}/resume`);
      const payload = (await res.json()) as { error?: string; url?: string };
      if (!res.ok || !payload.url) {
        throw new Error(payload.error ?? 'Failed to get download link');
      }

      window.open(payload.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to download resume');
    } finally {
      inFlightRef.current = false;
      setStatus('idle');
    }
  }

  const busy = status !== 'idle';

  return (
    <div className="flex items-center gap-1">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleFileSelected}
      />
      {job.resume_file_path ? (
        <>
          <Button
            variant="outline"
            size="xs"
            onClick={handleDownload}
            disabled={busy}
            aria-label={`Download ${label}`}
          >
            {status === 'downloading' ? 'Opening…' : 'Download'}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            aria-label={`Replace ${label}`}
          >
            <RefreshCw className="size-3" />
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="xs"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          aria-label={`Upload ${label}`}
        >
          {status === 'uploading' ? 'Uploading…' : 'Upload'}
        </Button>
      )}
    </div>
  );
}
