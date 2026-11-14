package com.msadrashakouri.satr;

import android.os.Environment;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "SatrImageWrite")
public class ImageWritePlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ImageWriteStore store = new ImageWriteStore(path -> AndroidTarget.create(getContext().getCacheDir(), path));
    private volatile boolean destroyed;

    /** Keep bridge transfers in private cache. The final path is only created
     * once every chunk has arrived; an interrupted transfer or normal cancel
     * never touches shared storage. Publication uses exclusive creation, and
     * never unlinks a shared pathname that another app might have replaced. */
    private static final class AndroidTarget implements ImageWriteStore.Target {
        final File path, staging;
        final FileOutputStream stream;
        boolean closed;
        AndroidTarget(File path, File staging, FileOutputStream stream) { this.path=path; this.staging=staging; this.stream=stream; }
        static AndroidTarget create(File cache, File path) throws IOException {
            File folder=new File(cache,"image-write-staging");
            if (!folder.isDirectory() && !folder.mkdirs() && !folder.isDirectory()) throw new IOException("Could not prepare image");
            // Remove abandoned private transfers, but never recent sessions.
            File[] older=folder.listFiles(); long cutoff=System.currentTimeMillis()-24L*60*60*1000;
            if (older!=null) for (File file : older) {
                if (file.getName().startsWith("satr-image-") && file.getName().endsWith(".part") && file.isFile() && file.lastModified()<cutoff) file.delete();
            }
            // Private, app-owned temporary files, not the camera/gallery.
            File staging=File.createTempFile("satr-image-", ".part", folder);
            try { return new AndroidTarget(path,staging,new FileOutputStream(staging)); }
            catch (IOException e) { staging.delete(); throw e; }
        }
        private static boolean ownsPath(File path,FileDescriptor fd) throws IOException {
            try {
                StructStat open=Os.fstat(fd),atPath=Os.lstat(path.getPath());
                return open.st_dev==atPath.st_dev && open.st_ino==atPath.st_ino;
            } catch (ErrnoException e) {
                if (e.errno==OsConstants.ENOENT) return false;
                throw new IOException("Could not check image",e);
            }
        }
        @Override public void append(byte[] bytes) throws IOException { stream.write(bytes); }
        @Override public void finish() throws IOException {
            if (!closed) { stream.flush(); stream.getFD().sync(); stream.close(); closed=true; }
            FileDescriptor fd;
            try { fd=Os.open(path.getPath(),OsConstants.O_WRONLY|OsConstants.O_CREAT|OsConstants.O_EXCL|OsConstants.O_NOFOLLOW,0666); }
            catch (ErrnoException e) {
                if (e.errno==OsConstants.EEXIST) throw new ImageWriteStore.Exists();
                throw new IOException("Could not create image",e);
            }
            // If I/O fails after exclusive creation, leave the incomplete path
            // for the user rather than risk deleting somebody else's replacement.
            try (FileOutputStream output=new FileOutputStream(fd); FileInputStream input=new FileInputStream(staging)) {
                byte[] buffer=new byte[ImageWriteStore.MAX_CHUNK]; int n;
                while ((n=input.read(buffer))!=-1) output.write(buffer,0,n);
                output.flush(); fd.sync();
                if (!ownsPath(path,fd)) throw new IOException("Image destination changed during writing");
            } catch (IOException e) {
                throw new IOException("Could not finish image; an incomplete file may remain at "+path.getPath(),e);
            }
            // If deletion fails, Android may clear this private cache later.
            staging.delete();
        }
        @Override public void abort() throws IOException {
            IOException failure=null;
            if (!closed) { try { stream.close(); } catch(IOException e) { failure=e; } closed=true; }
            if (staging.exists() && !staging.delete() && failure==null) failure=new IOException("Could not remove temporary image");
            if (failure!=null) throw failure;
        }
    }
    @PluginMethod public void begin(PluginCall call) {
        final String path = call.getString("path"); final Long size = call.getLong("size"); final String kind = call.getString("kind");
        if (size == null) { call.reject("Image size is required", "IMAGE_WRITE_ERROR"); return; }
        worker.execute(() -> {
            try {
                if (destroyed) throw new IOException("Closing");
                String token = store.begin(Environment.getExternalStorageDirectory(), path, size, kind == null ? "image" : kind);
                if (destroyed) { store.abort(token); throw new IOException("Closing"); }
                JSObject result = new JSObject(); result.put("token", token); call.resolve(result);
            } catch (ImageWriteStore.Exists e) { call.reject(e.getMessage(), "IMAGE_EXISTS"); }
            catch (Exception e) { call.reject("Could not create image", "IMAGE_WRITE_ERROR", e); }
        });
    }
    @PluginMethod public void append(PluginCall call) {
        final String token = call.getString("token"), encoded = call.getString("data");
        worker.execute(() -> {
            try {
                if (destroyed || encoded == null || encoded.length() > ((ImageWriteStore.MAX_CHUNK + 2) / 3) * 4) throw new IOException("Invalid image chunk");
                store.append(token, Base64.decode(encoded, Base64.NO_WRAP)); call.resolve();
            } catch (Exception e) { call.reject("Could not write image", "IMAGE_WRITE_ERROR", e); }
        });
    }
    @PluginMethod public void finish(PluginCall call) {
        final String token = call.getString("token");
        worker.execute(() -> {
            try { if (destroyed) throw new IOException("Closing"); store.finish(token); call.resolve(); }
            catch (ImageWriteStore.Exists e) { call.reject(e.getMessage(), "IMAGE_EXISTS"); }
            catch (Exception e) { call.reject(e.getMessage() == null ? "Could not finish image" : e.getMessage(), "IMAGE_WRITE_ERROR", e); }
        });
    }
    @PluginMethod public void abort(PluginCall call) {
        final String token = call.getString("token");
        worker.execute(() -> {
            try { store.abort(token); call.resolve(); }
            catch (Exception e) { call.reject("Could not remove incomplete image", "IMAGE_CLEANUP_ERROR", e); }
        });
    }
    @Override protected void handleOnDestroy() {
        destroyed = true;
        // The UI thread must not wait for a slow filesystem copy to finish.
        worker.execute(store::close);
        worker.shutdown();
    }
}
