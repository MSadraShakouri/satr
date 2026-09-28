package com.msadrashakouri.satr;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Satr's own native plugins, registered before the bridge starts.
        registerPlugin(PrintPlugin.class);
        registerPlugin(StoragePlugin.class);
        registerPlugin(SystemBarsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
