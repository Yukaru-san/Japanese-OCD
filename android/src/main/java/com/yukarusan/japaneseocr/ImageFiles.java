package com.yukarusan.japaneseocr;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Reading and writing the still images the plugin works with: paths and URIs from JS, base64
 * data, photos decoded upright, and JPEGs saved to the app cache.
 */
final class ImageFiles {

    /** Something that can be opened more than once, e.g. a content URI or a byte array. */
    interface Source {
        InputStream open() throws IOException;
    }

    /** Images are scaled down by powers of two until their longer side fits. */
    private static final int MAX_IMAGE_SIDE = 4096;

    private ImageFiles() {}

    /** Accepts an absolute file path as well as a {@code file://} or {@code content://} URI. */
    static Uri toUri(String path) {
        if (path.startsWith("/")) {
            return Uri.fromFile(new File(path));
        }
        return Uri.parse(path);
    }

    static InputStream open(Context context, Uri uri) throws IOException {
        InputStream in = context.getContentResolver().openInputStream(uri);
        if (in == null) throw new IOException("Cannot open " + uri);
        return in;
    }

    /** Decodes base64 image data, with or without a {@code data:...;base64,} prefix. */
    static byte[] decodeBase64(String base64) {
        int comma = base64.indexOf(',');
        String data = base64.startsWith("data:") && comma >= 0 ? base64.substring(comma + 1) : base64;
        return Base64.decode(data, Base64.DEFAULT);
    }

    /** Decodes an image upright (EXIF orientation applied) and not larger than {@link #MAX_IMAGE_SIDE}. */
    static Bitmap loadBitmap(Source source) throws IOException {
        // First pass reads only the size, so a huge photo is never decoded at full resolution.
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

        int degrees = exifRotation(source);
        if (degrees == 0) return bitmap;
        Matrix matrix = new Matrix();
        matrix.postRotate(degrees);
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
    }

    /** Clockwise rotation stored in the image's EXIF data, 0 when there is none. */
    private static int exifRotation(Source source) {
        try (InputStream in = source.open()) {
            int orientation = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            if (orientation == ExifInterface.ORIENTATION_ROTATE_90) return 90;
            if (orientation == ExifInterface.ORIENTATION_ROTATE_180) return 180;
            if (orientation == ExifInterface.ORIENTATION_ROTATE_270) return 270;
        } catch (IOException ignored) {
            // No EXIF data: keep the image as decoded.
        }
        return 0;
    }

    /** Saves the bitmap as JPEG in {@code <cache>/japanese-ocr/} and returns its {@code file://} URI. */
    static String saveJpeg(Context context, Bitmap bitmap, String prefix) throws IOException {
        File dir = new File(context.getCacheDir(), "japanese-ocr");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Cannot create " + dir);
        }
        File file = new File(dir, prefix + "-" + System.currentTimeMillis() + ".jpg");
        try (FileOutputStream out = new FileOutputStream(file)) {
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out);
        }
        return Uri.fromFile(file).toString();
    }
}
