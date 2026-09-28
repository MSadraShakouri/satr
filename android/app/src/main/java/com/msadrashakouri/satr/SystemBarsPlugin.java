package com.msadrashakouri.satr;

import android.graphics.Color;
import android.os.Build;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Edge to edge, as Obsidian's app: the page is drawn behind the status and
 * navigation bars, which are transparent and take their icon colour from the
 * theme. The page learns how much the bars cover from CSS variables
 * (--safe-area-inset-top/right/bottom/left, in CSS px), which src/native.ts
 * sets from what this plugin reports; the header and the bottom bar keep
 * clear of the bars with them.
 *
 * The bars' sizes are taken whether or not they're showing, so hiding the
 * status bar while scrolling doesn't move the page.
 *
 * The keyboard: edge to edge, Android no longer shrinks the page for it
 * (adjustResize), so the WebView gets a bottom margin as tall as the keyboard
 * instead, and the bottom inset is 0 while it's up (the keyboard covers the
 * navigation bar).
 *
 * The WebView's text zoom is fixed at 100%, as in Obsidian: the phone's font
 * size setting doesn't enlarge the app.
 */
@CapacitorPlugin(name = "SatrSystemBars")
public class SystemBarsPlugin extends Plugin {
    private JSObject last = null;

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            WindowCompat.setDecorFitsSystemWindows(window, false);
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                window.setStatusBarContrastEnforced(false);
                window.setNavigationBarContrastEnforced(false);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                WindowManager.LayoutParams attrs = window.getAttributes();
                attrs.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                window.setAttributes(attrs);
            }
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);

            WebView webView = getBridge().getWebView();
            webView.getSettings().setTextZoom(100);
            ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
                int types = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
                Insets bars = insets.getInsetsIgnoringVisibility(types);
                boolean keyboard = insets.isVisible(WindowInsetsCompat.Type.ime());
                int keyboardHeight = keyboard ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0;

                ViewGroup.MarginLayoutParams params = (ViewGroup.MarginLayoutParams) view.getLayoutParams();
                if (params.bottomMargin != keyboardHeight) {
                    params.bottomMargin = keyboardHeight;
                    view.setLayoutParams(params);
                }

                float density = view.getResources().getDisplayMetrics().density;
                JSObject data = new JSObject();
                data.put("top", bars.top / density);
                data.put("right", bars.right / density);
                data.put("bottom", keyboard ? 0 : bars.bottom / density);
                data.put("left", bars.left / density);
                data.put("keyboard", keyboardHeight / density);
                if (last == null || !last.toString().equals(data.toString())) {
                    last = data;
                    notifyListeners("insets", data, true);
                }
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(webView);
        });
    }

    /** The latest insets, for the page to start with. */
    @PluginMethod
    public void get(PluginCall call) {
        if (last == null) {
            call.resolve(new JSObject());
        } else {
            call.resolve(last);
        }
    }

    /** Bar icons for the theme: dark = light icons on the dark page. */
    @PluginMethod
    public void setStyle(PluginCall call) {
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            controller.setAppearanceLightStatusBars(!dark);
            controller.setAppearanceLightNavigationBars(!dark);
            window.getDecorView().setBackgroundColor(dark ? Color.BLACK : Color.WHITE);
            call.resolve();
        });
    }

    /** Hide the status bar (scrolling down); a swipe shows it for a moment. */
    @PluginMethod
    public void hide(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            WindowCompat.getInsetsController(window, window.getDecorView()).hide(WindowInsetsCompat.Type.statusBars());
            call.resolve();
        });
    }

    @PluginMethod
    public void show(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            WindowCompat.getInsetsController(window, window.getDecorView()).show(WindowInsetsCompat.Type.statusBars());
            call.resolve();
        });
    }
}
