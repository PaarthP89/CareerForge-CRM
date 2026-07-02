'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface CompareResponse {
  score: number;
  reasoning: string;
  missingKeywords: string[];
  jdFetched: boolean;
}

type CompareStatus = 'running' | 'done' | 'error';

function scoreBadgeVariant(score: number): 'default' | 'secondary' | 'destructive' {
  if (score >= 70) return 'default';
  if (score >= 40) return 'secondary';
  return 'destructive';
}

export default function JobComparePanel({
  jobId,
  jobTitle,
  jobCompany,
}: {
  jobId: string;
  jobTitle: string;
  jobCompany: string;
}) {
  const [status, setStatus] = useState<CompareStatus>('running');
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const runIdRef = useRef(0);

  // Only performs the fetch + terminal setState (inside the async .then/.catch);
  // callers are responsible for resetting to 'running' beforehand if needed, so
  // the mount effect below never calls setState synchronously in its own body.
  const performCompare = useCallback((runId: number) => {
    fetch(`/api/resume/match/${jobId}`, { method: 'POST' })
      .then(async (res) => {
        if (runIdRef.current !== runId) return;
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload.error ?? 'Comparison failed');
        }
        setResult(payload as CompareResponse);
        setStatus('done');
      })
      .catch((err) => {
        if (runIdRef.current !== runId) return;
        setErrorMessage(err instanceof Error ? err.message : 'Comparison failed');
        setStatus('error');
      });
  }, [jobId]);

  useEffect(() => {
    const runId = ++runIdRef.current;
    performCompare(runId);
  }, [performCompare]);

  function handleRetry() {
    const runId = ++runIdRef.current;
    setStatus('running');
    setErrorMessage(null);
    performCompare(runId);
  }

  return (
    <div className="mb-6 rounded-lg border border-border p-4">
      <p className="text-sm text-muted-foreground mb-3">
        Comparing against <span className="text-foreground font-medium">{jobTitle}</span> at{' '}
        <span className="text-foreground font-medium">{jobCompany}</span>
      </p>

      {status === 'running' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Running comparison…
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-destructive">{errorMessage ?? 'Comparison failed'}</span>
          <Button size="sm" variant="outline" onClick={handleRetry}>
            Retry
          </Button>
        </div>
      )}

      {status === 'done' && result && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Badge variant={scoreBadgeVariant(result.score)} className="text-sm px-2.5 py-1">
              {result.score}/100
            </Badge>
            {!result.jdFetched && (
              <span className="text-xs text-muted-foreground">
                Based on title/company only — full posting couldn&apos;t be fetched
              </span>
            )}
          </div>

          <p className="text-sm text-foreground">{result.reasoning}</p>

          {result.missingKeywords.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">
                Keywords in the posting missing from your resume:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {result.missingKeywords.map((kw) => (
                  <Badge key={kw} variant="outline" className="font-normal">
                    {kw}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
