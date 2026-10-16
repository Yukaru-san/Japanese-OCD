package com.yukarusan.japaneseocr;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.PointF;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.RectF;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import java.util.ArrayList;
import java.util.List;

/**
 * Full-screen editor shown before a still image is recognized: the user can rotate the image and
 * draw one or more frames around the text they want.
 */
final class RegionSelector {

    interface Listener {
        /**
         * @param image the image, rotated as the user chose
         * @param rotation clockwise rotation the user applied, in degrees
         * @param regions selected frames in pixels of {@code image}, in the order they were drawn;
         *     empty when the whole image should be recognized
         */
        void onSelected(Bitmap image, int rotation, List<Rect> regions);

        void onCancelled();
    }

    private RegionSelector() {}

    static void show(Activity activity, Bitmap image, Listener listener) {
        Dialog dialog = new Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        Context context = activity;
        float dp = context.getResources().getDisplayMetrics().density;

        SelectionView selection = new SelectionView(context, image);

        TextView hint = new TextView(context);
        hint.setText(R.string.japanese_ocr_select_hint);
        hint.setTextColor(Color.WHITE);
        hint.setGravity(Gravity.CENTER);
        int pad = Math.round(12 * dp);
        hint.setPadding(pad, pad, pad, pad);

        LinearLayout bar = new LinearLayout(context);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER);
        bar.setPadding(pad / 2, pad / 2, pad / 2, pad / 2);

