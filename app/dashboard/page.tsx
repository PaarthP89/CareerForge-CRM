import type { Metadata } from 'next';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import type { Job } from '@/types';
import JobsTable from '@/components/dashboard/jobs-table';

export const metadata: Metadata = {
  title: 'Dashboard — CareerForge CRM',
};

export default async function DashboardPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const shell = (content: React.ReactNode) => (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <header className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight">CareerForge CRM</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Job Search Tracker</p>
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
          </a>
          , or seed mock data by adding{' '}
          <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
            SUPABASE_SERVICE_ROLE_KEY
          </code>{' '}
          to{' '}
          <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
            .env.local
          </code>{' '}
          and calling{' '}
          <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
            POST /api/seed?user_id=&lt;uuid&gt;
          </code>
          .
        </p>
      </div>
    );
  }

  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .order('discovered_at', { ascending: false });

  if (error) {
    return shell(
      <div className="flex flex-col items-center justify-center py-24 gap-2 text-center">
        <p className="text-destructive font-medium">Failed to load jobs</p>
        <p className="text-muted-foreground text-sm">{error.message}</p>
      </div>
    );
  }

  return shell(<JobsTable initialJobs={(data as Job[]) ?? []} />);
}
