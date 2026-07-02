import type { Metadata } from 'next';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import ResumeEditor from '@/components/resume/resume-editor';

export const metadata: Metadata = {
  title: 'Resume — CareerForge CRM',
};

export default async function ResumePage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const shell = (content: React.ReactNode) => (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <header className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight">CareerForge CRM</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Resume Workspace</p>
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
          to edit your resume.
        </p>
      </div>
    );
  }

  const { data, error } = await supabase
    .from('resumes')
    .select('content')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    return shell(
      <div className="flex flex-col items-center justify-center py-24 gap-2 text-center">
        <p className="text-destructive font-medium">Failed to load resume</p>
        <p className="text-muted-foreground text-sm">{error.message}</p>
      </div>
    );
  }

  return shell(<ResumeEditor initialContent={data?.content ?? ''} />);
}
