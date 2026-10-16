package com.yukarusan.japaneseocr;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
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
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "JapaneseOcr",
    permissions = { @Permission(alias = JapaneseOcrPlugin.CAMERA, strings = { Manifest.permission.CAMERA }) }
)
public class JapaneseOcrPlugin extends Plugin {

    static final String CAMERA = "camera";

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

    private final OcrEngine ocr = new OcrEngine();
    private final HandwritingEngine handwriting = new HandwritingEngine();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @Nullable
    private LiveCameraController live;

    @Nullable
    private PluginCall pendingCapture;

    @Override
    public void load() {
        if (Build.VERSION.SDK_INT >= MIN_SDK) {
            ocr.initialize();
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

    @Nullable
    private String unsupportedReason() {
        if (Build.VERSION.SDK_INT < MIN_SDK) {
            return "Android " + MIN_SDK + " (API level) or newer is required.";
        }
        if (!ocr.isUsable()) {
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
        result.put("handwriting", Build.VERSION.SDK_INT >= MIN_SDK);
        if (reason != null) result.put("reason", reason);
        call.resolve(result);
    }

    @PluginMethod
    public void isOcrReady(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ready", ocr.isReady());
        call.resolve(result);
    }

    /** Rejects the call and returns false when OCR cannot run. */
    private boolean ensureOcr(PluginCall call) {
        String reason = unsupportedReason();
        if (reason != null) {
            call.reject(reason, Build.VERSION.SDK_INT < MIN_SDK ? UNAVAILABLE : NOT_READY);
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
                        String imagePath = null;
                        if (saveImage) {
                            try {
                                imagePath = saveJpeg(bitmap, "capture");
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

                    @Override
                    public void onError(String message) {
                        finishCapture(call, null, message, CAMERA_ERROR);
                    }
                }
            );
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

    private String saveJpeg(Bitmap bitmap, String prefix) throws IOException {
        File dir = new File(getContext().getCacheDir(), "japanese-ocr");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Cannot create " + dir);
        }
        File file = new File(dir, prefix + "-" + System.currentTimeMillis() + ".jpg");
        try (FileOutputStream out = new FileOutputStream(file)) {
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out);
        }
        return Uri.fromFile(file).toString();
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
            Uri uri = toUri(path);
            recognizeStill(call, () -> open(uri), uri, path);
        } else if (base64 != null && !base64.isEmpty()) {
            byte[] bytes;
            try {
                bytes = decodeBase64(base64);
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
        recognizeStill(call, () -> open(uri), uri, uri.toString());
    }

    private interface ImageSource {
        InputStream open() throws IOException;
    }

    private InputStream open(Uri uri) throws IOException {
        InputStream in = getContext().getContentResolver().openInputStream(uri);
        if (in == null) throw new IOException("Cannot open " + uri);
        return in;
    }

    /**
     * Recognizes a still image, after letting the user rotate it and select regions when
     * {@code selectRegion} is set.
     *
     * @param uri where ML Kit can read the image directly, or null to decode it from {@code source}
     * @param imagePath returned as {@code imagePath}, or null
     */
    private void recognizeStill(PluginCall call, ImageSource source, @Nullable Uri uri, @Nullable String imagePath) {
        List<ReadingOrder.Box> regions = regionsOf(call);
        if (regions == INVALID_REGIONS) return;
        boolean select = Boolean.TRUE.equals(call.getBoolean("selectRegion", false));

        worker.execute(() -> {
            if (!select) {
                InputImage image;
                try {
                    image = uri != null ? InputImage.fromFilePath(getContext(), uri) : InputImage.fromBitmap(loadBitmap(source), 0);
                } catch (Exception e) {
                    call.reject("Could not load the image: " + e.getMessage(), RECOGNITION_FAILED);
                    return;
                }
                resolveRecognition(call, image, imagePath, regions, 0);
                return;
            }

            Bitmap bitmap;
            try {
                bitmap = loadBitmap(source);
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
                                        path = saveJpeg(image, "edited");
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
        });
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

    private void resolveRecognition(
        PluginCall call,
        InputImage image,
        @Nullable String imagePath,
        @Nullable List<ReadingOrder.Box> regions,
        int rotation
    ) {
        recognize(image, null, regions).addOnCompleteListener((task) -> {
            if (task.isSuccessful()) {
                JSObject result = task.getResult();
                if (imagePath != null) result.put("imagePath", imagePath);
                if (regions != null) {
                    JSArray list = new JSArray();
                    for (ReadingOrder.Box box : regions) {
                        JSObject r = new JSObject();
                        r.put("left", box.left);
                        r.put("top", box.top);
                        r.put("right", box.right);
                        r.put("bottom", box.bottom);
                        list.put(r);
                    }
                    result.put("regions", list);
                }
                if (rotation != 0) result.put("rotation", rotation);
                call.resolve(result);
            } else {
                Exception e = task.getException();
                call.reject(errorMessage(e, "Recognition failed"), codeOf(e));
            }
        });
    }

    private static Uri toUri(String path) {
        if (path.startsWith("/")) {
            return Uri.fromFile(new File(path));
        }
        return Uri.parse(path);
    }

    private static byte[] decodeBase64(String base64) {
        int comma = base64.indexOf(',');
        String data = base64.startsWith("data:") && comma >= 0 ? base64.substring(comma + 1) : base64;
        return Base64.decode(data, Base64.DEFAULT);
    }

    /** Images are scaled down by powers of two until their longer side fits. */
    private static final int MAX_IMAGE_SIDE = 4096;

    /** Decodes an image upright (EXIF orientation applied) and not larger than {@link #MAX_IMAGE_SIDE}. */
    private static Bitmap loadBitmap(ImageSource source) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream in = source.open()) {
            BitmapFactory.decodeStream(in, null, bounds);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("not a decodable image");

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / options.inSampleSize > MAX_IMAGE_SIDE) options.inSampleSize *= 2;
        Bitmap bitmap;
        try (InputStream in = source.open()) {
            bitmap = BitmapFactory.decodeStream(in, null, options);
        }
        if (bitmap == null) throw new IOException("not a decodable image");

        int degrees = 0;
        try (InputStream in = source.open()) {
            int orientation = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            if (orientation == ExifInterface.ORIENTATION_ROTATE_90) degrees = 90;
            else if (orientation == ExifInterface.ORIENTATION_ROTATE_180) degrees = 180;
            else if (orientation == ExifInterface.ORIENTATION_ROTATE_270) degrees = 270;
        } catch (IOException ignored) {
            // No EXIF data: keep the image as decoded.
        }
        if (degrees == 0) return bitmap;
        Matrix matrix = new Matrix();
        matrix.postRotate(degrees);
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
    }

    /** Recognizes an image. Failures carry an error code. */
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
        if (Build.VERSION.SDK_INT < MIN_SDK) {
            JSObject result = new JSObject();
            result.put("ready", false);
            call.resolve(result);
            return;
        }
        handwriting.isReady().addOnCompleteListener((task) -> {
            JSObject result = new JSObject();
            result.put("ready", task.isSuccessful() && Boolean.TRUE.equals(task.getResult()));
            call.resolve(result);
        });
    }

    @PluginMethod
    public void prepareHandwriting(PluginCall call) {
        if (Build.VERSION.SDK_INT < MIN_SDK) {
            call.reject("Android " + MIN_SDK + " (API level) or newer is required.", UNAVAILABLE);
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
        if (Build.VERSION.SDK_INT < MIN_SDK) {
            call.reject("Android " + MIN_SDK + " (API level) or newer is required.", UNAVAILABLE);
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

    // Errors

    private static String errorMessage(@Nullable Exception e, String fallback) {
        return e != null && e.getMessage() != null ? e.getMessage() : fallback;
    }

    private static String codeOf(@Nullable Exception e) {
        return e instanceof CodedException ? ((CodedException) e).code : RECOGNITION_FAILED;
    }

    private static class CodedException extends Exception {

        final String code;

        CodedException(String code, String message) {
            super(message);
            this.code = code;
        }
    }
}
