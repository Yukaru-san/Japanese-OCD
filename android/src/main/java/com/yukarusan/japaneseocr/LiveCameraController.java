package com.yukarusan.japaneseocr;

import android.annotation.SuppressLint;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.drawable.Drawable;
import android.media.Image;
import android.util.Size;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.core.ZoomState;
import androidx.camera.core.resolutionselector.AspectRatioStrategy;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.camera.view.TransformExperimental;
import androidx.camera.view.transform.OutputTransform;
import androidx.core.content.ContextCompat;
import com.google.android.gms.tasks.Task;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;

/**
 * Shows the camera preview behind the WebView, feeds frames to the recognizer and captures
 * full-resolution photos. All public methods must be called on the main thread.
 */
@OptIn(markerClass = TransformExperimental.class)
class LiveCameraController {

    interface FrameListener {
        /**
         * Called on the analysis thread, so building the result does not hold up the preview.
         * {@code done} must be run once the frame is fully handled.
         */
        void onFrame(Text text, int imageWidth, int imageHeight, @Nullable ViewMapper view, Runnable done);

        void onError(String code, String message);
    }

    interface StartCallback {
        void onResult(@Nullable String errorCode, @Nullable String message);
    }

    interface CaptureCallback {
        /** Called on a background thread with an upright bitmap. */
        void onCaptured(Bitmap bitmap, @Nullable ViewMapper view);

        void onError(String message);
    }

    /**
     * Full HD, so furigana (about half the height of the text they belong to) still get enough
     * pixels per character to be recognized reliably; at 720p they often were not, and the result
     * switched between frames with and without them.
     */
    private static final Size ANALYSIS_SIZE = new Size(1920, 1080);

    /** How long a tap-to-focus point is kept before the camera returns to continuous autofocus. */
    private static final long FOCUS_HOLD_SECONDS = 5;

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

    /** Background of the WebView before it was made transparent, restored on stop (the app's theme color). */
    @Nullable
    private Drawable webViewBackground;

    @Nullable
    private ExecutorService analysisExecutor;

    @Nullable
    private ExecutorService captureExecutor;

    private volatile boolean running = false;
    /** Set by `stop()`; a camera provider that arrives afterwards is not bound. */
    private volatile boolean stopped = false;
    private volatile boolean frozen = false;
    private volatile boolean busy = false;
    private volatile long lastFrameAt = 0;
    private long intervalMs = 300;

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
            if (stopped) {
                callback.onResult("NOT_RUNNING", "Live recognition was stopped while starting.");
                return;
            }
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

