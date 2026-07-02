export type JobStream = 'internship' | 'new_grad';

export interface Job {
  id: string;
  user_id: string;
  title: string;
  company: string;
  url: string;
  stream: JobStream;
  posted_at: string | null;
  discovered_at: string;
  applied: boolean;
  resume_file_path: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface Resume {
  id: string;
  user_id: string;
  content: string;
  updated_at: string;
}
