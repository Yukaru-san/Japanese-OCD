package com.yukarusan.japaneseocr;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import androidx.annotation.Nullable;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.vision.digitalink.common.RecognitionCandidate;
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognition;
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognitionModel;
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognitionModelIdentifier;
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognizer;
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognizerOptions;
import com.google.mlkit.vision.digitalink.recognition.Ink;
import com.google.mlkit.vision.digitalink.recognition.RecognitionContext;
import com.google.mlkit.vision.digitalink.recognition.WritingArea;
import java.util.ArrayList;
import java.util.List;

/**
 * Japanese handwriting recognition with ML Kit Digital Ink. The model (about 20 MB) is downloaded
 * on first use and then works offline.
 */
class HandwritingEngine {

    /** One stroke: x, y and t (milliseconds, or null) per point. */
    static final class Stroke {

        final float[] x;
        final float[] y;
        final Long[] t;

        Stroke(float[] x, float[] y, Long[] t) {
            this.x = x;
            this.y = y;
            this.t = t;
        }
    }

    @Nullable
    private DigitalInkRecognitionModel model;

    @Nullable
    private DigitalInkRecognizer recognizer;

    @Nullable
    private Task<Void> download;

    private synchronized DigitalInkRecognitionModel model() {
        if (model == null) {
            model = DigitalInkRecognitionModel.builder(DigitalInkRecognitionModelIdentifier.JA).build();
        }
        return model;
    }

    Task<Boolean> isReady() {
        return RemoteModelManager.getInstance().isModelDownloaded(model());
    }

    /**
     * Downloads the model if needed. Concurrent calls share one download. Fails at once when the
     * model is missing and the device is offline: ML Kit would otherwise queue the download until a
     * network shows up and the call would never finish (e.g. on GrapheneOS with the app's Network
     * permission turned off).
     */
    synchronized Task<Void> download(Context context, boolean requireWifi) {
        if (download != null && !download.isComplete()) return download;
        download = isReady().continueWithTask((downloaded) -> {
            if (downloaded.isSuccessful() && Boolean.TRUE.equals(downloaded.getResult())) return Tasks.forResult(null);
            if (!isOnline(context)) {
                return Tasks.forException(
                    new IllegalStateException(
                        "no internet connection. The model (about 20 MB) is downloaded once; allow the app network access and try again."
                    )
                );
            }
            DownloadConditions.Builder conditions = new DownloadConditions.Builder();
            if (requireWifi) conditions.requireWifi();
            return RemoteModelManager.getInstance().download(model(), conditions.build());
        });
        return download;
    }

    private static boolean isOnline(Context context) {
        ConnectivityManager connectivity = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivity == null) return true; // can't tell; let ML Kit try
        NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(connectivity.getActiveNetwork());
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private synchronized DigitalInkRecognizer recognizer() {
        if (recognizer == null) {
            recognizer = DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(model()).build());
        }
        return recognizer;
    }

    /**
     * Recognizes the strokes. Rows written one below the other are recognized one by one (the
     * recognizer expects a single line) and their candidates combined, so a sentence may span
     * several rows.
     *
     * @param width width of the drawing area, or 0 when unknown
     * @param height height of the drawing area, or 0 when unknown
     */
    Task<List<InkLines.Candidate>> recognize(List<Stroke> strokes, String preContext, float width, float height, int limit) {
        List<InkLines.Span> spans = new ArrayList<>();
        for (int i = 0; i < strokes.size(); i++) {
            Stroke s = strokes.get(i);
            float top = Float.POSITIVE_INFINITY;
            float bottom = Float.NEGATIVE_INFINITY;
            float left = Float.POSITIVE_INFINITY;
            float right = Float.NEGATIVE_INFINITY;
            for (int j = 0; j < s.y.length; j++) {
                top = Math.min(top, s.y[j]);
                bottom = Math.max(bottom, s.y[j]);
                left = Math.min(left, s.x[j]);
                right = Math.max(right, s.x[j]);
            }
            spans.add(new InkLines.Span(i, top, bottom, Math.max(bottom - top, right - left)));
        }
        List<List<Integer>> rows = InkLines.rows(spans);
        Task<List<InkLines.Candidate>> chain = Tasks.forResult(new ArrayList<>());
        for (List<Integer> row : rows) {
            chain = chain.continueWithTask((previous) -> {
                if (!previous.isSuccessful()) return previous;
                List<InkLines.Candidate> sofar = previous.getResult();
                String context = sofar.isEmpty() ? preContext : preContext + sofar.get(0).text;
                return recognizeRow(strokes, row, context, width, height, rows.size() > 1).continueWith((task) ->
                    InkLines.combine(sofar, task.getResult(), limit)
                );
            });
        }
        return chain;
    }

    private Task<List<InkLines.Candidate>> recognizeRow(
        List<Stroke> strokes,
        List<Integer> row,
        String preContext,
        float width,
        float height,
        boolean severalRows
    ) {
        Ink.Builder ink = Ink.builder();
        float top = Float.POSITIVE_INFINITY;
        float bottom = Float.NEGATIVE_INFINITY;
        for (int index : row) {
            Stroke s = strokes.get(index);
            Ink.Stroke.Builder stroke = Ink.Stroke.builder();
            for (int i = 0; i < s.x.length; i++) {
                stroke.addPoint(s.t[i] != null ? Ink.Point.create(s.x[i], s.y[i], s.t[i]) : Ink.Point.create(s.x[i], s.y[i]));
                top = Math.min(top, s.y[i]);
                bottom = Math.max(bottom, s.y[i]);
            }
            ink.addStroke(stroke.build());
        }
        RecognitionContext.Builder context = RecognitionContext.builder().setPreContext(tail(preContext));
        if (width > 0 && height > 0) {
            // With several rows, the area of one row is its own height: the recognizer uses the
            // area to judge character size (e.g. small つ vs. つ).
            float rowHeight = severalRows ? Math.max(bottom - top, 1) : height;
            context.setWritingArea(new WritingArea(width, rowHeight));
        }
        return recognizer()
            .recognize(ink.build(), context.build())
            .continueWith((task) -> {
                List<InkLines.Candidate> out = new ArrayList<>();
                int rank = 0;
                for (RecognitionCandidate c : task.getResult().getCandidates()) {
                    Float score = c.getScore();
                    // Without scores, rank order stands in for them.
                    out.add(new InkLines.Candidate(c.getText(), score != null ? score : rank));
                    rank++;
                }
                return out;
            });
    }

    /** ML Kit uses at most the last 20 characters of the pre-context. */
    private static String tail(String text) {
        return text.length() > 20 ? text.substring(text.length() - 20) : text;
    }

    synchronized void close() {
        if (recognizer != null) {
            recognizer.close();
            recognizer = null;
        }
    }
}
