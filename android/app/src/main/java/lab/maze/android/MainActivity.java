package lab.maze.android;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** Offline WebView host. Only APK assets can access the native export bridge. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/assets/index.html";
    private static final int OPEN_FILE = 100;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private boolean activityPaused;

    private static boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
            && uri.getPort() == -1 && uri.getPath() != null
            && uri.getPath().startsWith("/assets/");
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", null,
            new ByteArrayInputStream(new byte[0]));
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(0xff101318);
        frame.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(frame);
        webView = new WebView(this);
        frame.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        webView.setBackgroundColor(0xff101318);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        // Only user-picked ACTION_OPEN_DOCUMENT URIs receive a content grant.
        // Top-level navigation and subresource loads remain restricted to APK assets.
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!isLocal(request.getUrl())) return blocked();
                WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                return response == null ? blocked() : response;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isLocal(request.getUrl());
            }
        });
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                if (!isLocal(request.getUrl())) return blocked();
                WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                return response == null ? blocked() : response;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain"});
                try { startActivityForResult(intent, OPEN_FILE); }
                catch (Exception error) { fileCallback.onReceiveValue(null); fileCallback = null; }
                return true;
            }
        });
        webView.addJavascriptInterface(new ExportBridge(), "MazeAndroid");
        webView.loadUrl(HOME);
    }

    private final class ExportBridge {
        @JavascriptInterface public String getPlatform() { return "android"; }
        @JavascriptInterface public void exportData(String filename, String json) {
            if (filename == null || json == null || json.length() > 64 * 1024 * 1024) return;
            String safe = filename.replaceAll("[^A-Za-z0-9._-]", "_");
            if (safe.isEmpty() || safe.equals(".") || safe.equals("..")) safe = "maze-recordings.json";
            if (safe.length() > 120) safe = safe.substring(0, 120);
            if (!safe.endsWith(".json")) safe += ".json";
            try {
                File directory = new File(getCacheDir(), "exports");
                if (!directory.exists() && !directory.mkdirs()) throw new java.io.IOException("Export directory");
                File file = new File(directory, safe);
                try (FileOutputStream output = new FileOutputStream(file)) {
                    output.write(json.getBytes(StandardCharsets.UTF_8));
                }
                Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".exports", file);
                Intent share = new Intent(Intent.ACTION_SEND);
                share.setType("application/json");
                share.putExtra(Intent.EXTRA_STREAM, uri);
                share.setClipData(ClipData.newRawUri(file.getName(), uri));
                share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> {
                    try { startActivity(Intent.createChooser(share, "Экспорт записи")); }
                    catch (Exception error) { Toast.makeText(MainActivity.this, "Не удалось открыть экспорт", Toast.LENGTH_LONG).show(); }
                });
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Не удалось сохранить JSON", Toast.LENGTH_LONG).show());
            }
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == OPEN_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(result == RESULT_OK && data != null && data.getData() != null
                ? new Uri[]{data.getData()} : null);
            fileCallback = null;
        }
    }
    @Override protected void onPause() {
        activityPaused = true;
        if (webView != null) {
            // Flush app pause/input reset before freezing timers. The callback checks
            // lifecycle state so a fast resume cannot be followed by a stale pause.
            webView.evaluateJavascript("window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('maze:native-pause'));", value -> {
                if (activityPaused && webView != null) webView.pauseTimers();
            });
            webView.onPause();
        }
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        activityPaused = false;
        if (webView != null) {
            webView.resumeTimers();
            webView.onResume();
            webView.evaluateJavascript("window.dispatchEvent(new Event('maze:native-resume'));", null);
        }
    }
    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (!focused && webView != null) {
            webView.evaluateJavascript("window.dispatchEvent(new Event('blur'));", null);
        }
    }
    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        webView.removeJavascriptInterface("MazeAndroid");
        webView.resumeTimers();
        webView.destroy();
        webView = null;
        super.onDestroy();
    }
}
