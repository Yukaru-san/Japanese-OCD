package com.yukarusan.japaneseocr;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import androidx.activity.result.ActivityResult;
import androidx.annotation.Nullable;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The Capacitor entry point on Android: every {@code @PluginMethod} here is a method of
 * {@code JapaneseOcr} in JS. This class only checks the call's options, picks the engine for the
 * job and turns its outcome into a resolved or rejected call:
 *
 * <ul>
 *   <li>{@link OcrEngine}: ML Kit text recognition and the JS result format</li>
 *   <li>{@link LiveCameraController}: camera preview behind the WebView, live frames, capture</li>
 *   <li>{@link RegionSelector}: the rotate-and-frame screen for still images</li>
 *   <li>{@link HandwritingEngine}: ML Kit digital ink (handwriting)</li>
 * </ul>
 */
@CapacitorPlugin(
    name = "JapaneseOcr",
    permissions = { @Permission(alias = JapaneseOcrPlugin.CAMERA, strings = { Manifest.permission.CAMERA }) }
)
public class JapaneseOcrPlugin extends Plugin {

    static final String CAMERA = "camera";

    // Error codes, see JapaneseOcrErrorCode in src/definitions.ts.
    private static final String UNAVAILABLE = "UNAVAILABLE";
    private static final String NOT_READY = "NOT_READY";
    private static final String PERMISSION_DENIED = "PERMISSION_DENIED";
    private static final String CAMERA_ERROR = "CAMERA_ERROR";
    private static final String ALREADY_RUNNING = "ALREADY_RUNNING";
    private static final String NOT_RUNNING = "NOT_RUNNING";
    private static final String INVALID_ARGUMENT = "INVALID_ARGUMENT";
    private static final String RECOGNITION_FAILED = "RECOGNITION_FAILED";
    private static final String CANCELLED = "CANCELLED";
    private static final String HANDWRITING_NOT_READY = "HANDWRITING_NOT_READY";

    private static final int MIN_SDK = 24;
    private static final String MIN_SDK_MESSAGE = "Android " + MIN_SDK + " (API level) or newer is required.";

    private final OcrEngine ocr = new OcrEngine();
    private final HandwritingEngine handwriting = new HandwritingEngine();

    /** Decodes still images off the main thread. */
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @Nullable
    private LiveCameraController live;

    /** The captureFrame() call waiting for its photo, so stopLiveRecognition() can reject it. */
    @Nullable
    private PluginCall pendingCapture;

    @Override
    public void load() {
        // Check the Play Services model with the app and start its download if needed, so the
        // first call doesn't wait for it.
        if (isSdkSupported()) {
            ocr.initialize(getContext());
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopLive();
        ocr.close();
        handwriting.close();
        worker.shutdown();
    }

    // Support checks

    private static boolean isSdkSupported() {
        return Build.VERSION.SDK_INT >= MIN_SDK;
    }

    @Nullable
    private String unsupportedReason() {
        if (!isSdkSupported()) {
            return MIN_SDK_MESSAGE;
        }
        if (!ocr.isSupported()) {
            String failure = ocr.getFailure();
            return failure != null ? failure : "The Japanese text recognizer is not available.";
        }
        return null;
    }

    private boolean hasCamera() {
        return getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY);
    }

    @PluginMethod
    public void isDeviceSupported(PluginCall call) {
        String reason = unsupportedReason();
        boolean supported = reason == null;
        boolean camera = supported && hasCamera();
        if (supported && !camera) {
            reason = "The device has no camera, so only recognizeImage() is available.";
        }
        JSObject result = new JSObject();
        result.put("supported", supported);
        result.put("liveCamera", camera);
        result.put("handwriting", isSdkSupported());
        result.put("playServices", ocr.getModel() != OcrEngine.Model.UNAVAILABLE);
        if (reason != null) result.put("reason", reason);
        call.resolve(result);
    }

