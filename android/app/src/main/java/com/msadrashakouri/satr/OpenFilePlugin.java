package com.msadrashakouri.satr;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Receives Android ACTION_VIEW / ACTION_EDIT / ACTION_SEND file intents.
 *
 * Like Markor, content:// sources are handled through ContentResolver rather
 * than guessing a filesystem path. The original URI remains the source of
 * truth for reads and writes; unsupported/binary documents are never decoded
 * into editable text. Large files are identified and shown read-only rather
 * than partially loaded.
 */
@CapacitorPlugin(name = "SatrOpenFile")
public class OpenFilePlugin extends Plugin {
    private static final int MAX_TEXT_BYTES = 8 * 1024 * 1024;
    private static final int MAX_PREVIEW_BYTES = 12 * 1024 * 1024;
    private static final Set<String> TEXT_EXTENSIONS = new HashSet<>(Arrays.asList(
        "md", "markdown", "mdown", "txt", "text", "log", "csv", "tsv", "json", "jsonl", "xml", "html", "htm", "css", "js", "mjs", "cjs", "ts", "tsx", "jsx", "java", "kt", "kts", "py", "rb", "go", "rs", "c", "h", "cc", "cpp", "hpp", "sh", "bash", "zsh", "ps1", "toml", "ini", "conf", "config", "yaml", "yml", "sql", "env", "properties", "tex", "rst", "adoc", "svg"
    ));
    private static final Set<String> TEXT_MIME_TYPES = new HashSet<>(Arrays.asList(
        "application/json", "application/ld+json", "application/xml", "application/xhtml+xml", "application/yaml", "application/x-yaml", "application/javascript", "application/x-javascript", "application/toml", "application/sql", "application/csv", "application/rtf", "application/x-www-form-urlencoded"
    ));

    private final ConcurrentMap<String, Uri> sources = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, String> sharedText = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, String> mimeTypes = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, Boolean> writable = new ConcurrentHashMap<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile String pendingId;

    @Override
    public void load() {
        super.load();
        captureIntent(getActivity().getIntent());
    }

