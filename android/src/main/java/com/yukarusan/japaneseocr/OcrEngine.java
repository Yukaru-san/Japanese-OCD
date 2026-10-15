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

    /** Lines of a result regrouped into paragraphs in reading order, with furigana split off. */
    static final class Arranged {

        final List<List<Text.Line>> paragraphs = new ArrayList<>();
        final List<Text.Line> furigana = new ArrayList<>();
        final List<Text.Line> main = new ArrayList<>();
        boolean vertical;
    }

    static Arranged arrange(Text text) {
        Arranged arranged = new Arranged();
        List<Text.Line> boxed = new ArrayList<>();
        List<ReadingOrder.Line> input = new ArrayList<>();
        List<Text.Line> unboxed = new ArrayList<>();
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                Rect box = line.getBoundingBox();
                if (box == null) {
                    unboxed.add(line);
                    continue;
                }
                boxed.add(line);
                input.add(new ReadingOrder.Line(line.getText(), box.left, box.top, box.right, box.bottom));
            }
        }

        ReadingOrder.Layout layout = ReadingOrder.arrange(input);
        arranged.vertical = layout.vertical;
        for (List<Integer> indexes : layout.paragraphs) {
            List<Text.Line> paragraph = new ArrayList<>();
            for (int i : indexes) paragraph.add(boxed.get(i));
            arranged.paragraphs.add(paragraph);
            arranged.main.addAll(paragraph);
        }
        for (int i : layout.furigana) arranged.furigana.add(boxed.get(i));
        for (Text.Line line : unboxed) {
            arranged.paragraphs.add(Collections.singletonList(line));
        }
        return arranged;
    }

    static String paragraphText(List<Text.Line> lines) {
        List<String> parts = new ArrayList<>();
        for (Text.Line line : lines) parts.add(line.getText());
        return ReadingOrder.join(parts);
    }

    /** Text of every paragraph (result block) in reading order. */
    static List<String> blockTexts(Text text) {
        List<String> result = new ArrayList<>();
        for (List<Text.Line> paragraph : arrange(text).paragraphs) {
            result.add(paragraphText(paragraph));
        }
        return result;
    }

    /**
     * Builds the JS result. Blocks are paragraphs in reading order; furigana are returned
     * separately and are not part of {@code text}.
     *
     * @param translations one entry per block, or null when translation is off
     */
    static JSObject toResult(
        Text text,
        int imageWidth,
        int imageHeight,
        @Nullable List<String> translations,
        @Nullable String targetLanguage,
        @Nullable ViewMapper view
    ) {
        Arranged arranged = arrange(text);
        JSArray blocks = new JSArray();
        StringBuilder allText = new StringBuilder();
        StringBuilder allTranslated = new StringBuilder();

        for (int i = 0; i < arranged.paragraphs.size(); i++) {
            List<Text.Line> paragraph = arranged.paragraphs.get(i);
            String paragraphText = paragraphText(paragraph);
            JSObject blockObj = new JSObject();
            blockObj.put("text", paragraphText);
            blockObj.put("recognizedLanguage", paragraph.get(0).getRecognizedLanguage());
            Rect box = union(paragraph);
            putGeometry(blockObj, box, box == null ? null : corners(box), view);

            if (translations != null && i < translations.size()) {
                blockObj.put("translatedText", translations.get(i));
                if (allTranslated.length() > 0) allTranslated.append('\n');
                allTranslated.append(translations.get(i));
            }

            JSArray lines = new JSArray();
            for (Text.Line line : paragraph) {
                lines.put(lineToJson(line, view));
            }
            blockObj.put("lines", lines);
            blocks.put(blockObj);

            if (allText.length() > 0) allText.append('\n');
            allText.append(paragraphText);
        }

        JSArray furigana = new JSArray();
        for (Text.Line line : arranged.furigana) {
            JSObject reading = new JSObject();
            reading.put("text", line.getText().replaceAll("\\s+", ""));
            String base = baseText(line, arranged.main, arranged.vertical);
            if (base != null) reading.put("base", base);
            putGeometry(reading, line.getBoundingBox(), line.getCornerPoints(), view);
            furigana.put(reading);
        }

        JSObject result = new JSObject();
        result.put("text", allText.toString());
        if (translations != null) {
            result.put("translatedText", allTranslated.toString());
            result.put("targetLanguage", targetLanguage);
        }
        result.put("blocks", blocks);
        result.put("furigana", furigana);
        result.put("vertical", arranged.vertical);
        result.put("imageWidth", imageWidth);
        result.put("imageHeight", imageHeight);
        return result;
    }

    private static JSObject lineToJson(Text.Line line, @Nullable ViewMapper view) {
        JSObject lineObj = new JSObject();
        lineObj.put("text", line.getText());
        lineObj.put("confidence", line.getConfidence());
        lineObj.put("recognizedLanguage", line.getRecognizedLanguage());
        putGeometry(lineObj, line.getBoundingBox(), line.getCornerPoints(), view);

        JSArray elements = new JSArray();
        for (Text.Element element : line.getElements()) {
            JSObject elementObj = new JSObject();
            elementObj.put("text", element.getText());
            elementObj.put("confidence", element.getConfidence());
            putGeometry(elementObj, element.getBoundingBox(), element.getCornerPoints(), view);

            JSArray symbols = new JSArray();
            for (Text.Symbol symbol : element.getSymbols()) {
                JSObject symbolObj = new JSObject();
                symbolObj.put("text", symbol.getText());
                symbolObj.put("confidence", symbol.getConfidence());
                putGeometry(symbolObj, symbol.getBoundingBox(), symbol.getCornerPoints(), view);
                symbols.put(symbolObj);
            }
            elementObj.put("symbols", symbols);
            elements.put(elementObj);
        }
        lineObj.put("elements", elements);
        return lineObj;
    }

    /**
     * The characters a furigana line is printed over: in the nearest main line below it (or to its
     * left in vertical text), the characters within its extent.
     */
    @Nullable
    private static String baseText(Text.Line reading, List<Text.Line> main, boolean vertical) {
        Rect r = reading.getBoundingBox();
        if (r == null) return null;
        int size = vertical ? r.width() : r.height();

        Text.Line nearest = null;
        int nearestDistance = Integer.MAX_VALUE;
        for (Text.Line line : main) {
            Rect b = line.getBoundingBox();
            if (b == null) continue;
            int distance;
            if (vertical) {
                boolean overlaps = b.top < r.bottom && b.bottom > r.top;
                distance = r.left - b.right;
                if (!overlaps || b.centerX() >= r.centerX()) continue;
            } else {
                boolean overlaps = b.left < r.right && b.right > r.left;
                distance = b.top - r.bottom;
                if (!overlaps || b.centerY() <= r.centerY()) continue;
            }
            distance = Math.abs(distance);
            if (distance < nearestDistance && distance < size * 3) {
                nearest = line;
                nearestDistance = distance;
            }
        }
        if (nearest == null) return null;

        int from = (vertical ? r.top : r.left) - size / 2;
        int to = (vertical ? r.bottom : r.right) + size / 2;
        StringBuilder base = new StringBuilder();
        for (Text.Element element : nearest.getElements()) {
            for (Text.Symbol symbol : element.getSymbols()) {
                Rect s = symbol.getBoundingBox();
                if (s == null) continue;
                int center = vertical ? s.centerY() : s.centerX();
                if (center >= from && center <= to) base.append(symbol.getText());
            }
        }
        return base.length() > 0 ? base.toString() : null;
    }

    @Nullable
    private static Rect union(List<Text.Line> lines) {
        Rect result = null;
        for (Text.Line line : lines) {
            Rect box = line.getBoundingBox();
            if (box == null) continue;
            if (result == null) result = new Rect(box);
            else result.union(box);
        }
        return result;
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
