package com.yukarusan.japaneseocr;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;

public class ReadingOrderTest {

    private static ReadingOrder.Line line(String text, int left, int top, int right, int bottom) {
        return new ReadingOrder.Line(text, left, top, right, bottom);
    }

    /** A line with evenly spaced characters; spaces separate words and take one character width. */
    private static ReadingOrder.Line glyphs(String text, int left, int top, int charWidth, int height) {
        List<ReadingOrder.Glyph> glyphs = new ArrayList<>();
        int x = left;
        int word = 0;
        for (int i = 0; i < text.length(); i++) {
            String c = text.substring(i, i + 1);
            if (c.equals(" ")) {
                word++;
            } else {
                glyphs.add(new ReadingOrder.Glyph(c, word, x, top, x + charWidth, top + height));
            }
            x += charWidth;
        }
        return new ReadingOrder.Line(text, left, top, x, top + height, glyphs);
    }

    private static List<String> paragraphs(List<ReadingOrder.Line> lines, ReadingOrder.Layout layout) {
        List<String> result = new ArrayList<>();
        for (ReadingOrder.Paragraph paragraph : layout.paragraphs) result.add(paragraph.text);
        return result;
    }

    private static List<String> ruby(ReadingOrder.Layout layout) {
        List<String> result = new ArrayList<>();
        for (ReadingOrder.Ruby r : layout.ruby) {
            String placed = r.start >= 0 ? layout.paragraphs.get(r.paragraph).text.substring(r.start, r.end) : "?";
            result.add(r.base + "=" + r.reading + "@" + placed);
        }
        return result;
    }

    private static String rubyText(ReadingOrder.Layout layout, int paragraph) {
        StringBuilder text = new StringBuilder();
        for (ReadingOrder.Segment s : ReadingOrder.segments(layout.paragraphs.get(paragraph).text, layout.ruby, paragraph)) {
            text.append(s.reading == null ? s.text : s.text + "(" + s.reading + ")");
        }
        return text.toString();
    }

    private static List<String> furigana(List<ReadingOrder.Line> lines, ReadingOrder.Layout layout) {
        List<String> result = new ArrayList<>();
        for (int i : layout.furigana) result.add(lines.get(i).text);
        return result;
    }

    /** Layout of a reading app page with furigana, lines given in ML Kit's scrambled order. */
    @Test
    public void ordersArticleAndSeparatesFurigana() {
        List<ReadingOrder.Line> lines = Arrays.asList(
            line("いたの?", 110, 1262, 320, 1310),
            line("なせ日本の学校では女子の", 107, 1076, 777, 1126),
            line("2026-10-14", 108, 1342, 298, 1372),
            line("にほん", 222, 1052, 322, 1074),
            line("がっこう", 384, 1052, 500, 1074),
            line("ポニーテールが禁止されて", 107, 1168, 770, 1218),
            line("にほん", 108, 1382, 195, 1402),
            line("日本の学校では、女子がポニー", 108, 1404, 772, 1446),
            line("テールにしてはいけないところが", 108, 1480, 815, 1522),
            line("ありました。どうしてでしょう", 108, 1556, 768, 1598),
            line("か。", 108, 1634, 180, 1676),
            line("がっこう", 108, 1690, 210, 1710),
            line("学校の先生の中には、髪を結ぶ", 108, 1712, 784, 1754),
            line("きんし", 500, 1144, 600, 1166),
            line("じょし", 620, 1052, 718, 1074)
        );
        ReadingOrder.Layout layout = ReadingOrder.arrange(lines);

        assertFalse(layout.vertical);
        assertEquals(
            Arrays.asList(
                "なせ日本の学校では女子のポニーテールが禁止されていたの?",
                "2026-10-14",
                "日本の学校では、女子がポニーテールにしてはいけないところがありました。どうしてでしょうか。学校の先生の中には、髪を結ぶ"
            ),
            paragraphs(lines, layout)
        );
        assertEquals(Arrays.asList("にほん", "がっこう", "じょし", "きんし", "にほん", "がっこう"), furigana(lines, layout));
    }

    @Test
    public void ordersVerticalColumnsRightToLeft() {
        List<ReadingOrder.Line> lines = Arrays.asList(
            line("ふたつめ", 100, 0, 140, 300),
            line("ひとつめのぎょう", 160, 0, 200, 600),
            line("みっつめ", 40, 0, 80, 250)
        );
        ReadingOrder.Layout layout = ReadingOrder.arrange(lines);

        assertTrue(layout.vertical);
        assertEquals(Arrays.asList("ひとつめのぎょうふたつめみっつめ"), paragraphs(lines, layout));
        assertTrue(layout.furigana.isEmpty());
    }

