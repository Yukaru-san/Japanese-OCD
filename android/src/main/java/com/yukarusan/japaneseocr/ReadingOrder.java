package com.yukarusan.japaneseocr;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Puts recognized lines into reading order and separates furigana.
 *
 * <p>ML Kit reports blocks in detection order, and the small readings printed above kanji
 * (furigana) come back as lines of their own between the main text. This class works on plain
 * boxes, so it has no Android dependencies and can be unit tested on the JVM.
 */
final class ReadingOrder {

    /** A recognized line: its text and box in image pixels. */
    static final class Line {

        final String text;
        final int left;
        final int top;
        final int right;
        final int bottom;

        Line(String text, int left, int top, int right, int bottom) {
            this.text = text;
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
        }

        int width() {
            return right - left;
        }

        int height() {
            return bottom - top;
        }
    }

    static final class Layout {

        /** Paragraphs in reading order, each a list of indexes into the input lines. */
        final List<List<Integer>> paragraphs = new ArrayList<>();

        /** Indexes of lines recognized as furigana, in reading order. */
        final List<Integer> furigana = new ArrayList<>();

        boolean vertical;
    }

    /** Lines thinner than this share of the typical text size are furigana candidates. */
    private static final double FURIGANA_RATIO = 0.7;

    /** Lines whose centers are closer than this share of the text size are on the same row. */
    private static final double SAME_ROW = 0.5;

    /** A gap larger than this share of the text size starts a new paragraph. */
    private static final double PARAGRAPH_GAP = 1.5;

    /** Lines whose size differs by more than this ratio belong to different paragraphs (title vs body). */
    private static final double SIZE_CHANGE = 1.3;

    private ReadingOrder() {}

    static Layout arrange(List<Line> lines) {
        Layout layout = new Layout();
        if (lines.isEmpty()) return layout;

        layout.vertical = isVertical(lines);
        boolean vertical = layout.vertical;

        double reference = percentile(thicknesses(lines, vertical), 0.75);

        List<Integer> main = new ArrayList<>();
        for (int i = 0; i < lines.size(); i++) {
            Line line = lines.get(i);
            if (thickness(line, vertical) < reference * FURIGANA_RATIO && isKana(line.text)) {
                layout.furigana.add(i);
            } else {
                main.add(i);
            }
        }

        // Typical size of the main text, without the furigana pulling it down.
        double size = main.isEmpty() ? reference : percentile(thicknessesOf(lines, main, vertical), 0.5);
        Comparator<Integer> order = readingOrder(lines, vertical, size);
        main.sort(order);
        layout.furigana.sort(order);

        List<Integer> paragraph = null;
        Line previous = null;
        for (int index : main) {
            Line line = lines.get(index);
            if (paragraph == null || startsParagraph(previous, line, vertical, size)) {
                paragraph = new ArrayList<>();
                layout.paragraphs.add(paragraph);
            }
            paragraph.add(index);
            previous = line;
        }
        return layout;
    }

    /** Joins the lines of a paragraph. Japanese lines are joined directly, Latin words with a space. */
    static String join(List<String> parts) {
        StringBuilder text = new StringBuilder();
        for (String part : parts) {
            if (text.length() > 0 && !part.isEmpty() && isLatin(text.charAt(text.length() - 1)) && isLatin(part.charAt(0))) {
                text.append(' ');
            }
            text.append(part);
        }
        return text.toString();
    }

    private static boolean isVertical(List<Line> lines) {
        int vertical = 0;
        int horizontal = 0;
        for (Line line : lines) {
            if (line.text.codePointCount(0, line.text.length()) < 2) continue;
            if (line.height() > line.width() * 1.5) vertical++;
            else if (line.width() > line.height() * 1.5) horizontal++;
        }
        return vertical > horizontal;
    }

    private static int thickness(Line line, boolean vertical) {
        return vertical ? line.width() : line.height();
    }

    private static List<Integer> thicknesses(List<Line> lines, boolean vertical) {
        List<Integer> values = new ArrayList<>();
        for (Line line : lines) values.add(thickness(line, vertical));
        return values;
    }

    private static List<Integer> thicknessesOf(List<Line> lines, List<Integer> indexes, boolean vertical) {
        List<Integer> values = new ArrayList<>();
        for (int i : indexes) values.add(thickness(lines.get(i), vertical));
        return values;
    }

    private static double percentile(List<Integer> values, double p) {
        List<Integer> sorted = new ArrayList<>(values);
        Collections.sort(sorted);
        int index = (int) Math.round((sorted.size() - 1) * p);
        return sorted.get(Math.max(0, Math.min(sorted.size() - 1, index)));
    }

    /**
     * Horizontal: rows top to bottom, left to right within a row.
     * Vertical: columns right to left, top to bottom within a column.
     */
    private static Comparator<Integer> readingOrder(List<Line> lines, boolean vertical, double size) {
        double tolerance = size * SAME_ROW;
        return (a, b) -> {
            Line x = lines.get(a);
            Line y = lines.get(b);
            if (vertical) {
                double cx = (x.left + x.right) / 2.0;
                double cy = (y.left + y.right) / 2.0;
                if (Math.abs(cx - cy) > tolerance) return Double.compare(cy, cx);
                return Integer.compare(x.top, y.top);
            }
            double rx = (x.top + x.bottom) / 2.0;
            double ry = (y.top + y.bottom) / 2.0;
            if (Math.abs(rx - ry) > tolerance) return Double.compare(rx, ry);
            return Integer.compare(x.left, y.left);
        };
    }

    private static boolean startsParagraph(Line previous, Line line, boolean vertical, double size) {
        double a = thickness(previous, vertical);
        double b = thickness(line, vertical);
        if (Math.max(a, b) > Math.min(a, b) * SIZE_CHANGE) return true;
        if (vertical) {
            // Next column must be to the left, close by, and start near the same top.
            double gap = previous.left - line.right;
            boolean overlaps = line.top < previous.bottom && line.bottom > previous.top;
            return gap < -size * SAME_ROW || gap > size * PARAGRAPH_GAP || !overlaps;
        }
        // Next row must be below, close by, and overlap the previous line horizontally.
        double gap = line.top - previous.bottom;
        boolean overlaps = line.left < previous.right && line.right > previous.left;
        return gap < -size * SAME_ROW || gap > size * PARAGRAPH_GAP || !overlaps;
    }

    /** True when the text only contains hiragana, katakana and spaces. */
    static boolean isKana(String text) {
        boolean any = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (Character.isWhitespace(c)) continue;
            Character.UnicodeBlock block = Character.UnicodeBlock.of(c);
            boolean kana =
                block == Character.UnicodeBlock.HIRAGANA ||
                block == Character.UnicodeBlock.KATAKANA ||
                block == Character.UnicodeBlock.KATAKANA_PHONETIC_EXTENSIONS;
            if (!kana) return false;
            any = true;
        }
        return any;
    }

    private static boolean isLatin(char c) {
        return c < 0x3000 && Character.isLetterOrDigit(c);
    }
}
