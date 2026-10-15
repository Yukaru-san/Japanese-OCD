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

    private static List<String> paragraphs(List<ReadingOrder.Line> lines, ReadingOrder.Layout layout) {
        List<String> result = new ArrayList<>();
        for (List<Integer> paragraph : layout.paragraphs) {
            List<String> parts = new ArrayList<>();
            for (int i : paragraph) parts.add(lines.get(i).text);
            result.add(ReadingOrder.join(parts));
        }
        return result;
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
}
