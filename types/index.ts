export type JobStream = 'internship' | 'new_grad';

export interface Job {
  id: string;
  title: string;
  company: string;
  url: string;
  stream: JobStream;
  posted_at: string | null;
  discovered_at: string;
  applied: boolean;
  resume_file_path: string | null;
  created_at: string;
}
