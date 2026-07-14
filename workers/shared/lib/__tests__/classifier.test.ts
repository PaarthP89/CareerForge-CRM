// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { extractJobPostings, matchesJobPosting } from '../json-ld.js';
import { tokenize, trainNaiveBayes, predict } from '../text-classifier.js';

describe('extractJobPostings', () => {
  it('finds a single JobPosting block', () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"JobPosting","title":"Software Engineer","hiringOrganization":{"@type":"Organization","name":"Acme Corp"}}
    </script></head><body></body></html>`;
    const postings = extractJobPostings(html);
    expect(postings.length).toBe(1);
    expect(postings[0].title).toBe('Software Engineer');
    expect(postings[0].organizationName).toBe('Acme Corp');
  });

  it('handles @graph-wrapped nodes', () => {
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"WebPage","name":"Careers"},
        {"@type":"JobPosting","title":"Backend Engineer","hiringOrganization":"Acme Corp"}
      ]}
    </script>`;
    const postings = extractJobPostings(html);
    expect(postings.length).toBe(1);
    expect(postings[0].title).toBe('Backend Engineer');
    expect(postings[0].organizationName).toBe('Acme Corp');
  });

  it('ignores non-JobPosting types and malformed JSON', () => {
    const html = `<script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
      <script type="application/ld+json">{ not valid json </script>`;
    expect(extractJobPostings(html).length).toBe(0);
  });

  it('returns empty array when no JSON-LD present', () => {
    expect(extractJobPostings('<html><body>plain page</body></html>')).toEqual([]);
  });
});

describe('matchesJobPosting', () => {
  it('is true when title/company overlap with a posting', () => {
    const postings = [{ title: 'Senior Backend Engineer', organizationName: 'Acme Corp' }];
    expect(matchesJobPosting(postings, 'Backend Engineer Intern', 'Acme Corp')).toBe(true);
  });

  it('is false when nothing overlaps (aggregator page guard)', () => {
    const postings = [{ title: 'Warehouse Associate', organizationName: 'Totally Different Inc' }];
    expect(matchesJobPosting(postings, 'Backend Engineer Intern', 'Acme Corp')).toBe(false);
  });

  it('is false with no postings at all', () => {
    expect(matchesJobPosting([], 'Backend Engineer Intern', 'Acme Corp')).toBe(false);
  });
});

describe('text-classifier', () => {
  it('tokenize lowercases, strips punctuation, and drops stopwords/short tokens', () => {
    const tokens = tokenize('Apply Now! Submit your Resume for this Job.');
    expect(tokens).not.toContain('for');
    expect(tokens).not.toContain('job');
    expect(tokens).toContain('apply');
    expect(tokens).toContain('resume');
  });

  it('trainNaiveBayes + predict separates clearly distinct classes', () => {
    const docs = [
      { text: 'apply now submit your application upload resume cover letter responsibilities requirements qualifications', label: 'direct' },
      { text: 'apply today submit application resume required qualifications skills experience benefits salary', label: 'direct' },
      { text: 'submit your resume for this specific role responsibilities include requirements include', label: 'direct' },
      { text: 'browse all jobs search open positions join our talent community life at our culture', label: 'generic' },
      { text: 'view all openings find your dream job discover your next opportunity search jobs', label: 'generic' },
      { text: 'browse jobs join talent network our culture find dream job search positions', label: 'generic' },
    ];
    const model = trainNaiveBayes(docs);

    const direct = predict(model, 'apply now and submit your resume, cover letter, and application for this role');
    expect(direct.label).toBe('direct');

    const generic = predict(model, 'browse all open jobs and search positions, join our talent community');
    expect(generic.label).toBe('generic');
  });

  it('predict returns a finite margin for a two-class model', () => {
    const docs = [
      { text: 'alpha alpha alpha beta', label: 'a' },
      { text: 'gamma gamma gamma delta', label: 'b' },
    ];
    const model = trainNaiveBayes(docs);
    const { margin } = predict(model, 'alpha alpha beta');
    expect(Number.isFinite(margin)).toBe(true);
  });
});
