package com.yukarusan.japaneseocr;

import android.annotation.SuppressLint;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Matrix;
import android.media.Image;
import android.util.Size;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.ImageView;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Shows the camera preview behind the WebView, feeds frames to the recognizer and captures
 * full-resolution photos. All public methods must be called on the main thread.
 */
class LiveCameraController {

    interface FrameListener {
        /** Called on the main thread. {@code done} must be run once the frame is fully handled. */
        void onFrame(Text text, int imageWidth, int imageHeight, Runnable done);

        void onError(String code, String message);
    }

    interface StartCallback {
        void onResult(@Nullable String errorCode, @Nullable String message);
    }

    interface CaptureCallback {
        /** Called on a background thread with an upright bitmap. */
        void onCaptured(Bitmap bitmap);

        void onError(String message);
    }

    private static final Size ANALYSIS_SIZE = new Size(1280, 720);

    private final AppCompatActivity activity;
    private final WebView webView;
    private final OcrEngine ocr;
    private final FrameListener listener;

    @Nullable
    private ProcessCameraProvider cameraProvider;

    @Nullable
    private Camera camera;

    @Nullable
    private ImageCapture imageCapture;

    @Nullable
    private PreviewView previewView;

    @Nullable
    private ImageView frozenView;

    @Nullable
    private ExecutorService analysisExecutor;

    @Nullable
    private ExecutorService captureExecutor;

    private volatile boolean running = false;
    private volatile boolean frozen = false;
    private volatile boolean busy = false;
    private volatile long lastFrameAt = 0;
    private long intervalMs = 500;

    LiveCameraController(AppCompatActivity activity, WebView webView, OcrEngine ocr, FrameListener listener) {
        this.activity = activity;
        this.webView = webView;
        this.ocr = ocr;
        this.listener = listener;
    }

    boolean isRunning() {
        return running;
    }

    boolean isFrozen() {
        return frozen;
    }

    void start(boolean frontCamera, long intervalMs, StartCallback callback) {
        this.intervalMs = Math.max(0, intervalMs);
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(activity);
        future.addListener(() -> {
            try {
                cameraProvider = future.get();
                bind(frontCamera);
                running = true;
                callback.onResult(null, null);
            } catch (Exception e) {
                stop();
                callback.onResult("CAMERA_ERROR", "Could not open the camera: " + e.getMessage());
            }
        }, ContextCompat.getMainExecutor(activity));
    }

