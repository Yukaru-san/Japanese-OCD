/** One point of a stroke, in any unit (e.g. CSS pixels of your drawing area). */
export interface InkPoint {
  x: number;
  y: number;
  /** Time in milliseconds (e.g. `event.timeStamp` or `Date.now()`). Optional, improves accuracy. */
  t?: number;
}

/** One stroke: the points from touching down to lifting the finger or pen. */
export interface InkStroke {
  points: InkPoint[];
}

export interface RecognizeHandwritingOptions {
  /** The strokes in the order they were drawn. An empty array returns no candidates. */
  strokes: InkStroke[];
  /** Width of the drawing area, in the unit of the points. Helps to tell small kana (っ) from big ones (つ). */
  width?: number;
  /** Height of the drawing area, in the unit of the points. */
  height?: number;
  /** Text written before these strokes, e.g. the text already accepted. Improves the next characters. */
  preContext?: string;
  /**
   * Maximum number of candidates, 1 to 5.
   *
   * @default 5
   */
  maxResults?: number;
}

export interface HandwritingCandidate {
  text: string;
  /**
   * Probability of this candidate relative to the others, between 0 and 1. The probabilities of all
   * returned candidates add up to 1.
   */
  probability: number;
  /** Raw score of the recognizer; lower is better. */
  score: number;
}

export interface HandwritingResult {
  /** The best candidate's text, `''` when there were no strokes. */
  text: string;
  /** Up to `maxResults` candidates, best first. */
  candidates: HandwritingCandidate[];
}

export interface PrepareHandwritingOptions {
  /**
   * Only download the model over Wi-Fi.
   *
   * @default false
   */
  requireWifi?: boolean;
}
