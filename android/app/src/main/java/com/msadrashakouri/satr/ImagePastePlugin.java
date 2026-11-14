package com.msadrashakouri.satr;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name="SatrImagePaste")
public final class ImagePastePlugin extends Plugin {
    @PluginMethod public void setEnabled(PluginCall call){
        Boolean enabled=call.getBoolean("enabled");Long sequence=call.getLong("sequence");String session=call.getString("session");
        if(enabled==null||sequence==null||session==null||!session.matches("[0-9a-f-]{36}")){call.reject("Invalid image-paste focus");return;}
        getActivity().runOnUiThread(()->{
            if(getBridge().getWebView() instanceof ImagePasteWebView)((ImagePasteWebView)getBridge().getWebView()).setImagePasteEnabled(enabled,sequence,session);
            call.resolve();
        });
    }
}
