import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JobsTable from '@/components/dashboard/jobs-table';
import type { Job } from '@/types';

function makeJob(overrides: Partial<Job> & { id: string }): Job {
  return {
    user_id: 'user-1',
    title: 'Software Engineer Intern',
    company: 'Acme Corp',
    url: 'https://acme.com/careers/123',
    stream: 'internship',
    posted_at: null,
    discovered_at: '2026-07-01T00:00:00.000Z',
    applied: false,
    resume_file_path: null,
    created_at: '2026-07-01T00:00:00.000Z',
    deleted_at: null,
    url_quality: 'direct',
    last_checked_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response)
  );
});

describe('JobsTable', () => {
  it('shows internship and new-grad counts in the header badges', () => {
    const jobs = [
      makeJob({ id: '1', stream: 'internship' }),
      makeJob({ id: '2', stream: 'internship' }),
      makeJob({ id: '3', stream: 'new_grad' }),
    ];
    render(<JobsTable initialJobs={jobs} initialTrash={[]} />);

    expect(screen.getByText('2 internships')).toBeInTheDocument();
    expect(screen.getByText('1 new grad')).toBeInTheDocument();
  });

  it('shows the empty state when a tab has no jobs', () => {
    render(<JobsTable initialJobs={[]} initialTrash={[]} />);
    expect(screen.getByText(/No jobs here yet/)).toBeInTheDocument();
  });

  it('sinks url_quality "generic" rows below direct/unknown rows within a tab', () => {
    const jobs = [
      makeJob({ id: '1', company: 'GenericCo', url_quality: 'generic' }),
      makeJob({ id: '2', company: 'DirectCo', url_quality: 'direct' }),
      makeJob({ id: '3', company: 'UnknownCo', url_quality: 'unknown' }),
    ];
    render(<JobsTable initialJobs={jobs} initialTrash={[]} />);

    const rows = screen.getAllByRole('row').slice(1); // drop header row
    const companies = rows.map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(companies).toEqual(['DirectCo', 'UnknownCo', 'GenericCoUnverified link']);
  });

  it('optimistically checks "Applied" and PATCHes the job on click', async () => {
    const user = userEvent.setup();
    const job = makeJob({ id: 'job-1', applied: false });
    render(<JobsTable initialJobs={[job]} initialTrash={[]} />);

    const checkbox = screen.getByRole('checkbox', {
      name: `Mark ${job.title} at ${job.company} as applied`,
    });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);

    expect(checkbox).toBeChecked();
    expect(fetch).toHaveBeenCalledWith(
      '/api/jobs/job-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ applied: true }),
      })
    );
  });

  it('shows a trash-specific empty state on the Trash tab', async () => {
    const user = userEvent.setup();
    render(<JobsTable initialJobs={[]} initialTrash={[]} />);
    await user.click(screen.getByRole('tab', { name: 'Trash' }));
    expect(screen.getByText('Nothing in the trash.')).toBeInTheDocument();
  });
});
