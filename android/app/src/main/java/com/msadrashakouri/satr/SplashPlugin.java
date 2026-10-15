package com.msadrashakouri.satr;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Lets the web side dismiss the Android system splash screen. */
@CapacitorPlugin(name = "SatrSplash")
public class SplashPlugin extends Plugin {
    @PluginMethod
    public void dismiss(PluginCall call) {
        MainActivity.dismissSplash();
        call.resolve();
    }
}