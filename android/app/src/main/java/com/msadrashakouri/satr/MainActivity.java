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
        registerPlugin(SystemBarsPlugin.class);
        registerPlugin(OpenFilePlugin.class);
        registerPlugin(SplashPlugin.class);
        super.onCreate(savedInstanceState);
        splashScreen.setKeepOnScreenCondition(() -> !splashDismissed);
        new android.os.Handler(android.os.Looper.getMainLooper())
            .postDelayed(() -> splashDismissed = true, 8000);
    }

    @Override
    public void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }
}