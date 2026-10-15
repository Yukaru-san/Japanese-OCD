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

    static List<String> blockTexts(Text text) {
        List<String> result = new ArrayList<>();
        for (Text.TextBlock block : text.getTextBlocks()) {
            result.add(block.getText());
        }
        return result;
    }

    /**
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
        JSArray blocks = new JSArray();
        StringBuilder allText = new StringBuilder();
        StringBuilder allTranslated = new StringBuilder();

        List<Text.TextBlock> textBlocks = text.getTextBlocks();
        for (int i = 0; i < textBlocks.size(); i++) {
            Text.TextBlock block = textBlocks.get(i);
            JSObject blockObj = new JSObject();
            blockObj.put("text", block.getText());
            blockObj.put("recognizedLanguage", block.getRecognizedLanguage());
            putGeometry(blockObj, block.getBoundingBox(), block.getCornerPoints(), view);

            if (translations != null && i < translations.size()) {
                blockObj.put("translatedText", translations.get(i));
                if (allTranslated.length() > 0) allTranslated.append('\n');
                allTranslated.append(translations.get(i));
            }

            JSArray lines = new JSArray();
            for (Text.Line line : block.getLines()) {
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
                lines.put(lineObj);
            }
            blockObj.put("lines", lines);
            blocks.put(blockObj);

            if (allText.length() > 0) allText.append('\n');
            allText.append(block.getText());
        }

        JSObject result = new JSObject();
        result.put("text", allText.toString());
        if (translations != null) {
            result.put("translatedText", allTranslated.toString());
            result.put("targetLanguage", targetLanguage);
        }
        result.put("blocks", blocks);
        result.put("imageWidth", imageWidth);
        result.put("imageHeight", imageHeight);
        return result;
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