    @Override
    public void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        captureIntent(intent);
    }

    private void captureIntent(Intent intent) {
        if (intent == null) return;
        final String action = intent.getAction();
        if (!Intent.ACTION_VIEW.equals(action) && !Intent.ACTION_EDIT.equals(action)
            && !Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;

        Uri uri = intent.getData();
        if (uri == null) {
            try { uri = intent.getParcelableExtra(Intent.EXTRA_STREAM); } catch (Exception ignored) { }
        }
        if (uri == null && intent.getClipData() != null && intent.getClipData().getItemCount() > 0) {
            uri = intent.getClipData().getItemAt(0).getUri();
        }
        if (uri == null && (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action))) {
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (text != null && text.length() > 0) {
                String id = UUID.randomUUID().toString();
                sharedText.put(id, text.toString());
                mimeTypes.put(id, intent.getType() == null ? "text/plain" : intent.getType());
                pendingId = id;
                announce(id);
            }
            return;
        }
        if (uri == null) return;

        String id = UUID.randomUUID().toString();
        sources.put(id, uri);
        mimeTypes.put(id, intent.getType() == null ? "" : intent.getType());
        int flags = intent.getFlags();
        boolean canWrite = (flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != 0 || Intent.ACTION_EDIT.equals(action);
        if ("file".equalsIgnoreCase(uri.getScheme())) {
            // A file:// URI carries no provider grant. Only permit writes when
            // the sender explicitly used ACTION_EDIT or granted write access.
            try {
                File file = new File(uri.getPath());
                canWrite = canWrite && file.isFile() && file.canWrite();
            } catch (Exception ignored) { canWrite = false; }
        }
        writable.put(id, canWrite);
        // Persist only when the sender explicitly provided a persistable grant.
        if ((flags & Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0
            && (flags & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION)) != 0) {
            try {
                getContext().getContentResolver().takePersistableUriPermission(
                    uri, flags & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
            } catch (Exception ignored) { }
        }
        pendingId = id;
        announce(id);
    }

    private void announce(String id) {
        JSObject event = new JSObject();
        event.put("id", id);
        notifyListeners("incoming", event, true);
    }

    @PluginMethod
    public void pending(PluginCall call) {
        JSObject result = new JSObject();
        String id = pendingId;
        result.put("available", id != null);
        if (id != null) result.put("id", id);
        call.resolve(result);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String id = call.getString("id");
        if (id == null) { call.reject("Missing incoming-file id"); return; }
        worker.execute(() -> {
            try {
                if (id.equals(pendingId)) pendingId = null;
                JSObject result = describe(id);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Couldn't open the incoming file: " + error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void readText(PluginCall call) {
        String id = call.getString("id");
        if (id == null) { call.reject("Missing incoming-file id"); return; }
        worker.execute(() -> {
            try {
                String text = readTextSource(id);
                JSObject result = new JSObject();
                result.put("text", text);
                result.put("modified", modifiedTime(id));
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Couldn't re-read the incoming file: " + error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void writeText(PluginCall call) {
        String id = call.getString("id");
        String text = call.getString("text");
        if (id == null || text == null) { call.reject("Missing incoming-file id or text"); return; }
        if (!Boolean.TRUE.equals(writable.get(id))) { call.reject("This file was opened read-only"); return; }
        worker.execute(() -> {
            try {
                Uri uri = sources.get(id);
                if (uri == null) throw new IllegalStateException("The incoming source is no longer available");
                ContentResolver resolver = getContext().getContentResolver();
                byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > MAX_TEXT_BYTES) throw new IllegalStateException("Text documents are limited to 8 MiB in Satr");
                if ("file".equalsIgnoreCase(uri.getScheme())) {
                    File file = new File(uri.getPath());
                    try (OutputStream out = new FileOutputStream(file, false)) { out.write(bytes); }
                } else {
                    OutputStream out = resolver.openOutputStream(uri, "rwt");
                    if (out == null) throw new IllegalStateException("The file provider did not allow writing");
                    try (OutputStream closeable = out) { closeable.write(bytes); }
                }
                call.resolve();
            } catch (Exception error) {
                call.reject("Couldn't save back to the file manager's file: " + error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void openInOtherApp(PluginCall call) {
        String id = call.getString("id");
        Uri uri = id == null ? null : sources.get(id);
        if (uri == null) { call.reject("The incoming source is no longer available"); return; }
        try {
            String mime = mimeTypes.get(id);
            if (mime == null || mime.isEmpty()) mime = getContext().getContentResolver().getType(uri);
            if (mime == null || mime.isEmpty()) mime = "*/*";
            Uri launchUri = uri;
            if ("file".equalsIgnoreCase(uri.getScheme())) {
                File file = new File(uri.getPath());
                launchUri = FileProvider.getUriForFile(getContext(),
                    getContext().getPackageName() + ".fileprovider", file);
            }
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(launchUri, mime);
            int grantFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK;
            if (Boolean.TRUE.equals(writable.get(id))) grantFlags |= Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
            view.addFlags(grantFlags);
            view.setClipData(ClipData.newRawUri("Satr file", launchUri));
            Intent chooser = Intent.createChooser(view, "Open with another app");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                chooser.putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, new android.content.ComponentName[] {
                    new android.content.ComponentName(getContext(), MainActivity.class)
                });
            }
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception error) {
            call.reject("No other app could open this file: " + error.getMessage(), error);
        }
    }

    private JSObject describe(String id) throws Exception {
        String shared = sharedText.get(id);
        if (shared != null) {
            JSObject result = new JSObject();
            result.put("id", id);
            result.put("name", "Shared text");
            result.put("mimeType", mimeTypes.getOrDefault(id, "text/plain"));
            result.put("size", shared.getBytes(StandardCharsets.UTF_8).length);
            result.put("kind", "shared-text");
            result.put("readOnly", true);
            result.put("text", shared);
            return result;
        }

        Uri uri = sources.get(id);
        if (uri == null) throw new IllegalStateException("The incoming source is no longer available");
        String name = displayName(uri);
        String mime = mimeTypes.get(id);
        if (mime == null || mime.isEmpty()) mime = getContext().getContentResolver().getType(uri);
        if (mime == null || mime.isEmpty()) mime = mimeFromName(name);
        if (mime == null || mime.isEmpty()) mime = "application/octet-stream";
        long size = fileSize(uri);
        JSObject result = new JSObject();
        result.put("id", id);
        result.put("name", name);
        result.put("mimeType", mime);
        result.put("size", Math.max(0, size));
        result.put("readOnly", !Boolean.TRUE.equals(writable.get(id)));
        result.put("modified", modifiedTime(id));

        boolean textHint = looksTextByNameOrMime(name, mime);
        int readLimit = textHint ? MAX_TEXT_BYTES : MAX_PREVIEW_BYTES;
        byte[] bytes = readLimited(uri, readLimit);
        if (bytes == null) {
            result.put("kind", size > MAX_TEXT_BYTES ? "too-large" : "binary");
            return result;
        }

        String text = decodePlainText(bytes);
        if (textHint && text != null) {
            if (bytes.length > MAX_TEXT_BYTES) {
                result.put("kind", "too-large");
                return result;
            }
            result.put("kind", "text");
            result.put("text", text);
            return result;
        }

        result.put("kind", "binary");
        if (size >= 0 && size <= MAX_PREVIEW_BYTES && canInlinePreview(mime)) {
            String dataMime = mime;
            result.put("dataUrl", "data:" + dataMime + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP));
        }
        return result;
    }

    private String readTextSource(String id) throws Exception {
        String shared = sharedText.get(id);
        if (shared != null) return shared;
        Uri uri = sources.get(id);
        if (uri == null) throw new IllegalStateException("The incoming source is no longer available");
        String name = displayName(uri);
        String mime = mimeTypes.get(id);
        if (mime == null || mime.isEmpty()) mime = getContext().getContentResolver().getType(uri);
        if (!looksTextByNameOrMime(name, mime)) throw new IllegalStateException("The file is no longer a supported text document");
        byte[] bytes = readLimited(uri, MAX_TEXT_BYTES);
        if (bytes == null) throw new IllegalStateException("The file is too large to edit safely in Satr");
        String text = decodePlainText(bytes);
        if (text == null) throw new IllegalStateException("The file is no longer plain UTF-8 text");
        return text;
    }

    private byte[] readLimited(Uri uri, int limit) throws Exception {
        InputStream input = getContext().getContentResolver().openInputStream(uri);
        if (input == null) throw new IllegalStateException("The file provider returned no data");
        try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream(Math.min(limit, 32768))) {
            byte[] buffer = new byte[16384];
            int total = 0;
            int read;
            while ((read = in.read(buffer)) != -1) {
                total += read;
                if (total > limit) return null;
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }

    private String decodePlainText(byte[] bytes) {
        for (byte value : bytes) if (value == 0) return null;
        try {
            String text = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes)).toString();
            int controls = 0;
            for (int i = 0; i < text.length(); i++) {
                char c = text.charAt(i);
                if (c < 0x20 && c != '\n' && c != '\r' && c != '\t' && c != '\f' && c != '\b') controls += 1;
            }
            if (text.length() > 0 && controls * 100 > text.length()) return null;
            return text;
        } catch (CharacterCodingException error) {
            return null;
        }
    }

    private boolean looksTextByNameOrMime(String name, String mime) {
        String normalizedMime = mime == null ? "" : mime.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        if (normalizedMime.startsWith("text/") || TEXT_MIME_TYPES.contains(normalizedMime)) return true;
        String ext = extension(name);
        return TEXT_EXTENSIONS.contains(ext.toLowerCase(Locale.ROOT));
    }

    private boolean canInlinePreview(String mime) {
        return mime != null && (mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/") || "application/pdf".equalsIgnoreCase(mime));
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) {
                    String value = cursor.getString(column);
                    if (value != null && !value.trim().isEmpty()) return value;
                }
            }
        } catch (Exception ignored) { }
        String last = uri.getLastPathSegment();
        return last == null || last.isEmpty() ? "Incoming file" : Uri.decode(last);
    }

    private long fileSize(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.SIZE }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (column >= 0 && !cursor.isNull(column)) return cursor.getLong(column);
            }
        } catch (Exception ignored) { }
        if ("file".equalsIgnoreCase(uri.getScheme())) {
            try { return new File(uri.getPath()).length(); } catch (Exception ignored) { }
        }
        return -1;
    }

    private long modifiedTime(String id) {
        Uri uri = sources.get(id);
        if (uri == null) return 0;
        if ("file".equalsIgnoreCase(uri.getScheme())) {
            try { return new File(uri.getPath()).lastModified(); } catch (Exception ignored) { }
        }
        try {
            String column = "last_modified";
            try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { column }, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int index = cursor.getColumnIndex(column);
                    if (index >= 0 && !cursor.isNull(index)) return cursor.getLong(index) * 1000L;
                }
            }
        } catch (Exception ignored) { }
        return 0;
    }

    private String mimeFromName(String name) {
        String ext = extension(name);
        if (ext.isEmpty()) return null;
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase(Locale.ROOT));
    }

    private String extension(String name) {
        int dot = name == null ? -1 : name.lastIndexOf('.');
        return dot > 0 && dot + 1 < name.length() ? name.substring(dot + 1) : "";
    }
}
