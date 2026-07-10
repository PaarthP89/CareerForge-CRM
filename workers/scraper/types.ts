export interface RawListing {
  company: string;
  title: string;
  url: string;
  location?: string;
  postedAt?: Date | null;
  stream: 'internship' | 'new_grad';
  terms?: string[];
}
