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
        registerPlugin(OpenFilePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }
}
