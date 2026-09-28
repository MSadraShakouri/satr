package com.msadrashakouri.satr;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Access to the phone's shared storage, so notes stay plain files in real
 * folders (src/vault.ts reads and writes them through @capacitor/filesystem).
 *
 * Android 11 and newer: "All files access" (MANAGE_EXTERNAL_STORAGE), granted
 * by the user on the system's settings page for Satr; request() opens it
 * and reports back when the user returns. Android 10 and older: the classic
 * storage permissions, asked in a dialog.
 */
@CapacitorPlugin(
    name = "SatrStorage",
    permissions = {
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE })
    }
)
public class StoragePlugin extends Plugin {
    private boolean granted() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) return Environment.isExternalStorageManager();
        return getPermissionState("storage") == PermissionState.GRANTED;
    }

    private JSObject state() {
        JSObject result = new JSObject();
        result.put("granted", granted());
        result.put("sdk", Build.VERSION.SDK_INT);
        return result;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (granted()) {
            call.resolve(state());
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
                startActivityForResult(call, intent, "allFilesResult");
            } catch (ActivityNotFoundException error) {
                // Some builds lack the per-app page: open the list of apps instead.
                try {
                    startActivityForResult(call, new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION), "allFilesResult");
                } catch (ActivityNotFoundException again) {
                    call.reject("This phone has no settings page for all-files access");
                }
            }
        } else {
            requestPermissionForAlias("storage", call, "storageResult");
        }
    }

    @ActivityCallback
    private void allFilesResult(PluginCall call, ActivityResult result) {
        if (call != null) call.resolve(state());
    }

    @PermissionCallback
    private void storageResult(PluginCall call) {
        call.resolve(state());
    }
}
