package com.yukarusan.japaneseocr;

import android.annotation.SuppressLint;
import android.graphics.Point;
import android.graphics.Rect;
import android.graphics.RectF;
import androidx.annotation.Nullable;
import androidx.camera.core.ImageProxy;
import androidx.camera.view.transform.CoordinateTransform;
import androidx.camera.view.transform.ImageProxyTransformFactory;
import androidx.camera.view.transform.OutputTransform;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

/**
 * Maps coordinates of a recognized camera image to CSS pixels of the WebView, so the page can
 * draw on top of the words it sees in the preview.
 */
@SuppressLint("UnsafeOptInUsageError")
class ViewMapper {

    /** Where the preview is drawn, captured on the main thread. */
    static class Target {

        final OutputTransform previewTransform;
        final float offsetX;
        final float offsetY;
        final float density;

        Target(OutputTransform previewTransform, float offsetX, float offsetY, float density) {
            this.previewTransform = previewTransform;
            this.offsetX = offsetX;
            this.offsetY = offsetY;
            this.density = density;
        }
    }

    private final CoordinateTransform transform;
    private final Target target;

    private ViewMapper(CoordinateTransform transform, Target target) {
        this.transform = transform;
        this.target = target;
    }

    /**
     * Source transform of an analysis or capture frame, in the upright coordinate space ML Kit
     * reports when the image is recognized with its rotation applied. Must be called before the
     * image is closed.
     */
    static OutputTransform sourceOf(ImageProxy image) {
        ImageProxyTransformFactory factory = new ImageProxyTransformFactory();
        factory.setUsingRotationDegrees(true);
        return factory.getOutputTransform(image);
    }

    @Nullable
    static ViewMapper create(@Nullable OutputTransform source, @Nullable Target target) {
        if (source == null || target == null) return null;
        try {
            return new ViewMapper(new CoordinateTransform(source, target.previewTransform), target);
        } catch (RuntimeException e) {
            return null;
        }
    }

    JSObject mapRect(Rect rect) {
        RectF mapped = new RectF(rect);
        transform.mapRect(mapped);
        JSObject result = new JSObject();
        result.put("left", cssX(mapped.left));
        result.put("top", cssY(mapped.top));
        result.put("right", cssX(mapped.right));
        result.put("bottom", cssY(mapped.bottom));
        return result;
    }

    JSArray mapPoints(Point[] points) {
        float[] values = new float[points.length * 2];
        for (int i = 0; i < points.length; i++) {
            values[i * 2] = points[i].x;
            values[i * 2 + 1] = points[i].y;
        }
        transform.mapPoints(values);
        JSArray result = new JSArray();
        for (int i = 0; i < points.length; i++) {
            JSObject point = new JSObject();
            point.put("x", cssX(values[i * 2]));
            point.put("y", cssY(values[i * 2 + 1]));
            result.put(point);
        }
        return result;
    }

    private double cssX(float x) {
        return round((x + target.offsetX) / target.density);
    }

    private double cssY(float y) {
        return round((y + target.offsetY) / target.density);
    }

    private static double round(float value) {
        return Math.round(value * 10) / 10.0;
    }
}
