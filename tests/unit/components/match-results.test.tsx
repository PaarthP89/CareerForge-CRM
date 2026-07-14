import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MatchResults from '@/components/resume/match-results';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function makeMatch(overrides: Partial<Parameters<typeof MatchResults>[0]['initialMatches'][0]> = {}) {
  return {
    id: 'match-1',
    job_id: 'job-1',
    score: 82,
    reasoning: 'Strong overlap on core skills.',
    matched_at: '2026-07-01T00:00:00.000Z',
    jobs: {
      id: 'job-1',
      user_id: 'user-1',
      title: 'Software Engineer Intern',
      company: 'Acme Corp',
      url: 'https://acme.example.com/jobs/1',
      stream: 'internship' as const,
      posted_at: '2026-06-01T00:00:00.000Z',
      discovered_at: '2026-06-02T00:00:00.000Z',
      applied: false,
      resume_file_path: null,
      created_at: '2026-06-02T00:00:00.000Z',
      deleted_at: null,
      url_quality: null,
      last_checked_at: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('MatchResults', () => {
  it('shows the empty state when there are no matches yet', () => {
    render(<MatchResults initialMatches={[]} />);
    expect(screen.getByText(/No matches yet/)).toBeInTheDocument();
  });

  it('renders a ranked row for each match', () => {
    render(<MatchResults initialMatches={[makeMatch()]} />);
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Software Engineer Intern')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
  });

  it('runs the match pipeline and shows the summary on success', async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ totalJobs: 100, prefiltered: 40, scored: 40, failedBatches: 0 }),
    });

    render(<MatchResults initialMatches={[]} />);
    await user.click(screen.getByRole('button', { name: 'Run Match' }));

    expect(fetch).toHaveBeenCalledWith('/api/resume/match', { method: 'POST' });
    await waitFor(() =>
      expect(screen.getByText(/Scored 40 of 100 active jobs/)).toBeInTheDocument()
    );
  });

  it('shows an error message when the match run fails', async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Resume is empty' }),
    });

    render(<MatchResults initialMatches={[]} />);
    await user.click(screen.getByRole('button', { name: 'Run Match' }));

    await waitFor(() => expect(screen.getByText('Resume is empty')).toBeInTheDocument());
  });

  it('expands a row to run and display a Deep Compare result', async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        score: 91,
        reasoning: 'Excellent match on required keywords.',
        missingKeywords: ['Kubernetes'],
        jdFetched: true,
      }),
    });

    render(<MatchResults initialMatches={[makeMatch()]} />);
    await user.click(screen.getByRole('button', { name: 'Deep-compare against this job' }));

    expect(fetch).toHaveBeenCalledWith('/api/resume/match/job-1', { method: 'POST' });
    await waitFor(() => expect(screen.getByText('91/100')).toBeInTheDocument());
    expect(screen.getByText('Kubernetes')).toBeInTheDocument();
  });

  it('shows a Retry button on Deep Compare failure and recovers on click', async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Comparison failed' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          score: 70,
          reasoning: 'Decent match.',
          missingKeywords: [],
          jdFetched: false,
        }),
      });

    render(<MatchResults initialMatches={[makeMatch()]} />);
    await user.click(screen.getByRole('button', { name: 'Deep-compare against this job' }));

    await waitFor(() => expect(screen.getByText('Comparison failed')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(fetch).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByText('70/100')).toBeInTheDocument());
    expect(
      screen.getByText(/Based on title\/company only/)
    ).toBeInTheDocument();
  });
});
