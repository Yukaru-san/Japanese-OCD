package com.yukarusan.japaneseocr;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Plain-Java helpers for handwriting: splitting strokes into written rows, combining the candidates
 * of several rows, and turning recognizer scores into probabilities. Kept free of Android and ML Kit
 * types so it can be unit tested.
 */
final class InkLines {

    private InkLines() {}

    /** Vertical extent of one stroke. */
    static final class Span {

        final int stroke;
        final float top;
        final float bottom;

        Span(int stroke, float top, float bottom) {
            this.stroke = stroke;
            this.top = top;
            this.bottom = bottom;
        }
    }

    /**
     * Groups strokes into rows written one below the other. Strokes whose vertical extents overlap
     * belong to the same row, so a row only ends where there is a horizontal gap across the whole
     * drawing. Rows are returned top to bottom; each keeps its strokes in drawing order.
     */
    static List<List<Integer>> rows(List<Span> spans) {
        List<Span> sorted = new ArrayList<>(spans);
        Collections.sort(sorted, Comparator.comparingDouble((Span s) -> s.top));
        List<List<Integer>> rows = new ArrayList<>();
        float rowBottom = Float.NEGATIVE_INFINITY;
        List<Integer> row = null;
        for (Span span : sorted) {
            if (row == null || span.top > rowBottom) {
                row = new ArrayList<>();
                rows.add(row);
                rowBottom = span.bottom;
            } else {
                rowBottom = Math.max(rowBottom, span.bottom);
            }
            row.add(span.stroke);
        }
        for (List<Integer> r : rows) Collections.sort(r);
        return rows;
    }

    /** A recognized text with its score; lower scores are better, as in ML Kit. */
    static final class Candidate {

        final String text;
        final double score;

        Candidate(String text, double score) {
            this.text = text;
            this.score = score;
        }
    }

    /**
     * Combines the candidates of consecutive rows into whole-text candidates (beam search): every
     * kept combination is extended with every candidate of the next row, scores add up, and the
     * best {@code limit} combinations survive. Identical texts are merged, keeping the best score.
     */
    static List<Candidate> combine(List<Candidate> sofar, List<Candidate> next, int limit) {
        List<Candidate> out = new ArrayList<>();
        if (sofar.isEmpty()) {
            for (Candidate c : next) add(out, c);
        } else {
            for (Candidate a : sofar) {
                for (Candidate b : next) add(out, new Candidate(join(a.text, b.text), a.score + b.score));
            }
        }
        Collections.sort(out, Comparator.comparingDouble((Candidate c) -> c.score));
        return out.size() > limit ? new ArrayList<>(out.subList(0, limit)) : out;
    }

    private static void add(List<Candidate> list, Candidate candidate) {
        for (int i = 0; i < list.size(); i++) {
            if (list.get(i).text.equals(candidate.text)) {
                if (candidate.score < list.get(i).score) list.set(i, candidate);
                return;
            }
        }
        list.add(candidate);
    }

    /** Joins two rows: directly for Japanese, with a space between two Latin letters or digits. */
    static String join(String a, String b) {
        if (a.isEmpty() || b.isEmpty()) return a + b;
        char last = a.charAt(a.length() - 1);
        char first = b.charAt(0);
        return isLatin(last) && isLatin(first) ? a + " " + b : a + b;
    }

    private static boolean isLatin(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
    }

    /**
     * Probability of each candidate relative to the others: softmax over the negated scores, so the
     * values add up to 1.
     */
    static double[] probabilities(List<Candidate> candidates) {
        double[] p = new double[candidates.size()];
        if (p.length == 0) return p;
        double best = Double.POSITIVE_INFINITY;
        for (Candidate c : candidates) best = Math.min(best, c.score);
        double sum = 0;
        for (int i = 0; i < p.length; i++) {
            p[i] = Math.exp(best - candidates.get(i).score);
            sum += p[i];
        }
        for (int i = 0; i < p.length; i++) p[i] /= sum;
        return p;
    }
}
