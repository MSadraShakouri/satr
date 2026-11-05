package com.msadrashakouri.satr;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.WebView;

/**
 * What the page said when Android handed the app back.
 *
 * The freeze has survived two rounds of instruments because of where the
 * instruments live. The app's own log writes to a database four seconds
 * later, and a frozen resume is one the reader ends by throwing the app out
 * of recents -- so every line about it dies in memory with the app. In his
 * log the resumes that recovered left two lines each and the frozen ones
 * left nothing at all, which reads as silence but only means the evidence
 * was never saved.
 *
 * So this asks from the other side, in Java, and writes the answer down the
 * moment it arrives. On resume the WebView is asked a question directly --
 * not through Capacitor's event, not through the page's own listeners, both
 * of which are things a frozen page may never run. If the answer comes back,
 * JavaScript is alive and the answer says what the page believes about its
 * own visibility. If it never comes back, JavaScript is not running at all,
 * and that is a different bug with a different fix.
 *
 * The record is written to SharedPreferences as it goes, so a kill cannot
 * take it. At the next launch the previous run's last resume is read out
 * into the log, where he can see it.
 *
 * Nothing here is allowed to matter: every call is wrapped, and the worst
 * failure is one line missing from a log.
 */
final class ResumeWatch {
    private ResumeWatch() {}

    private static final String FILE = "satr-resume";
    /** This run's record, overwritten at every resume. */
    private static final String AT = "at";
    private static final String ANSWER_MS = "answerMs";
    private static final String SAID = "said";
    private static final String LATER_MS = "laterMs";
    private static final String LATER_SAID = "laterSaid";
    private static final String FRAMES = "frames";
    private static final String COUNT = "count";
    /** The previous run's, kept aside at launch before this run overwrites it. */
    private static final String WAS = "was.";

    /** Asked immediately: what does the page think, and can it run a frame? */
    private static final String PROBE =
        "(function(){try{window.__satrFrames=0;" +
        "requestAnimationFrame(function(){window.__satrFrames=(window.__satrFrames||0)+1;});" +
        "return document.visibilityState;}catch(e){return 'threw';}})()";

    /** Asked again once the dust has settled: did the frame ever run? */
    private static final String AGAIN =
        "(function(){try{return document.visibilityState+' '+(window.__satrFrames||0);}catch(e){return 'threw';}})()";

    /** How long to wait before asking the second question. */
    private static final long AGAIN_AFTER_MS = 1500;

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /**
     * Move this run's record aside, before the launch's own resume lands on
     * top of it. Called from onCreate, which always runs first.
     */
    static void startRun(Context context) {
        try {
            SharedPreferences p = prefs(context);
            p.edit()
                .putLong(WAS + AT, p.getLong(AT, 0))
                .putInt(WAS + ANSWER_MS, p.getInt(ANSWER_MS, -1))
                .putString(WAS + SAID, p.getString(SAID, ""))
                .putInt(WAS + LATER_MS, p.getInt(LATER_MS, -1))
                .putString(WAS + LATER_SAID, p.getString(LATER_SAID, ""))
                .putInt(WAS + FRAMES, p.getInt(FRAMES, -1))
                .putInt(WAS + COUNT, p.getInt(COUNT, 0))
                .putLong(AT, 0)
                .putInt(COUNT, 0)
                .apply();
        } catch (Throwable ignored) {
            // A diagnostic is never worth a launch.
        }
    }

    /**
     * Ask the page whether it is there. Called from onResume, on the UI
     * thread, after the window-visibility kick has been sent.
     */
    static void askThePage(Context context, final WebView webView) {
        if (webView == null) return;
        try {
            final SharedPreferences p = prefs(context);
            final long started = SystemClock.elapsedRealtime();
            // "No answer" is written first and only overwritten by an answer,
            // so a page that never replies is recorded by the absence itself.
            p.edit()
                .putLong(AT, System.currentTimeMillis())
                .putInt(ANSWER_MS, -1)
                .putString(SAID, "")
                .putInt(LATER_MS, -1)
                .putString(LATER_SAID, "")
                .putInt(FRAMES, -1)
                .putInt(COUNT, p.getInt(COUNT, 0) + 1)
                .apply();
            webView.evaluateJavascript(PROBE, value -> {
                try {
                    p.edit()
                        .putInt(ANSWER_MS, (int) (SystemClock.elapsedRealtime() - started))
                        .putString(SAID, plain(value))
                        .apply();
                } catch (Throwable ignored) { }
            });
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    final long asked = SystemClock.elapsedRealtime();
                    webView.evaluateJavascript(AGAIN, value -> {
                        try {
                            String answer = plain(value);
                            int frames = -1;
                            String state = answer;
                            int space = answer.lastIndexOf(' ');
                            if (space > 0) {
                                state = answer.substring(0, space);
                                try { frames = Integer.parseInt(answer.substring(space + 1)); } catch (NumberFormatException ignored) { }
                            }
                            p.edit()
                                .putInt(LATER_MS, (int) (SystemClock.elapsedRealtime() - asked))
                                .putString(LATER_SAID, state)
                                .putInt(FRAMES, frames)
                                .apply();
                        } catch (Throwable ignored) { }
                    });
                } catch (Throwable ignored) { }
            }, AGAIN_AFTER_MS);
        } catch (Throwable ignored) { }
    }

    /** evaluateJavascript answers in JSON, so a string arrives in quotes. */
    private static String plain(String value) {
        if (value == null) return "";
        String out = value.trim();
        if (out.length() >= 2 && out.startsWith("\"") && out.endsWith("\"")) {
            out = out.substring(1, out.length() - 1);
        }
        return out.replace("\\\"", "\"");
    }

    /** The previous run's last resume, for the log. Empty when there was none. */
    static com.getcapacitor.JSObject lastResume(Context context) {
        com.getcapacitor.JSObject out = new com.getcapacitor.JSObject();
        try {
            SharedPreferences p = prefs(context);
            long at = p.getLong(WAS + AT, 0);
            out.put("happened", at > 0);
            if (at <= 0) return out;
            out.put("at", at);
            out.put("answerMs", p.getInt(WAS + ANSWER_MS, -1));
            out.put("said", p.getString(WAS + SAID, ""));
            out.put("laterMs", p.getInt(WAS + LATER_MS, -1));
            out.put("laterSaid", p.getString(WAS + LATER_SAID, ""));
            out.put("frames", p.getInt(WAS + FRAMES, -1));
            out.put("resumes", p.getInt(WAS + COUNT, 0));
        } catch (Throwable ignored) {
            out.put("happened", false);
        }
        return out;
    }
}
