package lab.maze.reboot;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.view.ViewGroup;
import android.view.View;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String START_URL = ORIGIN + "/assets/index.html";
    private static final int PICK_JSON = 41;
    private WebView webView;
    private ValueCallback<Uri[]> picker;
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private ExportStore exports;
    private boolean destroyed;
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        try { exports = new ExportStore(new File(getCacheDir(), "reboot-exports")); }
        catch (IOException error) { new AlertDialog.Builder(this).setMessage("Не удалось открыть каталог экспорта: " + error.getMessage()).setPositiveButton("Закрыть", (d,w) -> finish()).show(); return; }
        createWebView();
    }
    private static boolean trusted(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost()) && uri.getPort() == -1 && uri.getPath() != null && uri.getPath().startsWith("/assets/");
    }
    private boolean trustedPage() { return !destroyed && webView != null && trusted(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl())); }
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void createWebView() {
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        WebView view = new WebView(this); webView = view;
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false); settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false); settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        view.addJavascriptInterface(new ExportBridge(), "RebootNative");
        view.setWebViewClient(new WebViewClient() {
            public boolean shouldOverrideUrlLoading(WebView web, WebResourceRequest request) { return !trusted(request.getUrl()); }
            public WebResourceResponse shouldInterceptRequest(WebView web, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!trusted(uri) || !"GET".equals(request.getMethod())) return blocked();
                String path = uri.getPath().substring("/assets/".length());
                if (path.isEmpty()) path = "index.html";
                if (path.contains("..") || path.indexOf('\\') >= 0 || path.indexOf('\0') >= 0) return blocked();
                String lower = path.toLowerCase(Locale.ROOT);
                String mime = lower.endsWith(".js") ? "text/javascript" : lower.endsWith(".css") ? "text/css" : lower.endsWith(".svg") ? "image/svg+xml" : lower.endsWith(".json") ? "application/json" : lower.endsWith(".png") ? "image/png" : lower.endsWith(".wasm") ? "application/wasm" : lower.endsWith(".html") ? "text/html" : "application/octet-stream";
                try {
                    Map<String,String> headers = new HashMap<>();
                    headers.put("Content-Security-Policy", "default-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'");
                    headers.put("X-Content-Type-Options", "nosniff"); headers.put("Cache-Control", "no-cache");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open(path));
                } catch (IOException error) { return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", new HashMap<>(), new ByteArrayInputStream(new byte[0])); }
            }
            public boolean onRenderProcessGone(WebView web, RenderProcessGoneDetail detail) {
                if (web == webView) {
                    web.removeJavascriptInterface("RebootNative"); web.destroy(); webView = null;
                    files.execute(() -> exports.close());
                    new AlertDialog.Builder(MainActivity.this).setTitle("Сцена остановлена").setMessage("Графический процесс остановился. Подтверждённые записи сохранены; библиотеку можно открыть снова.").setPositiveButton("Открыть библиотеку", (d,w) -> { if (!destroyed) createWebView(); }).show();
                }
                return true;
            }
        });
        view.setWebChromeClient(new WebChromeClient() {
            public boolean onShowFileChooser(WebView web, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!trustedPage()) return false;
                if (picker != null) picker.onReceiveValue(null);
                picker = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("*/*"); intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[] { "application/json", "text/json", "text/plain", "application/octet-stream" });
                try { startActivityForResult(intent, PICK_JSON); }
                catch (RuntimeException error) { picker.onReceiveValue(null); picker = null; }
                return true;
            }
        });
        FrameLayout container = new FrameLayout(this);
        container.addView(view,new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT));
        container.setOnApplyWindowInsetsListener((root,insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                root.setPadding(bars.left,bars.top,bars.right,bars.bottom);
            } else root.setPadding(insets.getStableInsetLeft(),insets.getStableInsetTop(),insets.getStableInsetRight(),insets.getStableInsetBottom());
            return insets;
        });
        setContentView(container); view.loadUrl(START_URL);
    }
    private static WebResourceResponse blocked() { return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", new HashMap<>(), new ByteArrayInputStream(new byte[0])); }
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request,result,data);
        if (request == PICK_JSON && picker != null) {
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            picker.onReceiveValue(uri == null ? null : new Uri[] { uri }); picker = null;
        }
    }
    private interface FileAction { JSONObject run() throws Exception; }
    private void enqueue(String requestId, FileAction action) {
        if (requestId == null || !requestId.matches("[a-zA-Z0-9_-]{1,128}")) return;
        runOnUiThread(() -> {
            if (!trustedPage()) return;
            files.execute(() -> {
                try { receipt(requestId,true,action.run(),null); }
                catch (Exception error) { receipt(requestId,false,null,error.getMessage() == null ? "Ошибка записи файла" : error.getMessage()); }
            });
        });
    }
    private void receipt(String requestId, boolean ok, JSONObject result, String error) {
        try {
            JSONObject body = new JSONObject(); body.put("requestId",requestId); body.put("ok",ok); body.put("result",result == null ? JSONObject.NULL : result); body.put("error",error == null ? JSONObject.NULL : error);
            String script = "window.dispatchEvent(new CustomEvent('maze-native-receipt',{detail:JSON.parse(" + JSONObject.quote(body.toString()) + ")}));";
            runOnUiThread(() -> { if (trustedPage()) webView.evaluateJavascript(script,null); });
        } catch (Exception ignored) { /* The caller times out and explicitly aborts its own export. */ }
    }
    public final class ExportBridge {
        @JavascriptInterface public void begin(String requestId, String exportId, String filename, long expectedBytes) {
            enqueue(requestId, () -> new JSONObject().put("sequence",exports.begin(exportId,filename,expectedBytes)));
        }
        @JavascriptInterface public void append(String requestId, String exportId, int sequence, String chunk) {
            enqueue(requestId, () -> new JSONObject().put("sequence",exports.append(exportId,sequence,chunk)));
        }
        @JavascriptInterface public void finish(String requestId, String exportId) {
            if (requestId == null || !requestId.matches("[a-zA-Z0-9_-]{1,128}")) return;
            runOnUiThread(() -> {
                if (!trustedPage()) return;
                files.execute(() -> {
                    try {
                        File file = exports.finish(exportId);
                        Uri uri = new Uri.Builder().scheme("content").authority(getPackageName() + ".exports").appendPath("exports").appendPath(file.getName()).build();
                        runOnUiThread(() -> {
                            if (!trustedPage()) return;
                            try {
                                Intent share = new Intent(Intent.ACTION_SEND).setType("application/json").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                share.setClipData(ClipData.newRawUri("Maze Lab JSON",uri));
                                startActivity(Intent.createChooser(share,"Отправить пакет Maze Lab"));
                                receipt(requestId,true,new JSONObject().put("bytes",file.length()).put("prepared",true),null);
                            } catch (Exception error) { receipt(requestId,false,null,"Файл записан, но меню отправки недоступно: " + error.getMessage()); }
                        });
                    } catch (Exception error) { receipt(requestId,false,null,error.getMessage()); }
                });
            });
        }
        @JavascriptInterface public void abort(String requestId, String exportId) { enqueue(requestId, () -> { exports.abort(exportId); return new JSONObject().put("aborted",true); }); }
    }
    protected void onPause() {
        if (webView != null) { webView.evaluateJavascript("window.dispatchEvent(new Event('blur'));",null); webView.onPause(); }
        super.onPause();
    }
    protected void onResume() { super.onResume(); if (webView != null) webView.onResume(); }
    @Override public void onBackPressed() {
        if (!trustedPage()) { super.onBackPressed(); return; }
        webView.evaluateJavascript("(function(){return !window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));})()", handled -> { if (!"true".equals(handled)) MainActivity.super.onBackPressed(); });
    }
    protected void onDestroy() {
        destroyed = true;
        if (picker != null) { picker.onReceiveValue(null); picker = null; }
        if (webView != null) { webView.removeJavascriptInterface("RebootNative"); webView.destroy(); webView = null; }
        files.execute(() -> { if (exports != null) exports.close(); }); files.shutdown();
        super.onDestroy();
    }
}
