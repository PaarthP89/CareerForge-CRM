'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

const AUTOSAVE_DELAY_MS = 1500;
const MAX_RESUME_CHARS = 100_000;

type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

export default function ResumeEditor({ initialContent }: { initialContent: string }) {
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const contentRef = useRef(initialContent);
  const savedContentRef = useRef(initialContent);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);

  const performSave = useCallback(async () => {
    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }

    inFlightRef.current = true;

    // Loop instead of recursing so a save request that arrives while the
    // previous one is in flight gets picked up without dropping keystrokes.
    for (;;) {
      const toSave = contentRef.current;
      if (toSave === savedContentRef.current) {
        setStatus('saved');
        break;
      }

      setStatus('saving');
      setErrorMessage(null);

      try {
        const res = await fetch('/api/resume', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: toSave }),
        });

        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? 'Failed to save resume');
        }

        savedContentRef.current = toSave;

        if (pendingRef.current) {
          pendingRef.current = false;
          continue;
        }

        setStatus(contentRef.current === savedContentRef.current ? 'saved' : 'unsaved');
        break;
      } catch (err) {
        pendingRef.current = false;
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Failed to save resume');
        break;
      }
    }

    inFlightRef.current = false;
  }, []);

  function scheduleSave() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      performSave();
    }, AUTOSAVE_DELAY_MS);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    contentRef.current = value;
    setContent(value);
    setStatus('unsaved');
    setErrorMessage(null);
    scheduleSave();
  }

  function handleRetry() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    performSave();
  }

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      const hasUnsavedTyping = debounceRef.current !== null;
      const hasUnsyncedContent = contentRef.current !== savedContentRef.current;

      if ((hasUnsavedTyping && hasUnsyncedContent) || status === 'error') {
        e.preventDefault();
        e.returnValue = '';
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [status]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const charCount = content.length;
  const overLimit = charCount > MAX_RESUME_CHARS;

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-14rem)]">
      <div className="flex items-center justify-between text-sm">
        <StatusIndicator status={status} errorMessage={errorMessage} onRetry={handleRetry} />
        <span className={overLimit ? 'text-destructive' : 'text-muted-foreground'}>
          {charCount.toLocaleString()} / {MAX_RESUME_CHARS.toLocaleString()} characters
        </span>
      </div>

      <Textarea
        value={content}
        onChange={handleChange}
        placeholder="Paste or write your resume here…"
        spellCheck={false}
        className="flex-1 resize-none font-mono text-sm leading-relaxed"
      />
    </div>
  );
}

function StatusIndicator({
  status,
  errorMessage,
  onRetry,
}: {
  status: SaveStatus;
  errorMessage: string | null;
  onRetry: () => void;
}) {
  if (status === 'saving') {
    return <span className="text-muted-foreground">Saving…</span>;
  }

  if (status === 'error') {
    return (
      <span className="flex items-center gap-2 text-destructive">
        Error saving{errorMessage ? `: ${errorMessage}` : ''}
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </span>
    );
  }

  if (status === 'unsaved') {
    return <span className="text-muted-foreground">Unsaved changes</span>;
  }

  return <span className="text-muted-foreground">Saved</span>;
}
