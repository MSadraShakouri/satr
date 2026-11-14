package com.msadrashakouri.satr;

import android.os.Bundle;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static volatile boolean splashDismissed = false;

    /** Let the system splash screen leave once the app has booted. */
    public static void dismissSplash() {
        splashDismissed = true;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Keep the system splash (the launcher icon in a circle) on screen
        // until the web app has booted, so Satr's own cover never shows as a
        // second animation. A safety timeout guarantees it cannot hang, and it
        // is long enough that a big note opening is not uncovered in the
        // middle of its boot (8 s, Obsidian's launchShowDuration).
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        // Satr's own native plugins, registered before the bridge starts.
        registerPlugin(PrintPlugin.class);
        registerPlugin(StoragePlugin.class);
        registerPlugin(ImageWritePlugin.class);
        registerPlugin(ImagePastePlugin.class);
        registerPlugin(SystemBarsPlugin.class);
        registerPlugin(OpenFilePlugin.class);
        registerPlugin(PdfRangePlugin.class);
        registerPlugin(SplashPlugin.class);
        registerPlugin(SharePlugin.class);
        registerPlugin(DiagnosticsPlugin.class);
        // Before the launch's own onResume lands on top of it: what the page
        // said at the last resume of the run before this one.
        ResumeWatch.startRun(this);
        super.onCreate(savedInstanceState);
        com.getcapacitor.Bridge bridge = getBridge();
        bridge.setWebViewClient(new com.getcapacitor.BridgeWebViewClient(bridge) {
            @Override public android.webkit.WebResourceResponse shouldInterceptRequest(android.webkit.WebView view, android.webkit.WebResourceRequest request) {
                if (view instanceof ImagePasteWebView) {
                    android.webkit.WebResourceResponse paste = ((ImagePasteWebView) view).intercept(bridge, request);
                    if (paste != null) return paste;
                }
                com.getcapacitor.PluginHandle handle = bridge.getPlugin("SatrPdfRange");
                android.webkit.WebResourceResponse response = handle == null ? null : ((PdfRangePlugin) handle.getInstance()).intercept(bridge, request);
                return response != null ? response : super.shouldInterceptRequest(view, request);
            }
        });
        splashScreen.setKeepOnScreenCondition(() -> !splashDismissed);
        new android.os.Handler(android.os.Looper.getMainLooper())
            .postDelayed(() -> splashDismissed = true, 8000);
    }

    @Override
    public void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    /**
     * Tell the web page it is on screen again.
     *
     * The freeze: coming back from recents, or from a screenshot overlay, the
     * app is handed back and painted once -- and then nothing. Touches work,
     * scrolling works, because the compositor still has the old picture, but
     * nothing new is ever drawn. It cleared by itself after about a minute,
     * or when the page was reopened.
     *
     * The log says why. The instrument added in 0.18.7 prints the page's own
     * visibilityState at the moment Android says the app is back, and at
     * every single resume it reads:
     *
     *     60.80s came back awayFor=1 visibility=hidden
     *     60.83s came back awayFor=1 visibility=visible
     *
     * The page is handed back while it still believes it is hidden, and the
     * belief is corrected about thirty milliseconds later. A hidden page runs
     * no requestAnimationFrame, so it cannot draw: the frame requested in
     * that window waited 33 ms for the flip, the next one took 6 ms. The
     * freeze is that flip never arriving.
     *
     * Chromium decides the page is visible from the WebView's *window*
     * visibility -- not from setVisibility, and not from the activity --
     * which it learns through a dispatch down the view hierarchy. Capacitor
     * never touches that: KeepRunning defaults to true, so BridgeActivity
     * calls neither WebView.onPause nor WebView.onResume, and nothing in the
     * stack corrects a window-visibility signal that went missing or arrived
     * stale. Hence this: when the activity resumes, say it outright.
     *
     * It is idempotent -- the WebView ignores a visibility it already has --
     * and it is sent twice, once now and once a moment later, because the
     * signal we are racing is a stale one that can land after onResume.
     *
     * This cannot be compiled or tested in the workspace; the phone is the
     * test. After this, the first "came back" of a resume should read
     * visibility=visible.
     */
    @Override
    public void onResume() {
        super.onResume();
        sayTheWindowIsVisible(false);
        new android.os.Handler(android.os.Looper.getMainLooper())
            .postDelayed(() -> sayTheWindowIsVisible(true), 300);
    }

    /** Never worth a crash on resume: a wrong WebView is better than none. */
    private void sayTheWindowIsVisible(boolean again) {
        try {
            if (isFinishing() || isDestroyed() || getBridge() == null) return;
            android.webkit.WebView webView = getBridge().getWebView();
            if (webView == null) return;
            webView.dispatchWindowVisibilityChanged(android.view.View.VISIBLE);
            // The other half of Chromium's rule (visible = not paused and the
            // window is visible). Capacitor never pauses the WebView, so these
            // are normally no-ops -- but a WebView paused by anything else
            // would report hidden in exactly the same way.
            webView.onResume();
            webView.resumeTimers();
            // And then ask the page, from out here, whether any of it landed.
            // The answer is written down natively as it arrives, so a resume
            // the reader ends by throwing the app out of recents still leaves
            // its evidence behind. Only on the first of the two kicks.
            if (!again) ResumeWatch.askThePage(this, webView);
        } catch (Throwable ignored) {
            // An OEM WebView that dislikes any of this must not take the app
            // down every time it is reopened.
        }
    }
}