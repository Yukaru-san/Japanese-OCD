package com.yukarusan.japaneseocr;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Point;
import android.graphics.Rect;
import androidx.annotation.Nullable;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.google.android.gms.tasks.Task;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Wraps the ML Kit Japanese text recognizer and converts its results to JS objects.
 */
class OcrEngine {

    @Nullable
    private TextRecognizer recognizer;

    private volatile boolean ready = false;

    @Nullable
    private volatile String failure;

    /**
     * Creates the recognizer and runs a tiny warm-up image through it, so the model is loaded
     * before the first real frame.
     */
    void initialize() {
        try {
            recognizer = TextRecognition.getClient(new JapaneseTextRecognizerOptions.Builder().build());
        } catch (Exception e) {
            failure = "Could not create the Japanese text recognizer: " + e.getMessage();
            return;
        }

        Bitmap blank = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888);
        blank.eraseColor(Color.WHITE);
        recognizer
            .process(InputImage.fromBitmap(blank, 0))
            .addOnSuccessListener((text) -> ready = true)
            .addOnFailureListener((e) -> failure = "Japanese text recognizer failed to load: " + e.getMessage());
    }

    boolean isReady() {
        return ready && recognizer != null;
    }

    /** Usable for recognition: the recognizer exists and the warm-up did not fail. */
    boolean isUsable() {
        return recognizer != null && failure == null;
    }

    @Nullable
    String getFailure() {
        return failure;
    }

    Task<Text> process(InputImage image) {
        if (recognizer == null) {
            throw new IllegalStateException("Recognizer is not initialized");
        }
        return recognizer.process(image);
    }

    void close() {
        if (recognizer != null) {
            recognizer.close();
            recognizer = null;
        }
        ready = false;
    }

    /** A recognition result regrouped into paragraphs in reading order, with furigana split off. */
    static final class Arranged {

        final List<Text.Line> lines = new ArrayList<>();
        ReadingOrder.Layout layout;

        /** Lines ML Kit returned without a box; only used when no regions are given. */
        final List<Text.Line> unboxed = new ArrayList<>();
    }

    /**
     * @param regions only text inside these boxes (image pixels) is returned; null for everything
     */
    static Arranged arrange(Text text, @Nullable List<ReadingOrder.Box> regions) {
        Arranged arranged = new Arranged();
        List<ReadingOrder.Line> input = new ArrayList<>();
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                Rect box = line.getBoundingBox();
                if (box == null) {
                    if (regions == null) arranged.unboxed.add(line);
                    continue;
                }
                arranged.lines.add(line);
                input.add(new ReadingOrder.Line(line.getText(), box.left, box.top, box.right, box.bottom, glyphsOf(line)));
            }
        }
        arranged.layout = ReadingOrder.arrange(input, regions);
        return arranged;
    }

    /** The line's symbols with their word index, or an empty list if any symbol lacks a box. */
    private static List<ReadingOrder.Glyph> glyphsOf(Text.Line line) {
        List<ReadingOrder.Glyph> glyphs = new ArrayList<>();
        List<Text.Element> elements = line.getElements();
        for (int e = 0; e < elements.size(); e++) {
            for (Text.Symbol symbol : elements.get(e).getSymbols()) {
                Rect box = symbol.getBoundingBox();
                if (box == null) return Collections.emptyList();
                glyphs.add(new ReadingOrder.Glyph(symbol.getText(), e, box.left, box.top, box.right, box.bottom));
            }
        }
        return glyphs;
    }

    /**
     * Builds the JS result. Blocks are paragraphs in reading order; furigana are returned
     * separately and are not part of {@code text}, and each block lists its text split into
     * segments with their readings.
     */
    static JSObject toResult(Arranged arranged, int imageWidth, int imageHeight, @Nullable ViewMapper view) {
        ReadingOrder.Layout layout = arranged.layout;
        JSArray blocks = new JSArray();
        StringBuilder allText = new StringBuilder();

        int count = layout.paragraphs.size() + arranged.unboxed.size();
        for (int i = 0; i < count; i++) {
            JSObject blockObj = new JSObject();
            JSArray lines = new JSArray();
            String paragraphText;
            if (i < layout.paragraphs.size()) {
                ReadingOrder.Paragraph paragraph = layout.paragraphs.get(i);
                paragraphText = paragraph.text;
                Rect box = null;
                for (ReadingOrder.Part part : paragraph.parts) {
                    Text.Line line = arranged.lines.get(part.line);
                    lines.put(lineToJson(line, part.glyphs, view));
                    Rect partBox = new Rect(part.box.left, part.box.top, part.box.right, part.box.bottom);
                    if (box == null) box = partBox;
                    else box.union(partBox);
                }
                blockObj.put("recognizedLanguage", arranged.lines.get(paragraph.parts.get(0).line).getRecognizedLanguage());
                putGeometry(blockObj, box, box == null ? null : corners(box), view);
                if (paragraph.region >= 0) blockObj.put("region", paragraph.region);
                blockObj.put("segments", segmentsToJson(ReadingOrder.segments(paragraph.text, layout.ruby, i)));
            } else {
                Text.Line line = arranged.unboxed.get(i - layout.paragraphs.size());
                paragraphText = line.getText();
                blockObj.put("recognizedLanguage", line.getRecognizedLanguage());
                lines.put(lineToJson(line, null, view));
                blockObj.put("segments", segmentsToJson(Collections.singletonList(new ReadingOrder.Segment(paragraphText, null))));
            }
            blockObj.put("text", paragraphText);
            blockObj.put("lines", lines);
            blocks.put(blockObj);

            if (allText.length() > 0) allText.append('\n');
            allText.append(paragraphText);
        }

        JSArray furigana = new JSArray();
        for (ReadingOrder.Ruby ruby : layout.ruby) {
            JSObject reading = new JSObject();
            reading.put("text", ruby.reading);
            if (ruby.base != null) reading.put("base", ruby.base);
            if (ruby.paragraph >= 0) reading.put("block", ruby.paragraph);
            if (ruby.start >= 0) {
                reading.put("start", ruby.start);
                reading.put("end", ruby.end);
            }
            Rect box = new Rect(ruby.left, ruby.top, ruby.right, ruby.bottom);
            putGeometry(reading, box, corners(box), view);
            furigana.put(reading);
        }

        JSObject result = new JSObject();
        result.put("text", allText.toString());
        result.put("blocks", blocks);
        result.put("furigana", furigana);
        result.put("vertical", layout.vertical);
        result.put("imageWidth", imageWidth);
        result.put("imageHeight", imageHeight);
        return result;
    }

    private static JSArray segmentsToJson(List<ReadingOrder.Segment> segments) {
        JSArray result = new JSArray();
        for (ReadingOrder.Segment segment : segments) {
            JSObject obj = new JSObject();
            obj.put("text", segment.text);
            if (segment.reading != null) obj.put("reading", segment.reading);
            result.put(obj);
        }
        return result;
    }

    /**
     * @param glyphs indexes of the symbols to include (counted across the line's elements), or null
     *     for the whole line
     */
    private static JSObject lineToJson(Text.Line line, @Nullable List<Integer> glyphs, @Nullable ViewMapper view) {
        JSObject lineObj = new JSObject();
        lineObj.put("confidence", line.getConfidence());
        lineObj.put("recognizedLanguage", line.getRecognizedLanguage());

        JSArray elements = new JSArray();
        List<String> words = new ArrayList<>();
        Rect lineBox = null;
        int index = 0;
        for (Text.Element element : line.getElements()) {
            JSArray symbols = new JSArray();
            StringBuilder word = new StringBuilder();
            Rect wordBox = null;
            for (Text.Symbol symbol : element.getSymbols()) {
                boolean included = glyphs == null || glyphs.contains(index);
                index++;
                if (!included) continue;
                JSObject symbolObj = new JSObject();
                symbolObj.put("text", symbol.getText());
                symbolObj.put("confidence", symbol.getConfidence());
                putGeometry(symbolObj, symbol.getBoundingBox(), symbol.getCornerPoints(), view);
                symbols.put(symbolObj);
                word.append(symbol.getText());
                Rect box = symbol.getBoundingBox();
                if (box != null) {
                    if (wordBox == null) wordBox = new Rect(box);
                    else wordBox.union(box);
                }
            }
            if (glyphs != null && symbols.length() == 0) continue;

            JSObject elementObj = new JSObject();
            elementObj.put("text", glyphs == null ? element.getText() : word.toString());
            elementObj.put("confidence", element.getConfidence());
            if (glyphs == null) {
                putGeometry(elementObj, element.getBoundingBox(), element.getCornerPoints(), view);
            } else {
                putGeometry(elementObj, wordBox, wordBox == null ? null : corners(wordBox), view);
            }
            elementObj.put("symbols", symbols);
            elements.put(elementObj);
            words.add(glyphs == null ? element.getText() : word.toString());
            if (wordBox != null) {
                if (lineBox == null) lineBox = new Rect(wordBox);
                else lineBox.union(wordBox);
            }
        }

        if (glyphs == null) {
            lineObj.put("text", line.getText());
            putGeometry(lineObj, line.getBoundingBox(), line.getCornerPoints(), view);
        } else {
            lineObj.put("text", ReadingOrder.join(words));
            putGeometry(lineObj, lineBox, lineBox == null ? null : corners(lineBox), view);
        }
        lineObj.put("elements", elements);
        return lineObj;
    }

    private static Point[] corners(Rect box) {
        return new Point[] {
            new Point(box.left, box.top),
            new Point(box.right, box.top),
            new Point(box.right, box.bottom),
            new Point(box.left, box.bottom)
        };
    }

    private static void putGeometry(JSObject target, @Nullable Rect box, @Nullable Point[] corners, @Nullable ViewMapper view) {
        if (box != null) {
            JSObject rect = new JSObject();
            rect.put("left", box.left);
            rect.put("top", box.top);
            rect.put("right", box.right);
            rect.put("bottom", box.bottom);
            target.put("boundingBox", rect);
            if (view != null) {
                target.put("viewBoundingBox", view.mapRect(box));
            }
        }
        if (corners != null) {
            JSArray points = new JSArray();
            for (Point p : corners) {
                JSObject point = new JSObject();
                point.put("x", p.x);
                point.put("y", p.y);
                points.put(point);
            }
            target.put("cornerPoints", points);
            if (view != null) {
                target.put("viewCornerPoints", view.mapPoints(corners));
            }
        }
    }
}
