package com.yukarusan.japaneseocr;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Puts recognized lines into reading order, separates furigana and pairs each reading with the
 * characters it is printed over.
 *
 * <p>ML Kit reports blocks in detection order, and the small readings printed above kanji
 * (furigana) come back as lines of their own between the main text. This class works on plain
 * boxes, so it has no Android dependencies and can be unit tested on the JVM.
 */
final class ReadingOrder {

    /** An axis-aligned box in image pixels. */
    static class Box {

        final int left;
        final int top;
        final int right;
        final int bottom;

        Box(int left, int top, int right, int bottom) {
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

        double centerX() {
            return (left + right) / 2.0;
        }

        double centerY() {
            return (top + bottom) / 2.0;
        }

        boolean contains(double x, double y) {
            return x >= left && x <= right && y >= top && y <= bottom;
        }
    }

    /** One recognized character (an ML Kit symbol). */
    static final class Glyph extends Box {

        final String text;

        /** Index of the word (ML Kit element) within its line; words are separated by spaces. */
        final int word;

        Glyph(String text, int word, int left, int top, int right, int bottom) {
            super(left, top, right, bottom);
            this.text = text;
            this.word = word;
        }
    }

    /** A recognized line: its text, box and, when known, its characters. */
    static final class Line extends Box {

        final String text;
        final List<Glyph> glyphs;

        Line(String text, int left, int top, int right, int bottom) {
            this(text, left, top, right, bottom, Collections.<Glyph>emptyList());
        }

        Line(String text, int left, int top, int right, int bottom, List<Glyph> glyphs) {
            super(left, top, right, bottom);
            this.text = text;
            this.glyphs = glyphs;
        }
    }

    /** A line, or the characters of it that lie inside a selected region. */
    static final class Part {

        final int line;

        /** Indexes into the line's glyphs, or null for the whole line. */
        final List<Integer> glyphs;

        final Box box;

        Part(int line, List<Integer> glyphs, Box box) {
            this.line = line;
            this.glyphs = glyphs;
            this.box = box;
        }
    }

    static final class Paragraph {

        final List<Part> parts = new ArrayList<>();

        /** Index of the region this paragraph was selected by, or -1 without regions. */
        final int region;

        String text = "";

        Paragraph(int region) {
            this.region = region;
        }
    }

    /** A reading paired with the characters it belongs to. */
    static final class Ruby extends Box {

        /** The reading in kana. */
        final String reading;

        /** Index of the furigana line it was read from. */
        final int line;

        /** The characters it is printed over, or null when they could not be determined. */
        String base;

        /** Paragraph that holds the base characters, or -1. */
        int paragraph = -1;

        /** Range of the base characters in the paragraph text, or -1 when unknown. */
        int start = -1;

        int end = -1;

        Ruby(String reading, int line, Box box) {
            super(box.left, box.top, box.right, box.bottom);
            this.reading = reading;
            this.line = line;
        }
    }

    /** A piece of paragraph text, with its reading when furigana was printed over it. */
    static final class Segment {

        final String text;
        final String reading;

        Segment(String text, String reading) {
            this.text = text;
            this.reading = reading;
        }
    }

    static final class Layout {

        /** Paragraphs in reading order (per region, in the order the regions were given). */
        final List<Paragraph> paragraphs = new ArrayList<>();

        /** Indexes of every line recognized as furigana, in reading order. */
        final List<Integer> furigana = new ArrayList<>();

        /** Readings that belong to the returned paragraphs, in reading order. */
        final List<Ruby> ruby = new ArrayList<>();

        boolean vertical;
    }

    /** Lines thinner than this share of the typical text size are furigana candidates. */
    private static final double FURIGANA_RATIO = 0.7;

    /** A kana line this much thinner than the kanji line right below it is furigana. */
    private static final double FURIGANA_NEIGHBOR_RATIO = 0.8;

    /** Lines whose centers are closer than this share of the text size are on the same row. */
    private static final double SAME_ROW = 0.5;

    /** A gap larger than this share of the text size starts a new paragraph. */
    private static final double PARAGRAPH_GAP = 1.5;

