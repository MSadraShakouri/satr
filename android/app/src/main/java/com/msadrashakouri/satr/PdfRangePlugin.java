package com.msadrashakouri.satr;

import android.content.res.AssetFileDescriptor;
import android.net.Uri;
import android.os.Environment;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "SatrPdfRange")
public class PdfRangePlugin extends Plugin {
    private static final long DISK_RESERVE = 64L * 1024 * 1024;
    private static final long MAX_COPY = 256L * 1024 * 1024;
    private final PdfRangeStore store = new PdfRangeStore();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ConcurrentHashMap<String, AtomicBoolean> pending = new ConcurrentHashMap<>();
    private volatile boolean destroyed;

    @Override public void load() {
        super.load();
        // A previous process may have died before closing a copied provider.
        File dir = getContext().getCacheDir();
        File[] old = dir.listFiles((d, name) -> name.startsWith("satr-pdf-range-") && name.endsWith(".tmp"));
        if (old != null) for (File file : old) file.delete();
    }
    private JSObject result(PdfRangeStore.Opened opened) {
        JSObject result = new JSObject();
        result.put("token", opened.token); result.put("size", opened.size);
        result.put("url", getBridge().getScheme() + "://" + getBridge().getHost() + "/__satr_pdf_range/" + opened.token);
        return result;
    }
    @PluginMethod public void openVault(PluginCall call) {
        String path = call.getString("path");
        worker.execute(() -> {
            FileInputStream stream = null;
            try {
                File file = PdfRangeStore.vaultFile(Environment.getExternalStorageDirectory(), path);
                if (file.length() < 16L * 1024 * 1024) throw new IOException("Small PDF uses whole-file reads");
                stream = new FileInputStream(file);
                PdfRangeStore.Opened opened = store.add(stream.getChannel(), stream, 0, file.length(), file, null);
                stream = null;
                if (destroyed) { store.close(opened.token); throw new IOException("Closing"); }
                call.resolve(result(opened));
            } catch (Exception error) { call.reject("Cannot open vault PDF", error); }
            finally { if (stream != null) try { stream.close(); } catch (IOException ignored) { } }
        });
    }
    @PluginMethod public void openIncoming(PluginCall call) {
        String id = call.getString("id"), operation = call.getString("operation");
        if (operation == null || !operation.matches("[0-9a-f]{32}")) { call.reject("Invalid PDF operation"); return; }
        AtomicBoolean cancelled = new AtomicBoolean();
        if (pending.putIfAbsent(operation, cancelled) != null) { call.reject("Duplicate PDF operation"); return; }
        worker.execute(() -> {
            try {
                check(cancelled);
                PluginHandle handle = getBridge().getPlugin("SatrOpenFile");
                OpenFilePlugin plugin = handle == null ? null : (OpenFilePlugin) handle.getInstance();
                Uri uri = plugin == null || id == null ? null : plugin.uriForPdf(id);
                if (uri == null) throw new IOException("Incoming grant no longer available");
                PdfRangeStore.Opened opened;
                try { opened = openSeekable(uri); }
                catch (Exception notSeekable) { check(cancelled); opened = copyIncoming(uri, cancelled); }
                if (cancelled.get() || destroyed) { store.close(opened.token); throw new IOException("PDF open cancelled"); }
                call.resolve(result(opened));
            } catch (Exception error) { call.reject("Cannot open incoming PDF", error); }
            finally { pending.remove(operation, cancelled); }
        });
    }
    @PluginMethod public void cancelOpen(PluginCall call) {
        String id = call.getString("operation");
        AtomicBoolean cancelled = id == null ? null : pending.get(id);
        if (cancelled != null) cancelled.set(true);
        call.resolve();
    }
    private void check(AtomicBoolean cancelled) throws IOException {
        if (destroyed || cancelled.get() || Thread.currentThread().isInterrupted()) throw new IOException("PDF open cancelled");
    }
    private PdfRangeStore.Opened openSeekable(Uri uri) throws IOException {
        AssetFileDescriptor asset = getContext().getContentResolver().openAssetFileDescriptor(uri, "r");
        if (asset == null) throw new IOException("No provider descriptor");
        FileInputStream stream = null;
        try {
            stream = asset.createInputStream();
            long base = asset.getStartOffset(), size = asset.getLength();
            if (size < 0) size = stream.getChannel().size() - base;
            // AssetFileDescriptor.createInputStream owns its descriptor.
            PdfRangeStore.Opened opened = store.add(stream.getChannel(), stream, base, size, null, null);
            stream = null; asset = null;
            return opened;
        } finally {
            if (stream != null) try { stream.close(); } catch (IOException ignored) { }
            if (asset != null) try { asset.close(); } catch (IOException ignored) { }
        }
    }
    private PdfRangeStore.Opened copyIncoming(Uri uri, AtomicBoolean cancelled) throws IOException {
        File dir = getContext().getCacheDir();
        if (dir.getUsableSpace() < DISK_RESERVE) throw new IOException("Storage is low");
        File temp = File.createTempFile("satr-pdf-range-", ".tmp", dir);
        try {
            InputStream input = getContext().getContentResolver().openInputStream(uri);
            if (input == null) throw new IOException("No provider stream");
            try (InputStream in = input; FileOutputStream out = new FileOutputStream(temp)) {
                byte[] chunk = new byte[64 * 1024]; long total = 0; int count;
                while ((count = in.read(chunk)) != -1) {
                    check(cancelled);
                    if (count == 0) continue;
                    total += count;
                    if (total > MAX_COPY || dir.getUsableSpace() < DISK_RESERVE) throw new IOException("Incoming PDF exceeds cache limit or storage is low");
                    out.write(chunk, 0, count);
                }
            }
            check(cancelled);
            FileInputStream stream = new FileInputStream(temp);
            try { return store.add(stream.getChannel(), stream, 0, temp.length(), temp, temp); }
            catch (Exception error) { stream.close(); throw error; }
        } catch (Exception error) { temp.delete(); if (error instanceof IOException) throw (IOException) error; throw new IOException(error); }
    }
    @PluginMethod public void close(PluginCall call) { store.close(call.getString("token")); call.resolve(); }
    @Override protected void handleOnDestroy() {
        destroyed = true;
        for (AtomicBoolean cancelled : pending.values()) cancelled.set(true);
        worker.shutdownNow(); store.close();
    }
    /** Only this reserved same-origin endpoint is ours; everything else stays Capacitor's. */
    WebResourceResponse intercept(Bridge bridge, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!bridge.getScheme().equalsIgnoreCase(uri.getScheme()) || !bridge.getHost().equalsIgnoreCase(uri.getHost()) || uri.getPath() == null || !uri.getPath().startsWith("/__satr_pdf_range/")) return null;
        try {
            String destination = request.getRequestHeaders().get("Sec-Fetch-Dest");
            if (!"GET".equals(request.getMethod()) || request.isForMainFrame() || "document".equals(destination) || "iframe".equals(destination)) throw new IOException("Invalid request");
            String token = uri.getLastPathSegment();
            if (token == null || !uri.getPath().equals("/__satr_pdf_range/" + token) || !token.matches("[0-9a-f-]{36}")) throw new IOException("Invalid token");
            long offset = Long.parseLong(uri.getQueryParameter("offset"));
            int length = Integer.parseInt(uri.getQueryParameter("length"));
            byte[] bytes = store.read(token, offset, length);
            return new WebResourceResponse("application/octet-stream", null, 200, "OK", Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(bytes));
        } catch (Exception error) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(new byte[0]));
        }
    }
}
