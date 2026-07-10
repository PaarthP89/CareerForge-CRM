import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJobPostings, matchesJobPosting } from '../json-ld.js';
import { tokenize, trainNaiveBayes, predict } from '../text-classifier.js';

// --- json-ld.ts ---

test('extractJobPostings finds a single JobPosting block', () => {
  const html = `<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@type":"JobPosting","title":"Software Engineer","hiringOrganization":{"@type":"Organization","name":"Acme Corp"}}
  </script></head><body></body></html>`;
  const postings = extractJobPostings(html);
  assert.strictEqual(postings.length, 1);
  assert.strictEqual(postings[0].title, 'Software Engineer');
  assert.strictEqual(postings[0].organizationName, 'Acme Corp');
});

test('extractJobPostings handles @graph-wrapped nodes', () => {
  const html = `<script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"WebPage","name":"Careers"},
      {"@type":"JobPosting","title":"Backend Engineer","hiringOrganization":"Acme Corp"}
    ]}
  </script>`;
  const postings = extractJobPostings(html);
  assert.strictEqual(postings.length, 1);
  assert.strictEqual(postings[0].title, 'Backend Engineer');
  assert.strictEqual(postings[0].organizationName, 'Acme Corp');
});

test('extractJobPostings ignores non-JobPosting types and malformed JSON', () => {
  const html = `<script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
    <script type="application/ld+json">{ not valid json </script>`;
  assert.strictEqual(extractJobPostings(html).length, 0);
});

test('extractJobPostings returns empty array when no JSON-LD present', () => {
  assert.deepStrictEqual(extractJobPostings('<html><body>plain page</body></html>'), []);
});

test('matchesJobPosting is true when title/company overlap with a posting', () => {
  const postings = [{ title: 'Senior Backend Engineer', organizationName: 'Acme Corp' }];
  assert.ok(matchesJobPosting(postings, 'Backend Engineer Intern', 'Acme Corp'));
});

test('matchesJobPosting is false when nothing overlaps (aggregator page guard)', () => {
  const postings = [{ title: 'Warehouse Associate', organizationName: 'Totally Different Inc' }];
  assert.ok(!matchesJobPosting(postings, 'Backend Engineer Intern', 'Acme Corp'));
});

test('matchesJobPosting is false with no postings at all', () => {
  assert.ok(!matchesJobPosting([], 'Backend Engineer Intern', 'Acme Corp'));
});

// --- text-classifier.ts ---

test('tokenize lowercases, strips punctuation, and drops stopwords/short tokens', () => {
  const tokens = tokenize('Apply Now! Submit your Resume for this Job.');
  assert.ok(!tokens.includes('for'));
  assert.ok(!tokens.includes('job'));
  assert.ok(tokens.includes('apply'));
  assert.ok(tokens.includes('resume'));
});

test('trainNaiveBayes + predict separates clearly distinct classes', () => {
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
  assert.strictEqual(direct.label, 'direct');

  const generic = predict(model, 'browse all open jobs and search positions, join our talent community');
  assert.strictEqual(generic.label, 'generic');
});

test('predict returns a finite margin for a two-class model', () => {
  const docs = [
    { text: 'alpha alpha alpha beta', label: 'a' },
    { text: 'gamma gamma gamma delta', label: 'b' },
  ];
  const model = trainNaiveBayes(docs);
  const { margin } = predict(model, 'alpha alpha beta');
  assert.ok(Number.isFinite(margin));
});