    @PluginMethod
    public void isOcrReady(PluginCall call) {
        JSObject result = readyResult(ocr.isReady());
        OcrEngine.Model model = isSdkSupported() ? ocr.getModel() : OcrEngine.Model.UNAVAILABLE;
        result.put("model", model.name().toLowerCase(Locale.ROOT));
        if (model == OcrEngine.Model.DOWNLOADING && ocr.getProgress() >= 0) {
            result.put("progress", ocr.getProgress());
        }
        String message = ocr.getFailure() != null ? ocr.getFailure() : ocr.getDownloadFailure();
        if (!isSdkSupported()) message = MIN_SDK_MESSAGE;
        if (message != null && model != OcrEngine.Model.INSTALLED) result.put("message", message);
        call.resolve(result);
    }

    @PluginMethod
    public void prepareOcr(PluginCall call) {
        String reason = unsupportedReason();
        if (reason != null) {
            call.reject(reason, UNAVAILABLE);
            return;
        }
        ocr.download().addOnCompleteListener((task) -> {
            if (task.isSuccessful()) {
                call.resolve();
            } else {
                call.reject(errorMessage(task.getException(), "Downloading the Japanese OCR model failed."), NOT_READY);
            }
        });
    }

    /** Rejects the call and returns false when OCR cannot run (yet). */
    private boolean ensureOcr(PluginCall call) {
        String reason = unsupportedReason();
        if (reason != null) {
            boolean permanent = !isSdkSupported() || ocr.getModel() == OcrEngine.Model.UNAVAILABLE;
            call.reject(reason, permanent ? UNAVAILABLE : NOT_READY);
            return false;
        }
        if (!ocr.isUsable()) {
            String message =
                ocr.getModel() == OcrEngine.Model.DOWNLOADING
                    ? "The Japanese OCR model is still being downloaded by Google Play Services."
                    : "The Japanese OCR model is not on this device yet; call prepareOcr() to download it.";
            String failed = ocr.getDownloadFailure();
            call.reject(
                failed != null && ocr.getModel() == OcrEngine.Model.MISSING ? failed + " Call prepareOcr() to retry." : message,
                NOT_READY
            );
            return false;
        }
        return true;
    }

    // Live recognition

    @PluginMethod
    public void startLiveRecognition(PluginCall call) {
        if (!ensureOcr(call)) return;
        if (!hasCamera()) {
            call.reject("The device has no camera.", UNAVAILABLE);
            return;
        }
        if (live != null && live.isRunning()) {
            call.reject("Live recognition is already running.", ALREADY_RUNNING);
            return;
        }
        if (getPermissionState(CAMERA) != PermissionState.GRANTED) {
            requestPermissionForAlias(CAMERA, call, "cameraPermissionCallback");
            return;
        }
        openCamera(call);
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        if (getPermissionState(CAMERA) != PermissionState.GRANTED) {
            call.reject("Camera permission was denied.", PERMISSION_DENIED);
            return;
        }
        openCamera(call);
    }

    private void openCamera(PluginCall call) {
        boolean front = "front".equals(call.getString("lensFacing", "back"));
        long interval = call.getInt("intervalMs", 500);
        getActivity().runOnUiThread(() -> {
            if (live != null && live.isRunning()) {
                call.reject("Live recognition is already running.", ALREADY_RUNNING);
                return;
            }
            live = new LiveCameraController(getActivity(), getBridge().getWebView(), ocr, frameListener);
            live.start(front, interval, (errorCode, message) -> {
                if (errorCode != null) {
                    live = null;
                    call.reject(message, errorCode);
                } else {
                    call.resolve();
                }
            });
        });
    }

    /** Turns every analyzed camera frame into a `textRecognized` event. */
    private final LiveCameraController.FrameListener frameListener = new LiveCameraController.FrameListener() {
        @Override
        public void onFrame(Text text, int imageWidth, int imageHeight, @Nullable ViewMapper view, Runnable done) {
            OcrEngine.Arranged arranged = OcrEngine.arrange(text, null);
            notifyListeners("textRecognized", OcrEngine.toResult(arranged, imageWidth, imageHeight, view));
            done.run();
        }

        @Override
        public void onError(String code, String message) {
            JSObject error = new JSObject();
            error.put("code", code);
            error.put("message", message);
            notifyListeners("liveRecognitionError", error);
        }
    };

