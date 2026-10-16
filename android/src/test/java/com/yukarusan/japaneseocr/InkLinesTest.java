package com.yukarusan.japaneseocr;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import java.util.List;
import org.junit.Test;

public class InkLinesTest {

    private static InkLines.Candidate c(String text, double score) {
        return new InkLines.Candidate(text, score);
    }

    @Test
    public void overlappingStrokesFormOneRow() {
        List<List<Integer>> rows = InkLines.rows(
            Arrays.asList(new InkLines.Span(0, 10, 50, 40), new InkLines.Span(1, 30, 60, 40), new InkLines.Span(2, 55, 58, 40))
        );
        assertEquals(Arrays.asList(Arrays.asList(0, 1, 2)), rows);
    }

    @Test
    public void gapSplitsRowsTopToBottomKeepingDrawingOrder() {
        // Second row drawn first, then the first row, then one more stroke in the second row.
        List<List<Integer>> rows = InkLines.rows(
            Arrays.asList(
                new InkLines.Span(0, 100, 140, 40),
                new InkLines.Span(1, 10, 50, 40),
                new InkLines.Span(2, 12, 48, 40),
                new InkLines.Span(3, 105, 150, 40)
            )
        );
        assertEquals(Arrays.asList(Arrays.asList(1, 2), Arrays.asList(0, 3)), rows);
    }

    @Test
    public void barsOfOneCharacterStayInOneRow() {
        // 三: three horizontal bars, 40 wide, with gaps between them.
        List<List<Integer>> three = InkLines.rows(
            Arrays.asList(new InkLines.Span(0, 10, 12, 30), new InkLines.Span(1, 28, 30, 25), new InkLines.Span(2, 48, 51, 40))
        );
        assertEquals(Arrays.asList(Arrays.asList(0, 1, 2)), three);
    }

    @Test
    public void flatCharacterInASentenceJoinsItsRowOnly() {
        // Row 1: 三 (bars at 10, 28, 48); row 2, a character at 100–141, starts more than one character below.
        List<List<Integer>> rows = InkLines.rows(
            Arrays.asList(
                new InkLines.Span(0, 10, 12, 30),
                new InkLines.Span(1, 28, 30, 25),
                new InkLines.Span(2, 48, 51, 40),
                new InkLines.Span(3, 100, 140, 40),
                new InkLines.Span(4, 102, 141, 40)
            )
        );
        assertEquals(Arrays.asList(Arrays.asList(0, 1, 2), Arrays.asList(3, 4)), rows);
    }

    @Test
    public void combineAddsScoresAndKeepsBest() {
        List<InkLines.Candidate> first = InkLines.combine(
            Arrays.<InkLines.Candidate>asList(),
            Arrays.asList(c("今日は", 1), c("今日わ", 3)),
            5
        );
        List<InkLines.Candidate> both = InkLines.combine(first, Arrays.asList(c("晴れ", 1), c("暗れ", 2), c("晴れ", 4)), 3);
        assertEquals(3, both.size());
        assertEquals("今日は晴れ", both.get(0).text);
        assertEquals(2, both.get(0).score, 1e-9);
        assertEquals("今日は暗れ", both.get(1).text);
        assertEquals("今日わ晴れ", both.get(2).text);
    }

    @Test
    public void joinSeparatesLatinWordsOnly() {
        assertEquals("今日は晴れ", InkLines.join("今日は", "晴れ"));
        assertEquals("hello world", InkLines.join("hello", "world"));
        assertEquals("ABCです", InkLines.join("ABC", "です"));
    }

    @Test
    public void probabilitiesAreSoftmaxOfNegatedScores() {
        double[] p = InkLines.probabilities(Arrays.asList(c("a", 1), c("b", 1 + Math.log(3))));
        assertEquals(0.75, p[0], 1e-9);
        assertEquals(0.25, p[1], 1e-9);
        assertEquals(0, InkLines.probabilities(Arrays.<InkLines.Candidate>asList()).length);
    }
}