        Button rotate = button(context, R.string.japanese_ocr_select_rotate);
        Button clear = button(context, R.string.japanese_ocr_select_clear);
        Button cancel = button(context, R.string.japanese_ocr_select_cancel);
        Button done = button(context, R.string.japanese_ocr_select_done);
        for (Button b : new Button[] { rotate, clear, cancel, done }) {
            bar.addView(b, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        }

        LinearLayout root = new LinearLayout(context);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.BLACK);
        root.addView(hint, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(selection, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        boolean[] finished = { false };
        rotate.setOnClickListener((v) -> selection.rotate());
        clear.setOnClickListener((v) -> selection.clear());
        cancel.setOnClickListener((v) -> dialog.cancel());
        done.setOnClickListener((v) -> {
            finished[0] = true;
            dialog.dismiss();
            listener.onSelected(selection.rotatedImage(), selection.rotation, selection.regions());
        });
        dialog.setOnCancelListener((d) -> {
            if (finished[0]) return;
            finished[0] = true;
            listener.onCancelled();
        });
        // Closed some other way (e.g. the activity went away): still settle the call.
        dialog.setOnDismissListener((d) -> {
            if (finished[0]) return;
            finished[0] = true;
            listener.onCancelled();
        });

        dialog.setContentView(root, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        dialog.show();
    }

    private static Button button(Context context, int label) {
        Button button = new Button(context);
        button.setText(label);
        button.setAllCaps(false);
        return button;
    }

    /** Shows the image and lets the user draw, move, resize and delete frames. */
    @SuppressLint("ViewConstructor")
    static final class SelectionView extends View {

        private static final int NONE = 0;
        private static final int CREATE = 1;
        private static final int MOVE = 2;
        private static final int RESIZE = 3;

        private final Bitmap source;
        int rotation = 0;

        /** Frames in pixels of the rotated image. */
        private final List<RectF> frames = new ArrayList<>();

        private final Matrix toView = new Matrix();
        private final Matrix toImage = new Matrix();
        private final float dp;

        private final Paint dim = new Paint();
        private final Paint clearPaint = new Paint();
        private final Paint border = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint handle = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint label = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint badge = new Paint(Paint.ANTI_ALIAS_FLAG);

        private int mode = NONE;
        private RectF active;
        private int corner;
        private float lastX;
        private float lastY;
        private float downX;
        private float downY;

        SelectionView(Context context, Bitmap source) {
            super(context);
            this.source = source;
            dp = context.getResources().getDisplayMetrics().density;
            dim.setColor(0x99000000);
            clearPaint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.CLEAR));
            border.setStyle(Paint.Style.STROKE);
            border.setStrokeWidth(2 * dp);
            border.setColor(0xFF4FC3F7);
            handle.setColor(0xFF4FC3F7);
            label.setColor(Color.WHITE);
            label.setTextSize(14 * dp);
            label.setTextAlign(Paint.Align.CENTER);
            badge.setColor(0xFFE53935);
        }

        private int imageWidth() {
            return rotation % 180 == 0 ? source.getWidth() : source.getHeight();
        }

        private int imageHeight() {
            return rotation % 180 == 0 ? source.getHeight() : source.getWidth();
        }

        void rotate() {
            // Rotate the frames with the image, clockwise.
            int oldHeight = imageHeight();
            for (RectF f : frames) {
                f.set(oldHeight - f.bottom, f.left, oldHeight - f.top, f.right);
            }
            rotation = (rotation + 90) % 360;
            updateMatrix();
            invalidate();
        }

        void clear() {
            frames.clear();
            invalidate();
        }

        Bitmap rotatedImage() {
            if (rotation == 0) return source;
            Matrix m = new Matrix();
            m.postRotate(rotation);
            return Bitmap.createBitmap(source, 0, 0, source.getWidth(), source.getHeight(), m, true);
        }

        List<Rect> regions() {
            List<Rect> result = new ArrayList<>();
            for (RectF f : frames) {
                Rect r = new Rect();
                f.round(r);
                result.add(r);
            }
            return result;
        }

        @Override
        protected void onSizeChanged(int w, int h, int oldw, int oldh) {
            updateMatrix();
        }

        /** Image (rotated) pixels → view pixels, fitted and centered. */
        private void updateMatrix() {
            float margin = 12 * dp;
            float w = Math.max(1, getWidth() - 2 * margin);
            float h = Math.max(1, getHeight() - 2 * margin);
            float scale = Math.min(w / imageWidth(), h / imageHeight());
            toView.reset();
            toView.postScale(scale, scale);
            toView.postTranslate((getWidth() - imageWidth() * scale) / 2, (getHeight() - imageHeight() * scale) / 2);
            toView.invert(toImage);
        }

        private RectF imageBounds() {
            RectF bounds = new RectF(0, 0, imageWidth(), imageHeight());
            toView.mapRect(bounds);
            return bounds;
        }

        @Override
        protected void onDraw(Canvas canvas) {
            canvas.save();
            canvas.concat(toView);
            // Draw the source rotated into the rotated image space.
            canvas.translate(imageWidth() / 2f, imageHeight() / 2f);
            canvas.rotate(rotation);
            canvas.translate(-source.getWidth() / 2f, -source.getHeight() / 2f);
            canvas.drawBitmap(source, 0, 0, null);
            canvas.restore();

            if (frames.isEmpty()) return;
            RectF bounds = imageBounds();
            int layer = canvas.saveLayer(bounds, null);
            canvas.drawRect(bounds, dim);
            for (RectF f : frames) canvas.drawRect(viewRect(f), clearPaint);
            canvas.restoreToCount(layer);

            float r = 6 * dp;
            for (int i = 0; i < frames.size(); i++) {
                RectF v = viewRect(frames.get(i));
                canvas.drawRect(v, border);
                canvas.drawCircle(v.left, v.top, r, handle);
                canvas.drawCircle(v.right, v.top, r, handle);
                canvas.drawCircle(v.left, v.bottom, r, handle);
                canvas.drawCircle(v.right, v.bottom, r, handle);
                // Number in the order of selection, delete badge at the top center.
                canvas.drawCircle(v.left + 14 * dp, v.top + 14 * dp, 10 * dp, handle);
                canvas.drawText(String.valueOf(i + 1), v.left + 14 * dp, v.top + 19 * dp, label);
                PointF x = deleteBadge(v);
                canvas.drawCircle(x.x, x.y, 11 * dp, badge);
                canvas.drawText("×", x.x, x.y + 5 * dp, label);
            }
        }

        private PointF deleteBadge(RectF view) {
            return new PointF(view.centerX(), view.top - 16 * dp < 0 ? view.top + 16 * dp : view.top - 16 * dp);
        }

        private RectF viewRect(RectF image) {
            RectF v = new RectF(image);
            toView.mapRect(v);
            return v;
        }

        @SuppressLint("ClickableViewAccessibility")
        @Override
        public boolean onTouchEvent(MotionEvent event) {
            float x = event.getX();
            float y = event.getY();
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = x;
                    downY = y;
                    lastX = x;
                    lastY = y;
                    start(x, y);
                    return true;
                case MotionEvent.ACTION_MOVE:
                    drag(x, y);
                    lastX = x;
                    lastY = y;
                    invalidate();
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    finish();
                    invalidate();
                    return true;
                default:
                    return super.onTouchEvent(event);
            }
        }