    @PluginMethod
    public void stopLiveRecognition(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            stopLive();
            call.resolve();
        });
    }

    private void stopLive() {
        if (live != null) {
            live.stop();
            live = null;
        }
        if (pendingCapture != null) {
            pendingCapture.reject("Live recognition was stopped.", NOT_RUNNING);
            pendingCapture = null;
        }
    }

    @PluginMethod
    public void captureFrame(PluginCall call) {
        boolean saveImage = call.getBoolean("saveImage", false);
        getActivity().runOnUiThread(() -> {
            LiveCameraController controller = live;
            if (controller == null || !controller.isRunning()) {
                call.reject("Live recognition is not running.", NOT_RUNNING);
                return;
            }
            if (pendingCapture != null) {
                call.reject("A capture is already in progress.", ALREADY_RUNNING);
                return;
            }
            pendingCapture = call;
            controller.capture(
                new LiveCameraController.CaptureCallback() {
                    @Override
                    public void onCaptured(Bitmap bitmap, @Nullable ViewMapper view) {
                        recognizeCapture(call, bitmap, saveImage, view);
                    }

                    @Override
                    public void onError(String message) {
                        finishCapture(call, null, message, CAMERA_ERROR);
                    }
                }
            );
        });
    }

    /** Runs on the capture thread: optionally saves the photo, then recognizes it. */
    private void recognizeCapture(PluginCall call, Bitmap bitmap, boolean saveImage, @Nullable ViewMapper view) {
        String imagePath = null;
        if (saveImage) {
            try {
                imagePath = ImageFiles.saveJpeg(getContext(), bitmap, "capture");
            } catch (IOException e) {
                finishCapture(call, null, "Could not save the image: " + e.getMessage(), CAMERA_ERROR);
                return;
            }
        }
        String path = imagePath;
        recognize(InputImage.fromBitmap(bitmap, 0), view, null).addOnCompleteListener((task) -> {
            if (!task.isSuccessful()) {
                Exception e = task.getException();
                finishCapture(call, null, errorMessage(e, "Recognition failed"), codeOf(e));
                return;
            }
            JSObject result = task.getResult();
            if (path != null) result.put("imagePath", path);
            finishCapture(call, result, null, null);
        });
    }

    private void finishCapture(PluginCall call, @Nullable JSObject result, @Nullable String error, @Nullable String code) {
        getActivity().runOnUiThread(() -> {
            if (pendingCapture != call) return; // already rejected by stopLive()
            pendingCapture = null;
            if (result != null) {
                call.resolve(result);
            } else {
                call.reject(error, code);
            }
        });
    }

    @PluginMethod
    public void resumeLiveRecognition(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (live == null || !live.isRunning()) {
                call.reject("Live recognition is not running.", NOT_RUNNING);
                return;
            }
            live.resume();
            call.resolve();
        });
    }

    @PluginMethod
    public void getLiveState(PluginCall call) {
        LiveCameraController controller = live;
        JSObject result = new JSObject();
        result.put("running", controller != null && controller.isRunning());
        result.put("frozen", controller != null && controller.isFrozen());
        call.resolve(result);
    }

    @PluginMethod
    public void setTorch(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("enabled is required.", INVALID_ARGUMENT);
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (live == null || !live.isRunning()) {
                call.reject("Live recognition is not running.", NOT_RUNNING);
                return;
            }
            if (!live.hasFlash()) {
                call.reject("This camera has no flash.", UNAVAILABLE);
                return;
            }
            live.setTorch(enabled);
            call.resolve();
        });
    }

    // Still images

    @PluginMethod
    public void recognizeImage(PluginCall call) {
        if (!ensureOcr(call)) return;
        String path = call.getString("path");
        String base64 = call.getString("base64");
        if (path != null && !path.isEmpty()) {
            Uri uri = ImageFiles.toUri(path);
            recognizeStill(call, () -> ImageFiles.open(getContext(), uri), uri, path);
        } else if (base64 != null && !base64.isEmpty()) {
            byte[] bytes;
            try {
                bytes = ImageFiles.decodeBase64(base64);
            } catch (IllegalArgumentException e) {
                call.reject("base64 is not valid: " + e.getMessage(), INVALID_ARGUMENT);
                return;
            }
            recognizeStill(call, () -> new ByteArrayInputStream(bytes), null, null);
        } else {
            call.reject("Either path or base64 is required.", INVALID_ARGUMENT);
        }
    }

    /** Opens the system photo picker and recognizes the chosen image. */
    @PluginMethod
    public void recognizeFromGallery(PluginCall call) {
        // Check the options before the picker opens, so mistakes don't cost the user a pick.
        if (!ensureOcr(call)) return;
        if (regionsOf(call) == INVALID_REGIONS) return;

        Intent intent;
        if (Build.VERSION.SDK_INT >= 33) {
            intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
        } else {
            intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
        }
        intent.setType("image/*");
        startActivityForResult(call, intent, "galleryResult");
    }

    @ActivityCallback
    private void galleryResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = result.getResultCode() == Activity.RESULT_OK && data != null ? data.getData() : null;
        if (uri == null) {
            call.reject("No image was selected.", CANCELLED);
            return;
        }
        recognizeStill(call, () -> ImageFiles.open(getContext(), uri), uri, uri.toString());
    }

    /**
     * Recognizes a still image, after letting the user rotate it and select regions when
     * {@code selectRegion} is set.
     *
     * @param uri where ML Kit can read the image directly, or null to decode it from {@code source}
     * @param imagePath returned as {@code imagePath}, or null
     */
    private void recognizeStill(PluginCall call, ImageFiles.Source source, @Nullable Uri uri, @Nullable String imagePath) {
        List<ReadingOrder.Box> regions = regionsOf(call);
        if (regions == INVALID_REGIONS) return;
        boolean select = Boolean.TRUE.equals(call.getBoolean("selectRegion", false));

        worker.execute(() -> {
            if (select) {
                selectThenRecognize(call, source, imagePath);
                return;
            }
            InputImage image;
            try {
                image = uri != null ? InputImage.fromFilePath(getContext(), uri) : InputImage.fromBitmap(ImageFiles.loadBitmap(source), 0);
            } catch (Exception e) {
                call.reject("Could not load the image: " + e.getMessage(), RECOGNITION_FAILED);
                return;
            }
            resolveRecognition(call, image, imagePath, regions, 0);
        });
    }

    /** Runs on the worker: decodes the image, shows the selection screen, then recognizes what the user framed. */
    private void selectThenRecognize(PluginCall call, ImageFiles.Source source, @Nullable String imagePath) {
        Bitmap bitmap;
        try {
            bitmap = ImageFiles.loadBitmap(source);
        } catch (Exception e) {
            call.reject("Could not load the image: " + e.getMessage(), RECOGNITION_FAILED);
            return;
        }
        getActivity().runOnUiThread(() ->
            RegionSelector.show(
                getActivity(),
                bitmap,
                new RegionSelector.Listener() {
                    @Override
                    public void onSelected(Bitmap image, int rotation, List<Rect> rects) {
                        worker.execute(() -> {
                            List<ReadingOrder.Box> selected = null;
                            if (!rects.isEmpty()) {
                                selected = new ArrayList<>();
                                for (Rect r : rects) selected.add(new ReadingOrder.Box(r.left, r.top, r.right, r.bottom));
                            }
                            String path = imagePath;
                            if (rotation != 0) {
                                try {
                                    path = ImageFiles.saveJpeg(getContext(), image, "edited");
                                } catch (IOException e) {
                                    // Keep the original; the coordinates then refer to the rotated image.
                                }
                            }
                            resolveRecognition(call, InputImage.fromBitmap(image, 0), path, selected, rotation);
                        });
                    }

                    @Override
                    public void onCancelled() {
                        call.reject("The selection was cancelled.", CANCELLED);
                    }
                }
            )
        );
    }

    /** Marker returned by {@link #regionsOf} after rejecting the call. */
    private static final List<ReadingOrder.Box> INVALID_REGIONS = new ArrayList<>();

    /** Reads `regions`: null when absent, {@link #INVALID_REGIONS} after rejecting the call. */
    @Nullable
    private static List<ReadingOrder.Box> regionsOf(PluginCall call) {
        JSArray array = call.getArray("regions");
        if (array == null) return null;
        List<ReadingOrder.Box> result = new ArrayList<>();
        try {
            for (int i = 0; i < array.length(); i++) {
                JSONObject r = array.getJSONObject(i);
                int left = (int) Math.floor(r.getDouble("left"));
                int top = (int) Math.floor(r.getDouble("top"));
                int right = (int) Math.ceil(r.getDouble("right"));
                int bottom = (int) Math.ceil(r.getDouble("bottom"));
                if (right <= left || bottom <= top) throw new JSONException("right/bottom must be greater than left/top");
                result.add(new ReadingOrder.Box(left, top, right, bottom));
            }
        } catch (JSONException e) {
            call.reject("regions must be a list of {left, top, right, bottom} in image pixels: " + e.getMessage(), INVALID_ARGUMENT);
            return INVALID_REGIONS;
        }
        return result.isEmpty() ? null : result;
    }

    /** Recognizes a still image and resolves the call with the result, its image path, regions and rotation. */
    private void resolveRecognition(
        PluginCall call,
        InputImage image,
        @Nullable String imagePath,
        @Nullable List<ReadingOrder.Box> regions,
        int rotation
    ) {
        recognize(image, null, regions).addOnCompleteListener((task) -> {
            if (!task.isSuccessful()) {
                Exception e = task.getException();
                call.reject(errorMessage(e, "Recognition failed"), codeOf(e));
                return;
            }
            JSObject result = task.getResult();
            if (imagePath != null) result.put("imagePath", imagePath);
            if (regions != null) result.put("regions", regionsToJson(regions));
            if (rotation != 0) result.put("rotation", rotation);
            call.resolve(result);
        });
    }

    private static JSArray regionsToJson(List<ReadingOrder.Box> regions) {
        JSArray list = new JSArray();
        for (ReadingOrder.Box box : regions) {
            JSObject r = new JSObject();
            r.put("left", box.left);
            r.put("top", box.top);
            r.put("right", box.right);
            r.put("bottom", box.bottom);
            list.put(r);
        }
        return list;
    }

    /**
     * The common path of capture and still images: recognize and put the text in reading order.
     * Failures carry an error code ({@link CodedException}).
     */
    private Task<JSObject> recognize(InputImage image, @Nullable ViewMapper view, @Nullable List<ReadingOrder.Box> regions) {
        int width = image.getRotationDegrees() % 180 == 0 ? image.getWidth() : image.getHeight();
        int height = image.getRotationDegrees() % 180 == 0 ? image.getHeight() : image.getWidth();
        return ocr.process(image).<JSObject>continueWithTask((task) -> {
            if (!task.isSuccessful()) {
                return Tasks.forException(new CodedException(RECOGNITION_FAILED, errorMessage(task.getException(), "Recognition failed")));
            }
            OcrEngine.Arranged arranged = OcrEngine.arrange(task.getResult(), regions);
            return Tasks.forResult(OcrEngine.toResult(arranged, width, height, view));
        });
    }

    // Handwriting

    private static final int MAX_CANDIDATES = 5;

    @PluginMethod
    public void isHandwritingReady(PluginCall call) {
        if (!isSdkSupported()) {
            call.resolve(readyResult(false));
            return;
        }
        handwriting
            .isReady()
            .addOnCompleteListener((task) -> call.resolve(readyResult(task.isSuccessful() && Boolean.TRUE.equals(task.getResult()))));
    }

    @PluginMethod
    public void prepareHandwriting(PluginCall call) {
        if (!isSdkSupported()) {
            call.reject(MIN_SDK_MESSAGE, UNAVAILABLE);
            return;
        }
        handwriting.download(call.getBoolean("requireWifi", false)).addOnCompleteListener((task) -> {
            if (task.isSuccessful()) {
                call.resolve();
            } else {
                call.reject(
                    "Downloading the handwriting model failed: " + errorMessage(task.getException(), "unknown error"),
                    HANDWRITING_NOT_READY
                );
            }
        });
    }

    @PluginMethod
    public void recognizeHandwriting(PluginCall call) {
        if (!isSdkSupported()) {
            call.reject(MIN_SDK_MESSAGE, UNAVAILABLE);
            return;
        }
        List<HandwritingEngine.Stroke> strokes;
        try {
            strokes = parseStrokes(call.getArray("strokes"));
        } catch (JSONException | IllegalArgumentException e) {
            call.reject("strokes must be an array of { points: { x, y, t? }[] }: " + e.getMessage(), INVALID_ARGUMENT);
            return;
        }
        int limit = Math.max(1, Math.min(MAX_CANDIDATES, call.getInt("maxResults", MAX_CANDIDATES)));
        String preContext = call.getString("preContext", "");
        float width = call.getFloat("width", 0f);
        float height = call.getFloat("height", 0f);
        if (strokes.isEmpty()) {
            call.resolve(candidatesResult(Collections.emptyList()));
            return;
        }
        // Downloads the model on first use; no-op once it is on the device.
        handwriting.download(false).addOnCompleteListener((download) -> {
            if (!download.isSuccessful()) {
                call.reject(
                    "The handwriting model is not on the device and could not be downloaded: " +
                        errorMessage(download.getException(), "unknown error"),
                    HANDWRITING_NOT_READY
                );
                return;
            }
            handwriting.recognize(strokes, preContext == null ? "" : preContext, width, height, limit).addOnCompleteListener((task) -> {
                if (task.isSuccessful()) {
                    call.resolve(candidatesResult(task.getResult()));
                } else {
                    call.reject(errorMessage(task.getException(), "Recognition failed"), RECOGNITION_FAILED);
                }
            });
        });
    }

    /** Reads `strokes` from JS: { points: { x, y, t? }[] }[]. Strokes without points are skipped. */
    private static List<HandwritingEngine.Stroke> parseStrokes(@Nullable JSArray array) throws JSONException {
        if (array == null) throw new IllegalArgumentException("strokes is missing");
        List<HandwritingEngine.Stroke> strokes = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            org.json.JSONArray points = array.getJSONObject(i).getJSONArray("points");
            if (points.length() == 0) continue;
            float[] x = new float[points.length()];
            float[] y = new float[points.length()];
            Long[] t = new Long[points.length()];
            for (int j = 0; j < points.length(); j++) {
                JSONObject point = points.getJSONObject(j);
                x[j] = (float) point.getDouble("x");
                y[j] = (float) point.getDouble("y");
                if (Float.isNaN(x[j]) || Float.isNaN(y[j])) throw new IllegalArgumentException("x and y must be numbers");
                t[j] = point.has("t") && !point.isNull("t") ? Math.round(point.getDouble("t")) : null;
            }
            strokes.add(new HandwritingEngine.Stroke(x, y, t));
        }
        return strokes;
    }

    private static JSObject candidatesResult(List<InkLines.Candidate> candidates) {
        double[] probabilities = InkLines.probabilities(candidates);
        JSArray list = new JSArray();
        for (int i = 0; i < candidates.size(); i++) {
            JSObject c = new JSObject();
            c.put("text", candidates.get(i).text);
            c.put("score", candidates.get(i).score);
            c.put("probability", probabilities[i]);
            list.put(c);
        }
        JSObject result = new JSObject();
        result.put("text", candidates.isEmpty() ? "" : candidates.get(0).text);
        result.put("candidates", list);
        return result;
    }

    // Results and errors

    private static JSObject readyResult(boolean ready) {
        JSObject result = new JSObject();
        result.put("ready", ready);
        return result;
    }

    private static String errorMessage(@Nullable Exception e, String fallback) {
        return e != null && e.getMessage() != null ? e.getMessage() : fallback;
    }

    private static String codeOf(@Nullable Exception e) {
        return e instanceof CodedException ? ((CodedException) e).code : RECOGNITION_FAILED;
    }

    /** An exception that carries the error code the call is rejected with. */
    private static class CodedException extends Exception {

        final String code;

        CodedException(String code, String message) {
            super(message);
            this.code = code;
        }
    }
}