        // Preview and analysis use the same 16:9 picture, so the text that is recognized is the text
        // the user sees (with the default 4:3 preview, the two showed different parts of the scene).
        Preview preview = new Preview.Builder()
            .setResolutionSelector(
                new ResolutionSelector.Builder().setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY).build()
            )
            .build();
        preview.setSurfaceProvider(previewView.getSurfaceProvider());

        ResolutionSelector analysisResolution = new ResolutionSelector.Builder()
            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
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
        // TextureView based, so the view composes behind the WebView.
        previewView.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        parent.addView(
            previewView,
            0,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        webViewBackground = webView.getBackground();
        webView.setBackgroundColor(Color.TRANSPARENT);
        setPageLive(true);
    }

    /**
     * Toggles the `japanese-ocr-live` class on the page's root element. While it is set, an
     * injected style makes html and body transparent so the preview behind the WebView shows.
     */
    private void setPageLive(boolean live) {
        webView.evaluateJavascript(
            "(function(on){var d=document.documentElement;" +
                "if(!document.getElementById('japanese-ocr-live-style')){var s=document.createElement('style');" +
                "s.id='japanese-ocr-live-style';" +
                "s.textContent='html.japanese-ocr-live,html.japanese-ocr-live body{background:transparent!important}';" +
                "document.head.appendChild(s);}" +
                "d.classList.toggle('japanese-ocr-live',on);})(" +
                live +
                ");",
            null
        );
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

        OutputTransform source = safeSource(imageProxy);
        Task<Text> task;
        try {
            task = ocr.process(InputImage.fromMediaImage(mediaImage, rotation));
        } catch (RuntimeException e) {
            imageProxy.close();
            busy = false;
            return;
        }
        task.addOnCompleteListener(ContextCompat.getMainExecutor(activity), (finished) -> {
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
            Text text = task.getResult();
            ViewMapper view = ViewMapper.create(source, viewTarget());
            ExecutorService executor = analysisExecutor;
            try {
                if (executor == null) throw new RejectedExecutionException();
                executor.execute(() -> {
                    if (!running || frozen) {
                        busy = false;
                        return;
                    }
                    listener.onFrame(text, width, height, view, () -> busy = false);
                });
            } catch (RejectedExecutionException e) {
                busy = false; // stopped meanwhile
            }
        });
    }

    /** Pauses the recognition and takes a full-resolution photo. */
    void capture(CaptureCallback callback) {
        if (imageCapture == null || previewView == null || captureExecutor == null) {
            callback.onError("Camera is not running");
            return;
        }
        // No frozen picture over the preview: a native view drawn behind the WebView left the page's transparent
        // areas black on Samsung devices from then on. The page shows the photo instead.
        frozen = true;
        ViewMapper.Target target = viewTarget();
        imageCapture.takePicture(
            captureExecutor,
            new ImageCapture.OnImageCapturedCallback() {
                @Override
                public void onCaptureSuccess(@NonNull ImageProxy image) {
                    Bitmap bitmap;
                    OutputTransform source = safeSource(image);
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
                    callback.onCaptured(bitmap, ViewMapper.create(source, target));
                }

                @Override
                public void onError(@NonNull ImageCaptureException exception) {
                    activity.runOnUiThread(LiveCameraController.this::resume);
                    callback.onError(exception.getMessage() != null ? exception.getMessage() : "Capture failed");
                }
            }
        );
    }

    void resume() {
        frozen = false;
        lastFrameAt = 0;
    }

    @Nullable
    private static OutputTransform safeSource(ImageProxy image) {
        try {
            return ViewMapper.sourceOf(image);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** Current placement of the preview relative to the WebView. Main thread only. */
    @Nullable
    private ViewMapper.Target viewTarget() {
        if (previewView == null) return null;
        OutputTransform previewTransform = previewView.getOutputTransform();
        if (previewTransform == null) return null;
        return new ViewMapper.Target(
            previewTransform,
            previewView.getLeft() - webView.getLeft(),
            previewView.getTop() - webView.getTop(),
            webView.getResources().getDisplayMetrics().density
        );
    }

    boolean hasFlash() {
        return camera != null && camera.getCameraInfo().hasFlashUnit();
    }

    void setTorch(boolean enabled) {
        if (camera != null) {
            camera.getCameraControl().enableTorch(enabled);
        }
    }

    /**
     * Focuses (and meters exposure) on a point given in CSS pixels of the WebView, then returns to
     * continuous autofocus after {@link #FOCUS_HOLD_SECONDS}. Returns {@code false} when the camera
     * cannot focus on a point.
     */
    boolean focusAt(float cssX, float cssY) {
        if (camera == null || previewView == null) return false;
        float density = webView.getResources().getDisplayMetrics().density;
        float x = cssX * density + webView.getLeft() - previewView.getLeft();
        float y = cssY * density + webView.getTop() - previewView.getTop();
        MeteringPoint point = previewView.getMeteringPointFactory().createPoint(x, y);
        FocusMeteringAction action = new FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF | FocusMeteringAction.FLAG_AE)
            .setAutoCancelDuration(FOCUS_HOLD_SECONDS, TimeUnit.SECONDS)
            .build();
        if (!camera.getCameraInfo().isFocusMeteringSupported(action)) return false;
        camera.getCameraControl().startFocusAndMetering(action);
        return true;
    }

    /** Current zoom state, or null before the camera is open. */
    @Nullable
    ZoomState zoomState() {
        return camera == null ? null : camera.getCameraInfo().getZoomState().getValue();
    }

    /** Sets the zoom factor, clamped to what the camera supports. */
    void setZoom(float ratio) {
        ZoomState state = zoomState();
        if (camera == null || state == null) return;
        float clamped = Math.max(state.getMinZoomRatio(), Math.min(state.getMaxZoomRatio(), ratio));
        camera.getCameraControl().setZoomRatio(clamped);
    }

    void stop() {
        stopped = true;
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
        if (previewView != null) {
            parent.removeView(previewView);
            previewView = null;
            webView.setBackground(webViewBackground);
            webViewBackground = null;
            setPageLive(false);
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
