import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = join(__dirname, 'direct-vs-generic-model.json');

// Below this log-probability margin between the top two classes, the model
// isn't confident enough to trust — callers should fall through to the LLM
// (or 'unknown') instead of a coin-flip guess.
const MIN_CONFIDENT_MARGIN = 4;

const MIN_WORD_FREQ = 2;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'at', 'in', 'of', 'for', 'and', 'or', 'to', 'on', 'is', 'it', 'as', 'by',
  'be', 'we', 'you', 'your', 'our', 'this', 'that', 'are', 'with', 'from', 'will', 'can', 'all',
  'have', 'has', 'not', 'their', 'they', 'about', 'more', 'other', 'into', 'than', 'also', 'may',
  'these', 'such', 'each', 'per', 'new', 'job', 'jobs', 'role', 'career', 'careers', 'work',
  'working', 'team', 'company',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && w.length <= 20 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

export interface NaiveBayesModel {
  classes: string[];
  priors: Record<string, number>;
  wordLogProbs: Record<string, Record<string, number>>;
  defaultLogProb: Record<string, number>;
}

export interface LabeledDoc {
  text: string;
  label: string;
}

/**
 * Multinomial Naive Bayes with Laplace (add-1) smoothing over a pruned
 * bag-of-words vocabulary (words seen fewer than MIN_WORD_FREQ times across
 * the whole training set are dropped — mostly typos/IDs/boilerplate noise
 * that would otherwise just bloat the model without helping generalize).
 */
export function trainNaiveBayes(docs: LabeledDoc[]): NaiveBayesModel {
  const classes = [...new Set(docs.map((d) => d.label))];
  const tokensByDoc = docs.map((d) => tokenize(d.text));

  const globalFreq: Record<string, number> = {};
  for (const tokens of tokensByDoc) {
    for (const t of tokens) globalFreq[t] = (globalFreq[t] ?? 0) + 1;
  }

  const wordCounts: Record<string, Record<string, number>> = {};
  const classTotalWords: Record<string, number> = {};
  const classDocCount: Record<string, number> = {};
  for (const c of classes) {
    wordCounts[c] = {};
    classTotalWords[c] = 0;
    classDocCount[c] = 0;
  }

  docs.forEach((doc, i) => {
    classDocCount[doc.label]++;
    for (const t of tokensByDoc[i]) {
      if ((globalFreq[t] ?? 0) < MIN_WORD_FREQ) continue;
      wordCounts[doc.label][t] = (wordCounts[doc.label][t] ?? 0) + 1;
      classTotalWords[doc.label]++;
    }
  });

  const vocab = new Set<string>();
  for (const c of classes) for (const w of Object.keys(wordCounts[c])) vocab.add(w);
  const vocabSize = vocab.size;

  const totalDocs = docs.length;
  const priors: Record<string, number> = {};
  const wordLogProbs: Record<string, Record<string, number>> = {};
  const defaultLogProb: Record<string, number> = {};

  for (const c of classes) {
    priors[c] = Math.log(classDocCount[c] / totalDocs);
    wordLogProbs[c] = {};
    for (const [word, count] of Object.entries(wordCounts[c])) {
      wordLogProbs[c][word] = Math.log((count + 1) / (classTotalWords[c] + vocabSize));
    }
    defaultLogProb[c] = Math.log(1 / (classTotalWords[c] + vocabSize));
  }

  return { classes, priors, wordLogProbs, defaultLogProb };
}

export function scoreText(model: NaiveBayesModel, text: string): Record<string, number> {
  const tokens = tokenize(text);
  const scores: Record<string, number> = {};
  for (const c of model.classes) {
    let score = model.priors[c];
    for (const t of tokens) {
      score += model.wordLogProbs[c][t] ?? model.defaultLogProb[c];
    }
    scores[c] = score;
  }
  return scores;
}

export function predict(model: NaiveBayesModel, text: string): { label: string; margin: number } {
  const scores = scoreText(model, text);
  const ranked = [...model.classes].sort((a, b) => scores[b] - scores[a]);
  const [best, second] = ranked;
  const margin = second === undefined ? Infinity : scores[best] - scores[second];
  return { label: best, margin };
}

let cachedModel: NaiveBayesModel | null | undefined;

function loadModel(): NaiveBayesModel | null {
  if (cachedModel !== undefined) return cachedModel;
  try {
    cachedModel = JSON.parse(readFileSync(MODEL_PATH, 'utf-8')) as NaiveBayesModel;
  } catch {
    cachedModel = null;
  }
  return cachedModel;
}

/**
 * Our own locally-trained (no API key, no network) classifier for the same
 * "is this page a specific job posting, or a generic careers page" question
 * the LLM fallback answers — trained on labels we already have for free from
 * the host-allowlist/keyword layers. Returns null (not confident enough, or
 * no model file present) rather than guessing, so callers can fall through
 * to the LLM or 'unknown' exactly as before.
 */
export function classifyDirectVsGeneric(text: string): 'direct' | 'generic' | null {
  const model = loadModel();
  if (!model) return null;
  const { label, margin } = predict(model, text);
  if (margin < MIN_CONFIDENT_MARGIN) return null;
  return label === 'direct' || label === 'generic' ? label : null;
}
