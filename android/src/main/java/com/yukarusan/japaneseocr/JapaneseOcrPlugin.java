package com.yukarusan.japaneseocr;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

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
    private static final String TRANSLATION_NOT_READY = "TRANSLATION_NOT_READY";
    private static final String TRANSLATION_FAILED = "TRANSLATION_FAILED";

    private static final int MIN_SDK = 24;

    private final OcrEngine ocr = new OcrEngine();
    private final TranslationEngine translation = new TranslationEngine();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @Nullable
    private LiveCameraController live;

    @Nullable
    private PluginCall pendingCapture;

    /** Target language for live translation, null when off. */
    @Nullable
    private volatile String liveTranslationTarget;

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
        translation.close();
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
        result.put("translation", supported);
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
        startLiveWithTranslation(call);
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        if (getPermissionState(CAMERA) != PermissionState.GRANTED) {
            call.reject("Camera permission was denied.", PERMISSION_DENIED);
            return;
        }
        startLiveWithTranslation(call);
    }

    private void startLiveWithTranslation(PluginCall call) {
        JSObject translationOptions = call.getObject("translation");
        if (translationOptions == null || !translationOptions.getBoolean("enabled", false)) {
            liveTranslationTarget = null;
            openCamera(call);
            return;
        }
        String target = TranslationEngine.resolveTarget(translationOptions.getString("targetLanguage"));
        if (target == null) {
            call.reject("Unsupported targetLanguage.", INVALID_ARGUMENT);
            return;
        }
        translation.isReady(target).addOnCompleteListener((task) -> {
            if (!task.isSuccessful() || !Boolean.TRUE.equals(task.getResult())) {
                call.reject(
                    "Translation model for '" + target + "' is not downloaded. Call prepareTranslation() first.",
                    TRANSLATION_NOT_READY
                );
                return;
            }
            liveTranslationTarget = target;
            openCamera(call);
        });
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
            String target = liveTranslationTarget;
            if (target == null || text.getTextBlocks().isEmpty()) {
                notifyListeners(
                    "textRecognized",
                    OcrEngine.toResult(text, imageWidth, imageHeight, target == null ? null : Collections.<String>emptyList(), target, view)
                );
                done.run();
                return;
            }
            translation.translateAll(target, OcrEngine.blockTexts(text)).addOnCompleteListener((task) -> {
                if (task.isSuccessful()) {
                    notifyListeners("textRecognized", OcrEngine.toResult(text, imageWidth, imageHeight, task.getResult(), target, view));
                } else {
                    // Still deliver the Japanese text, and report why the translation is missing.
                    notifyListeners("textRecognized", OcrEngine.toResult(text, imageWidth, imageHeight, null, null, view));
                    onError(TRANSLATION_FAILED, errorMessage(task.getException(), "Translation failed"));
                }
                done.run();
            });
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
        String target = liveTranslationTarget;
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
                                imagePath = saveJpeg(bitmap);
                            } catch (IOException e) {
                                finishCapture(call, null, "Could not save the image: " + e.getMessage(), CAMERA_ERROR);
                                return;
                            }
                        }
                        String path = imagePath;
                        recognize(InputImage.fromBitmap(bitmap, 0), target, view).addOnCompleteListener((task) -> {
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

    private String saveJpeg(Bitmap bitmap) throws IOException {
        File dir = new File(getContext().getCacheDir(), "japanese-ocr");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Cannot create " + dir);
        }
        File file = new File(dir, "capture-" + System.currentTimeMillis() + ".jpg");
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
        String target = liveTranslationTarget;
        JSObject translationState = new JSObject();
        translationState.put("enabled", target != null);
        if (target != null) translationState.put("targetLanguage", target);
        JSObject result = new JSObject();
        result.put("running", controller != null && controller.isRunning());
        result.put("frozen", controller != null && controller.isFrozen());
        result.put("translation", translationState);
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

    @PluginMethod
    public void setTranslation(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("enabled is required.", INVALID_ARGUMENT);
            return;
        }
        if (!enabled) {
            liveTranslationTarget = null;
            call.resolve();
            return;
        }
        String target = TranslationEngine.resolveTarget(call.getString("targetLanguage"));
        if (target == null) {
            call.reject("Unsupported targetLanguage.", INVALID_ARGUMENT);
            return;
        }
        translation.isReady(target).addOnCompleteListener((task) -> {
            if (!task.isSuccessful() || !Boolean.TRUE.equals(task.getResult())) {
                call.reject(
                    "Translation model for '" + target + "' is not downloaded. Call prepareTranslation() first.",
                    TRANSLATION_NOT_READY
                );
                return;
            }
            liveTranslationTarget = target;
            call.resolve();
        });
    }

    // Still images

    @PluginMethod
    public void recognizeImage(PluginCall call) {
        if (!ensureOcr(call)) return;
        String path = call.getString("path");
        String base64 = call.getString("base64");
        if ((path == null || path.isEmpty()) && (base64 == null || base64.isEmpty())) {
            call.reject("Either path or base64 is required.", INVALID_ARGUMENT);
            return;
        }

        String target = null;
        JSObject translationOptions = call.getObject("translation");
        if (translationOptions != null && translationOptions.getBoolean("enabled", false)) {
            target = TranslationEngine.resolveTarget(translationOptions.getString("targetLanguage"));
            if (target == null) {
                call.reject("Unsupported targetLanguage.", INVALID_ARGUMENT);
                return;
            }
        }
        String translateTo = target;

        worker.execute(() -> {
            InputImage image;
            try {
                image = path != null && !path.isEmpty() ? InputImage.fromFilePath(getContext(), toUri(path)) : fromBase64(base64);
            } catch (Exception e) {
                call.reject("Could not load the image: " + e.getMessage(), RECOGNITION_FAILED);
                return;
            }
            recognize(image, translateTo, null).addOnCompleteListener((task) -> {
                if (task.isSuccessful()) {
                    call.resolve(task.getResult());
                } else {
                    Exception e = task.getException();
                    call.reject(errorMessage(e, "Recognition failed"), codeOf(e));
                }
            });
        });
    }

    private static Uri toUri(String path) {
        if (path.startsWith("/")) {
            return Uri.fromFile(new File(path));
        }
        return Uri.parse(path);
    }

    private static InputImage fromBase64(String base64) {
        int comma = base64.indexOf(',');
        String data = base64.startsWith("data:") && comma >= 0 ? base64.substring(comma + 1) : base64;
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bitmap == null) {
            throw new IllegalArgumentException("base64 is not a decodable image");
        }
        return InputImage.fromBitmap(bitmap, 0);
    }

    /** Recognizes an image and optionally translates it. Failures carry an error code. */
    private Task<JSObject> recognize(InputImage image, @Nullable String target, @Nullable ViewMapper view) {
        int width = image.getRotationDegrees() % 180 == 0 ? image.getWidth() : image.getHeight();
        int height = image.getRotationDegrees() % 180 == 0 ? image.getHeight() : image.getWidth();
        return ocr.process(image).<JSObject>continueWithTask((task) -> {
            if (!task.isSuccessful()) {
                return Tasks.forException(new CodedException(RECOGNITION_FAILED, errorMessage(task.getException(), "Recognition failed")));
            }
            Text text = task.getResult();
            if (target == null) {
                return Tasks.forResult(OcrEngine.toResult(text, width, height, null, null, view));
            }
            return translation.isReady(target).<JSObject>continueWithTask((ready) -> {
                if (!ready.isSuccessful() || !Boolean.TRUE.equals(ready.getResult())) {
                    return Tasks.forException(
                        new CodedException(
                            TRANSLATION_NOT_READY,
                            "Translation model for '" + target + "' is not downloaded. Call prepareTranslation() first."
                        )
                    );
                }
                return translation.translateAll(target, OcrEngine.blockTexts(text)).<JSObject>continueWithTask((translated) -> {
                    if (!translated.isSuccessful()) {
                        return Tasks.forException(
                            new CodedException(TRANSLATION_FAILED, errorMessage(translated.getException(), "Translation failed"))
                        );
                    }
                    return Tasks.forResult(OcrEngine.toResult(text, width, height, translated.getResult(), target, view));
                });
            });
        });
    }

    // Translation

    @PluginMethod
    public void prepareTranslation(PluginCall call) {
        if (Build.VERSION.SDK_INT < MIN_SDK) {
            call.reject(unsupportedReason(), UNAVAILABLE);
            return;
        }
        String target = TranslationEngine.resolveTarget(call.getString("targetLanguage"));
        if (target == null) {
            call.reject("Unsupported targetLanguage.", INVALID_ARGUMENT);
            return;
        }
        translation.download(target, call.getBoolean("requireWifi", false)).addOnCompleteListener((task) -> {
            if (task.isSuccessful()) {
                call.resolve();
            } else {
                call.reject(
                    "Downloading the translation model failed: " + errorMessage(task.getException(), "unknown error"),
                    TRANSLATION_NOT_READY
                );
            }
        });
    }

    @PluginMethod
    public void isTranslationReady(PluginCall call) {
        String target = TranslationEngine.resolveTarget(call.getString("targetLanguage"));
        if (Build.VERSION.SDK_INT < MIN_SDK || target == null) {
            JSObject result = new JSObject();
            result.put("ready", false);
            call.resolve(result);
            return;
        }
        translation.isReady(target).addOnCompleteListener((task) -> {
            JSObject result = new JSObject();
            result.put("ready", task.isSuccessful() && Boolean.TRUE.equals(task.getResult()));
            call.resolve(result);
        });
    }

    @PluginMethod
    public void translateText(PluginCall call) {
        if (Build.VERSION.SDK_INT < MIN_SDK) {
            call.reject(unsupportedReason(), UNAVAILABLE);
            return;
        }
        String text = call.getString("text");
        if (text == null) {
            call.reject("text is required.", INVALID_ARGUMENT);
            return;
        }
        String target = TranslationEngine.resolveTarget(call.getString("targetLanguage"));
        if (target == null) {
            call.reject("Unsupported targetLanguage.", INVALID_ARGUMENT);
            return;
        }
        translation.isReady(target).addOnCompleteListener((ready) -> {
            if (!ready.isSuccessful() || !Boolean.TRUE.equals(ready.getResult())) {
                call.reject(
                    "Translation model for '" + target + "' is not downloaded. Call prepareTranslation() first.",
                    TRANSLATION_NOT_READY
                );
                return;
            }
            translation.translate(target, text).addOnCompleteListener((task) -> {
                if (!task.isSuccessful()) {
                    call.reject(errorMessage(task.getException(), "Translation failed"), TRANSLATION_FAILED);
                    return;
                }
                JSObject result = new JSObject();
                result.put("text", task.getResult());
                result.put("targetLanguage", target);
                call.resolve(result);
            });
        });
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
