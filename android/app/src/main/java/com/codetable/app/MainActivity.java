package com.codetable.app;

import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.DashPathEffect;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.animation.LinearInterpolator;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Random;

/**
 * «Таблица кодов» — WebView-обёртка вокруг офлайн-приложения из assets/www.
 * Поверх WebView на пять секунд показывается нативная анимированная заставка.
 */
public class MainActivity extends Activity {

    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_EXPORT = 1002;
    private static final int REQ_IMPORT = 1003;
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String APP_URL = "https://" + APP_HOST + "/assets/www/index.html?native=1";
    private static final int COLOR_BG = 0xff07060d;

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("ico", "image/x-icon");
    }

    private WebView webView;
    private SplashView splashView;
    private FrameLayout root;
    private WindowInsets lastInsets;
    private ValueCallback<Uri[]> filePathCallback;
    private String pendingExport;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(COLOR_BG);
        getWindow().setNavigationBarColor(COLOR_BG);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);

        root = new FrameLayout(this);
        root.setBackgroundColor(COLOR_BG);
        setContentView(root, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }

        webView = new WebView(this);
        webView.setBackgroundColor(COLOR_BG);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setTextZoom(100);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveLocal(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return uri == null || !APP_HOST.equals(uri.getHost());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (lastInsets != null) applySafeArea(lastInsets);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try {
                    startActivityForResult(intent, REQ_FILE_CHOOSER);
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "Не удалось открыть выбор файла",
                            Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        webView.addJavascriptInterface(new Bridge(), "CodeTableBridge");

        root.setOnApplyWindowInsetsListener((v, insets) -> {
            lastInsets = insets;
            applySafeArea(insets);
            return insets;
        });

        splashView = new SplashView(this);
        root.addView(splashView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        splashView.start(() -> {
            if (splashView != null) {
                root.removeView(splashView);
                splashView = null;
            }
        });

        webView.loadUrl(APP_URL);
    }

    private void applySafeArea(WindowInsets insets) {
        if (webView == null) return;
        try {
            int top, right, bottom, left;
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets sys = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                top = sys.top;
                right = sys.right;
                bottom = sys.bottom;
                left = sys.left;
            } else {
                top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight();
                bottom = insets.getSystemWindowInsetBottom();
                left = insets.getSystemWindowInsetLeft();
            }
            float density = getResources().getDisplayMetrics().density;
            String js = "if(window.__applySafeArea)window.__applySafeArea("
                    + Math.round(top / density) + ","
                    + Math.round(right / density) + ","
                    + Math.round(bottom / density) + ","
                    + Math.round(left / density) + ")";
            webView.evaluateJavascript(js, null);
        } catch (Throwable ignored) {
            // отступы не критичны для работы приложения
        }
    }

    private WebResourceResponse serveLocal(Uri uri) {
        if (uri == null || !APP_HOST.equals(uri.getHost())) return null;
        String path = uri.getPath();
        if (path == null) path = "/";
        while (path.startsWith("/")) path = path.substring(1);
        if (path.startsWith("assets/")) path = path.substring("assets/".length());
        if (path.isEmpty() || path.endsWith("/")) path = path + "index.html";

        String ext = "";
        int dot = path.lastIndexOf('.');
        if (dot >= 0) ext = path.substring(dot + 1).toLowerCase(Locale.US);
        String mime = MIME.get(ext);
        if (mime == null) {
            String guessed = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            mime = guessed != null ? guessed : "application/octet-stream";
        }

        try {
            InputStream in = getAssets().open(path);
            WebResourceResponse response = new WebResourceResponse(mime, "UTF-8", in);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            response.setResponseHeaders(headers);
            return response;
        } catch (IOException e) {
            if (mime.startsWith("text/html")) {
                String page = "<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\">"
                        + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                        + "<title>Таблица кодов</title></head>"
                        + "<body style=\"font-family:sans-serif;background:#07060d;color:#f4effc;"
                        + "padding:24px\"><h3>Таблица кодов</h3><p>Не удалось открыть файл:<br>"
                        + path + "</p></body></html>";
                WebResourceResponse response = new WebResourceResponse("text/html", "UTF-8",
                        new ByteArrayInputStream(page.getBytes(StandardCharsets.UTF_8)));
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-store");
                response.setResponseHeaders(headers);
                return response;
            }
            return null;
        }
    }

    private void callJs(String js) {
        if (webView != null) webView.evaluateJavascript(js, null);
    }

    private void readImportedDocument(Uri uri) {
        if (uri == null) return;
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("empty");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            int total = 0;
            while ((read = in.read(buffer)) > 0) {
                total += read;
                if (total > 16 * 1024 * 1024) throw new IOException("too large");
                out.write(buffer, 0, read);
            }
            String text = new String(out.toByteArray(), StandardCharsets.UTF_8);
            callJs("window.__onImportText && window.__onImportText(" + JSONObject.quote(text) + ")");
        } catch (Exception e) {
            runOnUiThread(() -> Toast.makeText(this, "Не удалось прочитать файл",
                    Toast.LENGTH_SHORT).show());
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }

        if (requestCode == REQ_EXPORT) {
            boolean ok = false;
            if (resultCode == RESULT_OK && data != null && data.getData() != null
                    && pendingExport != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    if (out != null) {
                        out.write(pendingExport.getBytes(StandardCharsets.UTF_8));
                        out.flush();
                        ok = true;
                    }
                } catch (Exception ignored) {
                    ok = false;
                }
            }
            pendingExport = null;
            callJs("window.__onExportDone && window.__onExportDone(" + ok + ")");
            return;
        }

        if (requestCode == REQ_IMPORT) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                readImportedDocument(data.getData());
            }
            return;
        }

        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "window.__appBack ? String(window.__appBack()) : 'false'",
                value -> {
                    if (!"true".equals(value)) moveTaskToBack(true);
                });
    }

    @Override
    protected void onDestroy() {
        if (splashView != null) {
            splashView.stop();
            splashView = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /** Мост для обмена данными, буфером обмена и тактильным откликом. */
    public class Bridge {
        @android.webkit.JavascriptInterface
        public void copyText(final String text) {
            runOnUiThread(() -> {
                try {
                    ClipboardManager manager = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    if (manager != null) {
                        manager.setPrimaryClip(ClipData.newPlainText("Таблица кодов", text));
                    }
                } catch (Throwable ignored) {
                }
            });
        }

        @android.webkit.JavascriptInterface
        public void exportFile(final String filename, final String content) {
            runOnUiThread(() -> {
                pendingExport = content;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, filename);
                try {
                    startActivityForResult(intent, REQ_EXPORT);
                } catch (Exception e) {
                    pendingExport = null;
                    Toast.makeText(MainActivity.this, "Не удалось открыть сохранение файла",
                            Toast.LENGTH_SHORT).show();
                }
            });
        }

        @android.webkit.JavascriptInterface
        public void importFile() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try {
                    startActivityForResult(intent, REQ_IMPORT);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Не удалось открыть выбор файла",
                            Toast.LENGTH_SHORT).show();
                }
            });
        }

        @android.webkit.JavascriptInterface
        public void vibrate(final int ms) {
            runOnUiThread(() -> {
                try {
                    android.os.Vibrator vibrator =
                            (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
                    if (vibrator != null && vibrator.hasVibrator()) {
                        if (android.os.Build.VERSION.SDK_INT >= 26) {
                            vibrator.vibrate(android.os.VibrationEffect.createOneShot(
                                    ms, android.os.VibrationEffect.DEFAULT_AMPLITUDE));
                        } else {
                            vibrator.vibrate(ms);
                        }
                    }
                } catch (Throwable ignored) {
                }
            });
        }

        @android.webkit.JavascriptInterface
        public void ready() {
            // страница запустилась; можно использовать для диагностики
        }
    }

    /**
     * Пятисекундная заставка: звёздное небо, вращающиеся кольца, логотип,
     * золотой заголовок и полоса загрузки. К концу пятой секунды плавно гаснет.
     */
    private class SplashView extends View {
        private static final long DURATION = 5000L;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Bitmap logo;
        private final float density;
        private final float[] starX = new float[58];
        private final float[] starY = new float[58];
        private final float[] starR = new float[58];
        private final float[] starPhase = new float[58];
        private ValueAnimator animator;
        private Runnable onDone;
        private float progress;
        private float cx;
        private float cy;
        private float logoSize;

        SplashView(Activity context) {
            super(context);
            density = getResources().getDisplayMetrics().density;
            int logoId = getResources().getIdentifier("splash_mark", "drawable", getPackageName());
            logo = logoId != 0 ? BitmapFactory.decodeResource(getResources(), logoId) : null;
            setBackgroundColor(0xff06050c);
            Random random = new Random(9);
            for (int i = 0; i < starX.length; i++) {
                starX[i] = random.nextFloat();
                starY[i] = random.nextFloat();
                starR[i] = (0.5f + random.nextFloat() * 1.2f) * density;
                starPhase[i] = random.nextFloat() * 6.28f;
            }
        }

        void start(Runnable done) {
            onDone = done;
            animator = ValueAnimator.ofFloat(0f, 1f);
            animator.setDuration(DURATION);
            animator.setInterpolator(new LinearInterpolator());
            animator.addUpdateListener(animation -> {
                progress = (float) animation.getAnimatedValue();
                float fade = progress <= 0.92f ? 1f : 1f - (progress - 0.92f) / 0.08f;
                setAlpha(Math.max(0f, fade));
                invalidate();
            });
            animator.addListener(new android.animation.AnimatorListenerAdapter() {
                @Override
                public void onAnimationEnd(android.animation.Animator animation) {
                    if (onDone != null) onDone.run();
                }
            });
            animator.start();
        }

        void stop() {
            if (animator != null) {
                animator.cancel();
                animator = null;
            }
            onDone = null;
        }

        private float dp(float value) {
            return value * density;
        }

        @Override
        protected void onSizeChanged(int w, int h, int oldw, int oldh) {
            super.onSizeChanged(w, h, oldw, oldh);
            cx = w / 2f;
            cy = h * 0.395f;
            logoSize = Math.min(w * 0.32f, dp(150));
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            int w = getWidth();
            int h = getHeight();
            if (w == 0 || h == 0) return;

            paint.setStyle(Paint.Style.FILL);
            paint.setShader(new LinearGradient(0, 0, 0, h,
                    new int[]{0xff100b20, 0xff08060f, 0xff04030a},
                    new float[]{0f, 0.55f, 1f}, Shader.TileMode.CLAMP));
            canvas.drawRect(0, 0, w, h, paint);

            paint.setShader(new RadialGradient(cx, cy, Math.max(w, h) * 0.62f,
                    new int[]{0x553a2b74, 0x1a2b2050, 0x00000000},
                    new float[]{0f, 0.45f, 1f}, Shader.TileMode.CLAMP));
            canvas.drawCircle(cx, cy, Math.max(w, h) * 0.62f, paint);
            paint.setShader(null);

            // звёзды
            for (int i = 0; i < starX.length; i++) {
                float twinkle = 0.25f + 0.6f * Math.abs((float) Math.sin(
                        progress * 9f + starPhase[i]));
                paint.setColor(i % 5 == 0 ? 0xfff0cf82 : 0xffffffff);
                paint.setAlpha((int) (twinkle * 150));
                canvas.drawCircle(starX[i] * w, starY[i] * h, starR[i], paint);
            }
            paint.setAlpha(255);

            float ringRadius = logoSize * 1.22f;
            RectF ring = new RectF(cx - ringRadius, cy - ringRadius,
                    cx + ringRadius, cy + ringRadius);

            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(dp(0.8f));
            paint.setColor(0x30f0cf82);
            canvas.drawCircle(cx, cy, ringRadius * 0.78f, paint);
            paint.setColor(0x24a595ff);
            canvas.drawCircle(cx, cy, ringRadius * 1.12f, paint);

            paint.setStrokeWidth(dp(1.15f));
            paint.setColor(0x66f0cf82);
            canvas.drawArc(ring, progress * 360f, 218f, false, paint);

            RectF violetRing = new RectF(cx - ringRadius * 1.12f, cy - ringRadius * 1.12f,
                    cx + ringRadius * 1.12f, cy + ringRadius * 1.12f);
            paint.setColor(0x55a595ff);
            canvas.drawArc(violetRing, -progress * 250f, 96f, false, paint);

            paint.setStrokeWidth(dp(1.6f));
            paint.setColor(0x55f0cf82);
            paint.setPathEffect(new DashPathEffect(new float[]{dp(1.5f), dp(7f)}, 0f));
            RectF dotted = new RectF(cx - ringRadius * 0.92f, cy - ringRadius * 0.92f,
                    cx + ringRadius * 0.92f, cy + ringRadius * 0.92f);
            canvas.drawArc(dotted, progress * 120f, 320f, false, paint);
            paint.setPathEffect(null);

            // логотип с мягким свечением и медленным поворотом
            float intro = Math.min(1f, progress / 0.18f);
            float eased = 1f - (float) Math.pow(1f - intro, 3);
            float pulse = 1f + 0.018f * (float) Math.sin(progress * Math.PI * 3.0);
            float scale = (0.72f + 0.28f * eased) * pulse;

            paint.setShader(new RadialGradient(cx, cy, logoSize * 0.9f,
                    new int[]{0x44f0cf82, 0x00000000}, new float[]{0f, 1f},
                    Shader.TileMode.CLAMP));
            canvas.drawCircle(cx, cy, logoSize * 0.9f, paint);
            paint.setShader(null);

            if (logo != null) {
                canvas.save();
                canvas.translate(cx, cy);
                canvas.rotate(progress * 12f);
                canvas.scale(scale, scale);
                paint.setAlpha((int) (eased * 255));
                canvas.drawBitmap(logo, -logoSize / 2f, -logoSize / 2f, paint);
                paint.setAlpha(255);
                canvas.restore();
            }

            // заголовок
            float titleSize = Math.min(dp(34), w * 0.088f);
            textPaint.setTypeface(Typeface.create("serif", Typeface.BOLD));
            textPaint.setTextSize(titleSize);
            textPaint.setTextAlign(Paint.Align.CENTER);
            textPaint.setLetterSpacing(0.06f);
            textPaint.setFakeBoldText(false);
            float titleY = cy + logoSize * 0.75f + dp(50);
            float titleWidth = textPaint.measureText("Таблица кодов");
            textPaint.setShader(new LinearGradient(cx - titleWidth / 2f, 0, cx + titleWidth / 2f, 0,
                    new int[]{0xfffff8e6, 0xfff0cf82, 0xffc79f56},
                    new float[]{0f, 0.5f, 1f}, Shader.TileMode.CLAMP));
            textPaint.setAlpha((int) (Math.min(1f, Math.max(0f, (progress - 0.06f) / 0.18f)) * 255));
            canvas.drawText("Таблица кодов", cx, titleY, textPaint);
            textPaint.setShader(null);
            textPaint.setAlpha(255);

            // подзаголовок
            textPaint.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
            textPaint.setTextSize(dp(9.5f));
            textPaint.setLetterSpacing(0.26f);
            textPaint.setColor(0xff8e86a4);
            textPaint.setAlpha((int) (Math.min(1f, Math.max(0f, (progress - 0.14f) / 0.2f)) * 210));
            canvas.drawText("ДЕВЯТЬ ЦИФР · ТРИ ОТМЕТКИ", cx, titleY + dp(24), textPaint);
            textPaint.setAlpha(255);

            // полоса загрузки
            float progressWidth = Math.min(w * 0.44f, dp(220));
            float progressX = cx - progressWidth / 2f;
            float progressY = h - dp(82);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeWidth(dp(2f));
            paint.setColor(0x22ffffff);
            canvas.drawLine(progressX, progressY, progressX + progressWidth, progressY, paint);
            paint.setShader(new LinearGradient(progressX, 0, progressX + progressWidth, 0,
                    new int[]{0xffd9a94f, 0xfff0cf82, 0xfffff3cf},
                    null, Shader.TileMode.CLAMP));
            paint.setColor(0xffffffff);
            canvas.drawLine(progressX, progressY,
                    progressX + progressWidth * progress, progressY, paint);
            paint.setShader(null);

            // точка на конце полосы
            if (progress > 0.015f) {
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(0x33f0cf82);
                canvas.drawCircle(progressX + progressWidth * progress, progressY, dp(5.5f), paint);
                paint.setColor(0xfff8e6b6);
                canvas.drawCircle(progressX + progressWidth * progress, progressY, dp(1.7f), paint);
            }

            // нижняя подпись
            textPaint.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
            textPaint.setTextSize(dp(8f));
            textPaint.setLetterSpacing(0.18f);
            textPaint.setColor(0xff5f5875);
            canvas.drawText("9 · 3 · 3", cx, h - dp(46), textPaint);
        }
    }
}