    @Test
    public void keepsSmallKanjiTextAndSideBySideItemsApart() {
        List<ReadingOrder.Line> lines = Arrays.asList(
            line("本文の一行目です", 0, 100, 400, 140),
            line("本文の二行目です", 0, 160, 400, 200),
            line("注意", 0, 260, 40, 280), // small but kanji: not furigana
            line("Tomo Chat", 600, 100, 800, 140)
        );
        ReadingOrder.Layout layout = ReadingOrder.arrange(lines);

        assertTrue(layout.furigana.isEmpty());
        assertEquals(Arrays.asList("本文の一行目です", "Tomo Chat", "本文の二行目です", "注意"), paragraphs(lines, layout));
    }

    @Test
    public void joinsLatinWithSpace() {
        assertEquals("Tomo Chat app", ReadingOrder.join(Arrays.asList("Tomo Chat", "app")));
        assertEquals("日本語です", ReadingOrder.join(Arrays.asList("日本語", "です")));
    }

    /**
     * Heading furigana is about as tall as body text, so the page-wide size check misses it; it
     * still has to be recognized by the heading it sits on. Readings of neighbouring words that
     * ML Kit merged into one line are split and paired with their kanji.
     */
    @Test
    public void pairsHeadingFuriganaWithItsKanji() {
        List<ReadingOrder.Line> lines = Arrays.asList(
            glyphs("32", 700, 20, 20, 30), // UI badge
            glyphs("にほん がっこう", 205, 100, 30, 36),
            glyphs("じょし", 555, 100, 30, 36),
            glyphs("なぜ日本の学校では女子の", 100, 140, 50, 56),
            glyphs("にほん   がっこう", 113, 300, 18, 22),
            glyphs("日本の学校では、女子が", 100, 324, 40, 44),
            glyphs("がっこう   せんせい", 104, 400, 18, 22),
            glyphs("学校の先生の中には", 100, 424, 40, 44),
            glyphs("たのしいです", 100, 480, 40, 44)
        );
        ReadingOrder.Layout layout = ReadingOrder.arrange(lines);

        assertEquals(
            Arrays.asList("32", "なぜ日本の学校では女子の", "日本の学校では、女子が学校の先生の中にはたのしいです"),
            paragraphs(lines, layout)
        );
        assertEquals("なぜ日本(にほん)の学校(がっこう)では女子(じょし)の", rubyText(layout, 1));
        assertTrue(ruby(layout).contains("先生=せんせい@先生"));
    }

    /** A selected region returns only its text, with the furigana printed just above it. */
    @Test
    public void selectsRegionWithItsFurigana() {
        List<ReadingOrder.Line> lines = Arrays.asList(
            glyphs("32", 700, 20, 20, 30),
            glyphs("にほん", 113, 300, 18, 22),
            glyphs("日本の学校では、女子が", 100, 324, 40, 44),
            glyphs("がっこう", 104, 400, 18, 22),
            glyphs("学校の先生の中には", 100, 424, 40, 44)
        );
        // Covers the first main line only; its furigana lies above the region.
        List<ReadingOrder.Box> regions = Arrays.asList(new ReadingOrder.Box(90, 320, 600, 370));
        ReadingOrder.Layout layout = ReadingOrder.arrange(lines, regions);

        assertEquals(Arrays.asList("日本の学校では、女子が"), paragraphs(lines, layout));
        assertEquals(Arrays.asList("日本=にほん@日本"), ruby(layout));
        assertEquals(0, layout.paragraphs.get(0).region);

        // Part of a line: only the characters inside, readings still placed.
        regions = Arrays.asList(new ReadingOrder.Box(90, 320, 310, 370), new ReadingOrder.Box(90, 420, 300, 470));
        layout = ReadingOrder.arrange(lines, regions);
        assertEquals(Arrays.asList("日本の学校", "学校の先生"), paragraphs(lines, layout));
        assertEquals("日本(にほん)の学校", rubyText(layout, 0));
        assertEquals("学校(がっこう)の先生", rubyText(layout, 1));
        assertEquals(1, layout.paragraphs.get(1).region);
    }

    @Test
    public void findsKanji() {
        assertTrue(ReadingOrder.hasKanji("ポニーテールが禁止"));
        assertFalse(ReadingOrder.hasKanji("にほん がっこう"));
    }
}
