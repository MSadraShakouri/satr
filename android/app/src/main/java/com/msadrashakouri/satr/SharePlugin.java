package com.msadrashakouri.satr;

import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;

/**
 * The share sheet: hands a piece of text to whatever the phone can send it
 * with -- a messenger, mail, Drive, Files.
 *
 * It is a file and not EXTRA_TEXT. A log runs to hundreds of kilobytes, and
 * an intent's whole payload has to fit in a Binder transaction (1 MB shared
 * across every transaction in flight), so a long string is a TransactionTooLarge
 * crash waiting for the day the log is interesting. Written into the cache and
 * passed as a content:// URI, the size stops mattering, and the receiving app
 * gets something it can save under a name.
 *
 * FileProvider has been in the support library since 2013 and the manifest
 * already declares one for the PDF export, so this works on every version the
 * app runs on -- no ladder, no newest-only path. The grant is read-only and
 * belongs to the chooser, which passes it on to whichever app is picked.
 *
 * The file goes in cache/shared: Android empties the cache under pressure and
 * each share overwrites the last, so the log never accumulates copies of
 * itself on a phone that is already short of room.
 */
@CapacitorPlugin(name = "SatrShare")
public class SharePlugin extends Plugin {
    @PluginMethod
    public void shareText(PluginCall call) {
        final String text = call.getString("text", "");
        final String name = call.getString("name", "satr.txt");
        final String title = call.getString("title", "Share");
        final String type = call.getString("type", "text/plain");
        if (text == null || text.isEmpty()) {
            call.reject("Nothing to share");
            return;
        }
        try {
            File folder = new File(getContext().getCacheDir(), "shared");
            if (!folder.exists() && !folder.mkdirs()) {
                call.reject("Could not make the folder to share from");
                return;
            }
            File file = new File(folder, safeName(name));
            try (OutputStreamWriter out = new OutputStreamWriter(new FileOutputStream(file), StandardCharsets.UTF_8)) {
                out.write(text);
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(type);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, file.getName());
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            // Started from the activity, not the application context, so the
            // chooser belongs to the app's own task and Back returns here.
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not share: " + error.getMessage(), error);
        }
    }

    /** A file name the system will accept, whatever the caller asked for. */
    private String safeName(String name) {
        String cleaned = name.replaceAll("[^A-Za-z0-9._-]", "-");
        if (cleaned.isEmpty() || cleaned.equals(".") || cleaned.equals("..")) cleaned = "satr.txt";
        return cleaned.length() > 96 ? cleaned.substring(cleaned.length() - 96) : cleaned;
    }
}