        private void start(float x, float y) {
            float touch = 24 * dp;
            for (int i = frames.size() - 1; i >= 0; i--) {
                RectF v = viewRect(frames.get(i));
                PointF b = deleteBadge(v);
                if (Math.hypot(x - b.x, y - b.y) < touch) {
                    frames.remove(i);
                    mode = NONE;
                    invalidate();
                    return;
                }
                float[][] corners = { { v.left, v.top }, { v.right, v.top }, { v.left, v.bottom }, { v.right, v.bottom } };
                for (int c = 0; c < 4; c++) {
                    if (Math.hypot(x - corners[c][0], y - corners[c][1]) < touch) {
                        mode = RESIZE;
                        active = frames.get(i);
                        corner = c;
                        return;
                    }
                }
                if (v.contains(x, y)) {
                    mode = MOVE;
                    active = frames.get(i);
                    return;
                }
            }
            if (!imageBounds().contains(x, y)) {
                mode = NONE;
                return;
            }
            float[] p = toImagePoint(x, y);
            active = new RectF(p[0], p[1], p[0], p[1]);
            frames.add(active);
            mode = CREATE;
        }

        private void drag(float x, float y) {
            if (mode == NONE || active == null) return;
            float[] p = toImagePoint(x, y);
            float w = imageWidth();
            float h = imageHeight();
            p[0] = Math.max(0, Math.min(w, p[0]));
            p[1] = Math.max(0, Math.min(h, p[1]));
            if (mode == CREATE) {
                float[] d = toImagePoint(downX, downY);
                active.set(Math.min(d[0], p[0]), Math.min(d[1], p[1]), Math.max(d[0], p[0]), Math.max(d[1], p[1]));
            } else if (mode == MOVE) {
                float[] last = toImagePoint(lastX, lastY);
                float[] now = toImagePoint(x, y);
                float dx = Math.max(-active.left, Math.min(w - active.right, now[0] - last[0]));
                float dy = Math.max(-active.top, Math.min(h - active.bottom, now[1] - last[1]));
                active.offset(dx, dy);
            } else if (mode == RESIZE) {
                boolean left = corner == 0 || corner == 2;
                boolean top = corner == 0 || corner == 1;
                if (left) active.left = p[0];
                else active.right = p[0];
                if (top) active.top = p[1];
                else active.bottom = p[1];
                active.sort();
            }
        }

        private void finish() {
            if (mode == CREATE && active != null) {
                RectF v = viewRect(active);
                if (v.width() < 16 * dp || v.height() < 16 * dp) frames.remove(active);
            }
            mode = NONE;
            active = null;
        }

        private float[] toImagePoint(float x, float y) {
            float[] p = { x, y };
            toImage.mapPoints(p);
            return p;
        }
    }
}
