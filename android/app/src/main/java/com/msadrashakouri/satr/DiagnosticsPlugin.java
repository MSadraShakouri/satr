package com.msadrashakouri.satr;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * Why the app stopped last time, according to Android.
 *
 * This is the top rung of the ladder and nothing stands on it. The app's own
 * heartbeat already tells every version *that* a run ended without saying
 * goodbye and *when*; getHistoricalProcessExitReasons, which arrived in
 * Android 11, adds *why* -- a crash, an ANR, the low-memory killer, the user
 * force-stopping it. Below API 30 this answers "not supported" and the log
 * loses a detail, never a feature.
 *
 * A phone that reports a low-memory kill as a plain SIGKILL is common enough
 * that the reason is reported as it comes, with the system's own description
 * beside it, rather than being guessed into a nicer word. Whether this phone
 * can tell the difference at all is its own answer, from
 * isLowMemoryKillReportSupported.
 */
@CapacitorPlugin(name = "SatrDiagnostics")
public class DiagnosticsPlugin extends Plugin {
    @PluginMethod
    public void lastExits(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            // Not an error: the caller asks every launch and expects an
            // honest no on the phones that cannot answer.
            result.put("supported", false);
            result.put("exits", new JSArray());
            call.resolve(result);
            return;
        }
        int want = call.getInt("limit", 5);
        try {
            ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            List<ApplicationExitInfo> exits = manager.getHistoricalProcessExitReasons(getContext().getPackageName(), 0, want);
            JSArray list = new JSArray();
            for (ApplicationExitInfo exit : exits) {
                JSObject one = new JSObject();
                one.put("reason", nameOf(exit.getReason()));
                one.put("code", exit.getReason());
                one.put("at", exit.getTimestamp());
                one.put("status", exit.getStatus());
                one.put("importance", exit.getImportance());
                one.put("rss", exit.getRss());
                one.put("pss", exit.getPss());
                String said = exit.getDescription();
                if (said != null && !said.isEmpty()) one.put("said", said);
                list.put(one);
            }
            result.put("supported", true);
            result.put("lowMemoryReported", ActivityManager.isLowMemoryKillReportSupported());
            result.put("exits", list);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not read the exit reasons: " + error.getMessage(), error);
        }
    }

    /** The constant's own name, so the log says "low memory" and not "3". */
    private String nameOf(int reason) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return String.valueOf(reason);
        switch (reason) {
            case ApplicationExitInfo.REASON_EXIT_SELF: return "exited by itself";
            case ApplicationExitInfo.REASON_SIGNALED: return "signalled";
            case ApplicationExitInfo.REASON_LOW_MEMORY: return "low memory";
            case ApplicationExitInfo.REASON_CRASH: return "crash";
            case ApplicationExitInfo.REASON_CRASH_NATIVE: return "native crash";
            case ApplicationExitInfo.REASON_ANR: return "not responding";
            case ApplicationExitInfo.REASON_INITIALIZATION_FAILURE: return "could not start";
            case ApplicationExitInfo.REASON_PERMISSION_CHANGE: return "permission changed";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE: return "using too much";
            case ApplicationExitInfo.REASON_USER_REQUESTED: return "closed by you";
            case ApplicationExitInfo.REASON_USER_STOPPED: return "force stopped";
            case ApplicationExitInfo.REASON_DEPENDENCY_DIED: return "something it needed died";
            case ApplicationExitInfo.REASON_OTHER: return "other";
            case ApplicationExitInfo.REASON_FREEZER: return "frozen";
            case ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE: return "app updated or removed";
            case ApplicationExitInfo.REASON_PACKAGE_UPDATED: return "app updated";
            default: return "reason " + reason;
        }
    }
}
