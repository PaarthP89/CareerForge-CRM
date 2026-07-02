import type { Metadata } from 'next';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import MatchesList from '@/components/matches/matches-list';
import NavLinks from '@/components/nav-links';

export const metadata: Metadata = {
  title: 'Matches — CareerForge CRM',
};

export default async function MatchesPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const shell = (content: React.ReactNode) => (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">CareerForge CRM</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Resume Matches</p>
          </div>
          <NavLinks current="matches" />
        </header>
        <main>{content}</main>
      </div>
    </div>
  );

  if (!user) {
    return shell(
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <p className="text-foreground font-medium">Authentication Required</p>
        <p className="text-muted-foreground text-sm max-w-md">
          No active session found.{' '}
          <a href="/login" className="underline underline-offset-4 hover:text-foreground">
            Sign in
          </a>{' '}
          to view matches.
        </p>
      </div>
    );
  }

  const { data, error } = await supabase
    .from('job_matches')
    .select('id, job_id, score, reasoning, matched_at, jobs(title, company)')
    .eq('user_id', user.id)
    .order('score', { ascending: false });

  if (error) {
    return shell(
      <div className="flex flex-col items-center justify-center py-24 gap-2 text-center">
        <p className="text-destructive font-medium">Failed to load matches</p>
        <p className="text-muted-foreground text-sm">{error.message}</p>
      </div>
    );
  }

  const matches = (data ?? []).map((row) => ({
    ...row,
    jobs: Array.isArray(row.jobs) ? (row.jobs[0] ?? null) : row.jobs,
  }));

  return shell(<MatchesList initialMatches={matches} />);
}