    private void bind(boolean frontCamera) {
        CameraSelector selector = frontCamera ? CameraSelector.DEFAULT_FRONT_CAMERA : CameraSelector.DEFAULT_BACK_CAMERA;
        if (cameraProvider == null) {
            throw new IllegalStateException("Camera provider missing");
        }
        try {
            if (!cameraProvider.hasCamera(selector)) {
                throw new IllegalStateException("The requested camera does not exist");
            }
        } catch (androidx.camera.core.CameraInfoUnavailableException e) {
            throw new IllegalStateException(e.getMessage(), e);
        }

        addPreviewView();

        Preview preview = new Preview.Builder().build();
        preview.setSurfaceProvider(previewView.getSurfaceProvider());

        ResolutionSelector analysisResolution = new ResolutionSelector.Builder()
            .setResolutionStrategy(new ResolutionStrategy(ANALYSIS_SIZE, ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
            .build();
        ImageAnalysis analysis = new ImageAnalysis.Builder()
            .setResolutionSelector(analysisResolution)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build();
        analysisExecutor = Executors.newSingleThreadExecutor();
        analysis.setAnalyzer(analysisExecutor, this::analyze);

        imageCapture = new ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY).build();
        captureExecutor = Executors.newSingleThreadExecutor();

        cameraProvider.unbindAll();
        camera = cameraProvider.bindToLifecycle(activity, selector, preview, analysis, imageCapture);
    }

    private void addPreviewView() {
        ViewGroup parent = (ViewGroup) webView.getParent();
        previewView = new PreviewView(activity);
        // TextureView based, so getBitmap() works for freezing and the view composes behind the WebView.
        previewView.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        parent.addView(
            previewView,
            0,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        webView.setBackgroundColor(Color.TRANSPARENT);
    }

    @SuppressLint("UnsafeOptInUsageError")
    private void analyze(@NonNull ImageProxy imageProxy) {
        long now = System.currentTimeMillis();
        Image mediaImage = imageProxy.getImage();
        if (!running || frozen || busy || now - lastFrameAt < intervalMs || mediaImage == null || !ocr.isUsable()) {
            imageProxy.close();
            return;
        }
        busy = true;
        lastFrameAt = now;

        int rotation = imageProxy.getImageInfo().getRotationDegrees();
        boolean swap = rotation == 90 || rotation == 270;
        int width = swap ? imageProxy.getHeight() : imageProxy.getWidth();
        int height = swap ? imageProxy.getWidth() : imageProxy.getHeight();

        InputImage input = InputImage.fromMediaImage(mediaImage, rotation);
        ocr.process(input).addOnCompleteListener(ContextCompat.getMainExecutor(activity), (task) -> {
            imageProxy.close();
            if (!running || frozen) {
                busy = false;
                return;
            }
            if (!task.isSuccessful()) {
                busy = false;
                Exception e = task.getException();
                listener.onError("RECOGNITION_FAILED", e != null ? e.getMessage() : "Recognition failed");
                return;
            }
            listener.onFrame(task.getResult(), width, height, () -> busy = false);
        });
    }

    /** Freezes the preview on the current frame and takes a full-resolution photo. */
    void capture(CaptureCallback callback) {
        if (imageCapture == null || previewView == null || captureExecutor == null) {
            callback.onError("Camera is not running");
            return;
        }
        freezePreview();
        imageCapture.takePicture(
            captureExecutor,
            new ImageCapture.OnImageCapturedCallback() {
                @Override
                public void onCaptureSuccess(@NonNull ImageProxy image) {
                    Bitmap bitmap;
                    int rotation;
                    try {
                        rotation = image.getImageInfo().getRotationDegrees();
                        bitmap = image.toBitmap();
                    } finally {
                        image.close();
                    }
                    if (rotation != 0) {
                        Matrix matrix = new Matrix();
                        matrix.postRotate(rotation);
                        Bitmap rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
                        if (rotated != bitmap) bitmap.recycle();
                        bitmap = rotated;
                    }
                    callback.onCaptured(bitmap);
                }

                @Override
                public void onError(@NonNull ImageCaptureException exception) {
                    activity.runOnUiThread(LiveCameraController.this::resume);
                    callback.onError(exception.getMessage() != null ? exception.getMessage() : "Capture failed");
                }
            }
        );
    }

    private void freezePreview() {
        frozen = true;
        if (previewView == null) return;
        Bitmap snapshot = previewView.getBitmap();
        if (snapshot == null) return;
        if (frozenView == null) {
            frozenView = new ImageView(activity);
            frozenView.setScaleType(ImageView.ScaleType.FIT_XY);
            ViewGroup parent = (ViewGroup) webView.getParent();
            parent.addView(
                frozenView,
                parent.indexOfChild(previewView) + 1,
                new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            );
        }
        frozenView.setImageBitmap(snapshot);
        frozenView.setVisibility(View.VISIBLE);
    }

    void resume() {
        if (frozenView != null) {
            frozenView.setVisibility(View.GONE);
            frozenView.setImageBitmap(null);
        }
        frozen = false;
        lastFrameAt = 0;
    }

    boolean hasFlash() {
        return camera != null && camera.getCameraInfo().hasFlashUnit();
    }

    void setTorch(boolean enabled) {
        if (camera != null) {
            camera.getCameraControl().enableTorch(enabled);
        }
    }

    void stop() {
        running = false;
        frozen = false;
        busy = false;
        if (cameraProvider != null) {
            cameraProvider.unbindAll();
            cameraProvider = null;
        }
        camera = null;
        imageCapture = null;
        ViewGroup parent = (ViewGroup) webView.getParent();
        if (frozenView != null) {
            parent.removeView(frozenView);
            frozenView = null;
        }
        if (previewView != null) {
            parent.removeView(previewView);
            previewView = null;
            webView.setBackgroundColor(Color.WHITE);
        }
        if (analysisExecutor != null) {
            analysisExecutor.shutdown();
            analysisExecutor = null;
        }
        if (captureExecutor != null) {
            captureExecutor.shutdown();
            captureExecutor = null;
        }
    }
}