    /** Lines whose size differs by more than this ratio belong to different paragraphs (title vs body). */
    private static final double SIZE_CHANGE = 1.3;

    private ReadingOrder() {}

    static Layout arrange(List<Line> lines) {
        return arrange(lines, null);
    }

    /**
     * @param regions only text whose characters lie inside one of these boxes is returned, each
     *     region in turn; furigana belonging to selected characters is kept even when it lies just
     *     outside. Null returns everything.
     */
    static Layout arrange(List<Line> lines, List<Box> regions) {
        Layout layout = new Layout();
        if (lines.isEmpty()) return layout;

        layout.vertical = isVertical(lines);
        boolean vertical = layout.vertical;

        double reference = percentile(thicknesses(lines, vertical), 0.75);

        List<Integer> main = new ArrayList<>();
        for (int i = 0; i < lines.size(); i++) {
            if (isFurigana(lines, i, vertical, reference)) {
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

        List<Ruby> readings = new ArrayList<>();
        Map<Ruby, Integer> baseLine = new HashMap<>();
        Map<Ruby, List<Integer>> baseGlyphs = new HashMap<>();
        for (int index : layout.furigana) {
            for (Ruby ruby : readingsOf(lines, index, vertical)) {
                readings.add(ruby);
                pairWithBase(lines, main, ruby, vertical, baseLine, baseGlyphs);
            }
        }

        if (regions == null) {
            List<Part> parts = new ArrayList<>();
            for (int index : main) parts.add(new Part(index, null, lines.get(index)));
            group(layout, lines, parts, -1, vertical, size);
        } else {
            for (int r = 0; r < regions.size(); r++) {
                group(layout, lines, select(lines, main, regions.get(r)), r, vertical, size);
            }
        }

        placeReadings(layout, lines, readings, baseLine, baseGlyphs, regions);
        return layout;
    }

    /**
     * Locates every reading's base characters in the returned paragraphs and keeps the readings
     * that belong to returned text. With regions, a reading without a base line is kept when it
     * lies inside a region itself.
     */
    private static void placeReadings(
        Layout layout,
        List<Line> lines,
        List<Ruby> readings,
        Map<Ruby, Integer> baseLine,
        Map<Ruby, List<Integer>> baseGlyphs,
        List<Box> regions
    ) {
        for (Ruby ruby : readings) {
            Integer line = baseLine.get(ruby);
            boolean placed = false;
            if (line != null) {
                for (int p = 0; p < layout.paragraphs.size() && !placed; p++) {
                    placed = place(layout.paragraphs.get(p), p, lines, line, baseGlyphs.get(ruby), ruby);
                }
            }
            if (placed || regions == null || (line == null && inAny(regions, ruby))) {
                layout.ruby.add(ruby);
            }
        }
    }

    /** Joins the lines of a paragraph. Japanese lines are joined directly, Latin words with a space. */
    static String join(List<String> parts) {
        StringBuilder text = new StringBuilder();
        for (String part : parts) append(text, part);
        return text.toString();
    }

    /** Splits a paragraph into plain text and text with its reading, for rendering as ruby. */
    static List<Segment> segments(String text, List<Ruby> ruby, int paragraph) {
        List<Ruby> own = new ArrayList<>();
        for (Ruby r : ruby) {
            if (r.paragraph == paragraph && r.start >= 0 && r.end <= text.length() && r.start < r.end) own.add(r);
        }
        own.sort(Comparator.comparingInt((Ruby r) -> r.start));
        List<Segment> result = new ArrayList<>();
        int cursor = 0;
        for (Ruby r : own) {
            if (r.start < cursor) continue; // overlaps the previous reading
            if (r.start > cursor) result.add(new Segment(text.substring(cursor, r.start), null));
            result.add(new Segment(text.substring(r.start, r.end), r.reading));
            cursor = r.end;
        }
        if (cursor < text.length()) result.add(new Segment(text.substring(cursor), null));
        return result;
    }

    // Furigana detection

    private static boolean isFurigana(List<Line> lines, int index, boolean vertical, double reference) {
        Line line = lines.get(index);
        if (!isKana(line.text)) return false;
        double thickness = thickness(line, vertical);
        if (thickness < reference * FURIGANA_RATIO) return true;
        // Large headings have large furigana: compare with the line it sits on instead.
        for (Line other : lines) {
            if (other == line || !hasKanji(other.text)) continue;
            if (thickness >= thickness(other, vertical) * FURIGANA_NEIGHBOR_RATIO) continue;
            if (sitsOn(line, other, vertical, thickness)) return true;
        }
        return false;
    }

    /** True when {@code reading} is printed right above (or right of, in vertical text) {@code base}. */
    private static boolean sitsOn(Box reading, Box base, boolean vertical, double size) {
        if (vertical) {
            boolean overlaps = base.top < reading.bottom && base.bottom > reading.top;
            double gap = reading.left - base.right;
            return overlaps && base.centerX() < reading.centerX() && gap > -size && gap < size;
        }
        boolean overlaps = base.left < reading.right && base.right > reading.left;
        double gap = base.top - reading.bottom;
        return overlaps && base.centerY() > reading.centerY() && gap > -size && gap < size;
    }

    /**
     * Splits a furigana line into one reading per word: ML Kit puts the readings of neighbouring
     * words into one line ("にほん がっこう"), separated by spaces or wide gaps.
     */
    private static List<Ruby> readingsOf(List<Line> lines, int index, boolean vertical) {
        Line line = lines.get(index);
        List<Ruby> result = new ArrayList<>();
        if (line.glyphs.isEmpty()) {
            String[] words = line.text.trim().split("\\s+");
            if (words.length == 1) {
                result.add(new Ruby(words[0], index, line));
            } else {
                // No character boxes: share the line's extent out by character count.
                int total = 0;
                for (String word : words) total += word.length() + 1;
                int position = 0;
                int extent = vertical ? line.height() : line.width();
                int origin = vertical ? line.top : line.left;
                for (String word : words) {
                    int from = origin + (extent * position) / total;
                    int to = origin + (extent * (position + word.length())) / total;
                    Box box = vertical ? new Box(line.left, from, line.right, to) : new Box(from, line.top, to, line.bottom);
                    result.add(new Ruby(word, index, box));
                    position += word.length() + 1;
                }
            }
            return result;
        }

        List<Glyph> group = new ArrayList<>();
        Glyph previous = null;
        for (Glyph glyph : line.glyphs) {
            if (previous != null && (glyph.word != previous.word || gap(previous, glyph, vertical) > thickness(line, vertical))) {
                result.add(rubyOf(group, index));
                group = new ArrayList<>();
            }
            if (!glyph.text.trim().isEmpty()) group.add(glyph);
            previous = glyph;
        }
        if (!group.isEmpty()) result.add(rubyOf(group, index));
        return result;
    }

    private static Ruby rubyOf(List<Glyph> glyphs, int line) {
        StringBuilder text = new StringBuilder();
        int left = Integer.MAX_VALUE,
            top = Integer.MAX_VALUE,
            right = Integer.MIN_VALUE,
            bottom = Integer.MIN_VALUE;
        for (Glyph g : glyphs) {
            text.append(g.text);
            left = Math.min(left, g.left);
            top = Math.min(top, g.top);
            right = Math.max(right, g.right);
            bottom = Math.max(bottom, g.bottom);
        }
        return new Ruby(text.toString(), line, new Box(left, top, right, bottom));
    }

    private static int gap(Box a, Box b, boolean vertical) {
        return vertical ? b.top - a.bottom : b.left - a.right;
    }

    /** Finds the main line a reading is printed over and the characters within its extent. */
    private static void pairWithBase(
        List<Line> lines,
        List<Integer> main,
        Ruby ruby,
        boolean vertical,
        Map<Ruby, Integer> baseLine,
        Map<Ruby, List<Integer>> baseGlyphs
    ) {
        int size = Math.max(1, vertical ? ruby.width() : ruby.height());
        int nearest = -1;
        double nearestDistance = Double.MAX_VALUE;
        for (int index : main) {
            Line line = lines.get(index);
            double distance;
            if (vertical) {
                boolean overlaps = line.top < ruby.bottom && line.bottom > ruby.top;
                if (!overlaps || line.centerX() >= ruby.centerX()) continue;
                distance = Math.abs(ruby.left - line.right);
            } else {
                boolean overlaps = line.left < ruby.right && line.right > ruby.left;
                if (!overlaps || line.centerY() <= ruby.centerY()) continue;
                distance = Math.abs(line.top - ruby.bottom);
            }
            if (distance < nearestDistance && distance < size * 3) {
                nearest = index;
                nearestDistance = distance;
            }
        }
        if (nearest < 0) return;
        baseLine.put(ruby, nearest);

        Line line = lines.get(nearest);
        if (line.glyphs.isEmpty()) return;
        double from = (vertical ? ruby.top : ruby.left) - size / 2.0;
        double to = (vertical ? ruby.bottom : ruby.right) + size / 2.0;
        List<Integer> glyphs = new ArrayList<>();
        for (int i = 0; i < line.glyphs.size(); i++) {
            Glyph g = line.glyphs.get(i);
            double center = vertical ? g.centerY() : g.centerX();
            if (center >= from && center <= to) glyphs.add(i);
        }
        // Furigana belongs to kanji: drop kana the extent caught at either end.
        while (glyphs.size() > 1 && !hasKanji(line.glyphs.get(glyphs.get(0)).text)) glyphs.remove(0);
        while (glyphs.size() > 1 && !hasKanji(line.glyphs.get(glyphs.get(glyphs.size() - 1)).text)) glyphs.remove(glyphs.size() - 1);
        if (glyphs.isEmpty()) return;

        StringBuilder base = new StringBuilder();
        for (int i : glyphs) base.append(line.glyphs.get(i).text);
        ruby.base = base.toString();
        baseGlyphs.put(ruby, glyphs);
    }

    /** Sets the reading's position when its base characters are part of the paragraph. */
    private static boolean place(Paragraph paragraph, int index, List<Line> lines, int line, List<Integer> glyphs, Ruby ruby) {
        for (Part part : paragraph.parts) {
            if (part.line != line) continue;
            if (glyphs == null) {
                ruby.paragraph = index;
                return true;
            }
            if (part.glyphs != null && !part.glyphs.containsAll(glyphs)) continue;
            int[] offsets = offsetsIn(paragraph, lines, part);
            ruby.paragraph = index;
            if (offsets == null) return true;
            int lastGlyph = glyphs.get(glyphs.size() - 1);
            int first = offsets[glyphs.get(0)];
            int last = offsets[lastGlyph];
            // Characters that could not be found in the text: the reading keeps its paragraph only.
            if (first < 0 || last < 0) return true;
            ruby.start = first;
            ruby.end = last + lines.get(line).glyphs.get(lastGlyph).text.length();
            return true;
        }
        return false;
    }

    private static boolean inAny(List<Box> regions, Box box) {
        for (Box region : regions) {
            if (region.contains(box.centerX(), box.centerY())) return true;
        }
        return false;
    }

    // Selection and paragraphs

    private static List<Part> select(List<Line> lines, List<Integer> main, Box region) {
        List<Part> parts = new ArrayList<>();
        for (int index : main) {
            Line line = lines.get(index);
            if (line.glyphs.isEmpty()) {
                if (region.contains(line.centerX(), line.centerY())) parts.add(new Part(index, null, line));
                continue;
            }
            List<Integer> inside = new ArrayList<>();
            for (int i = 0; i < line.glyphs.size(); i++) {
                Glyph g = line.glyphs.get(i);
                if (region.contains(g.centerX(), g.centerY())) inside.add(i);
            }
            if (inside.isEmpty()) continue;
            if (inside.size() == line.glyphs.size()) {
                parts.add(new Part(index, null, line));
            } else {
                parts.add(new Part(index, inside, boxOf(line.glyphs, inside)));
            }
        }
        return parts;
    }

    private static Box boxOf(List<Glyph> glyphs, List<Integer> indexes) {
        int left = Integer.MAX_VALUE,
            top = Integer.MAX_VALUE,
            right = Integer.MIN_VALUE,
            bottom = Integer.MIN_VALUE;
        for (int i : indexes) {
            Glyph g = glyphs.get(i);
            left = Math.min(left, g.left);
            top = Math.min(top, g.top);
            right = Math.max(right, g.right);
            bottom = Math.max(bottom, g.bottom);
        }
        return new Box(left, top, right, bottom);
    }

    private static void group(Layout layout, List<Line> lines, List<Part> parts, int region, boolean vertical, double size) {
        int first = layout.paragraphs.size();
        Paragraph paragraph = null;
        Box previous = null;
        for (Part part : parts) {
            if (paragraph == null || startsParagraph(previous, part.box, vertical, size)) {
                paragraph = new Paragraph(region);
                layout.paragraphs.add(paragraph);
            }
            paragraph.parts.add(part);
            previous = part.box;
        }
        for (int p = first; p < layout.paragraphs.size(); p++) {
            Paragraph current = layout.paragraphs.get(p);
            StringBuilder text = new StringBuilder();
            for (Part part : current.parts) append(text, partText(lines, part));
            current.text = text.toString();
        }
    }

    static String partText(List<Line> lines, Part part) {
        Line line = lines.get(part.line);
        if (part.glyphs == null) return line.text;
        StringBuilder text = new StringBuilder();
        Glyph previous = null;
        for (int i : part.glyphs) {
            Glyph g = line.glyphs.get(i);
            if (previous != null && previous.word != g.word) append(text, g.text);
            else text.append(g.text);
            previous = g;
        }
        return text.toString();
    }

    /** Offset of each of the line's glyphs in the paragraph text, -1 where not found; null if the part is missing. */
    private static int[] offsetsIn(Paragraph paragraph, List<Line> lines, Part target) {
        StringBuilder text = new StringBuilder();
        for (Part part : paragraph.parts) {
            String partText = partText(lines, part);
            append(text, partText);
            int start = text.length() - partText.length();
            if (part != target) continue;

            Line line = lines.get(part.line);
            int[] offsets = new int[line.glyphs.size()];
            Arrays.fill(offsets, -1);
            List<Integer> indexes = new ArrayList<>();
            if (part.glyphs == null) {
                for (int i = 0; i < line.glyphs.size(); i++) indexes.add(i);
            } else {
                indexes.addAll(part.glyphs);
            }
            int cursor = 0;
            for (int i : indexes) {
                String g = line.glyphs.get(i).text;
                int found = g.isEmpty() ? -1 : partText.indexOf(g, cursor);
                if (found < 0) continue;
                offsets[i] = start + found;
                cursor = found + g.length();
            }
            return offsets;
        }
        return null;
    }

    private static void append(StringBuilder text, String part) {
        if (text.length() > 0 && !part.isEmpty() && isLatin(text.charAt(text.length() - 1)) && isLatin(part.charAt(0))) {
            text.append(' ');
        }
        text.append(part);
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

    private static int thickness(Box box, boolean vertical) {
        return vertical ? box.width() : box.height();
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
                double cx = x.centerX();
                double cy = y.centerX();
                if (Math.abs(cx - cy) > tolerance) return Double.compare(cy, cx);
                return Integer.compare(x.top, y.top);
            }
            double rx = x.centerY();
            double ry = y.centerY();
            if (Math.abs(rx - ry) > tolerance) return Double.compare(rx, ry);
            return Integer.compare(x.left, y.left);
        };
    }

    private static boolean startsParagraph(Box previous, Box line, boolean vertical, double size) {
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

    static boolean hasKanji(String text) {
        for (int i = 0; i < text.length(); ) {
            int c = text.codePointAt(i);
            if (Character.UnicodeScript.of(c) == Character.UnicodeScript.HAN) return true;
            i += Character.charCount(c);
        }
        return false;
    }

    private static boolean isLatin(char c) {
        return c < 0x3000 && Character.isLetterOrDigit(c);
    }
}
