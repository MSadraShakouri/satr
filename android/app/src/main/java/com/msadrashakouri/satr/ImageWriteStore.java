package com.msadrashakouri.satr;

import java.io.Closeable;
import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** A bounded, short-lived capability to create a new image without ever
 * opening an existing file for writing. The platform supplies an exclusive
 * target; bytes come over the bridge in small chunks, not one base64 photo. */
final class ImageWriteStore implements Closeable {
    static final int MAX_CHUNK = 192 * 1024;
    private static final int MAX_HANDLES = 4;
    interface Target {
        void append(byte[] bytes) throws IOException;
        void finish() throws IOException;
        void abort() throws IOException;
    }
    interface TargetFactory { Target createExclusive(File path) throws IOException; }
    static final class Exists extends IOException {
        Exists() { super("An image with that name already exists"); }
    }
    private static final class Session {
        final Target target; final long size; long written;
        Session(Target target, long size) { this.target = target; this.size = size; }
    }
    private final Map<String, Session> sessions = new HashMap<>();
    private final TargetFactory factory;
    private boolean closed;
    ImageWriteStore(TargetFactory factory) { this.factory = factory; }

    static File destination(File root, String path, String kind) throws IOException {
        if (path == null || path.isEmpty() || path.startsWith("/") || path.indexOf('\0') >= 0 || path.indexOf('\\') >= 0) throw new IOException("Invalid image path");
        String[] parts = path.split("/", -1);
        for (String part : parts) if (part.isEmpty() || part.equals(".") || part.equals("..")) throw new IOException("Invalid image path");
        String filename = parts[parts.length - 1].toLowerCase(java.util.Locale.ROOT);
        if ("backup".equals(kind)) {
            if (!filename.matches("satr recovery [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.md")) throw new IOException("Invalid recovery path");
        } else if ("image".equals(kind)) {
            if (parts.length < 2 || !"res".equals(parts[parts.length - 2])) throw new IOException("Images must be inside a res folder");
            if (!(filename.endsWith(".jpg") || filename.endsWith(".jpeg") || filename.endsWith(".png") || filename.endsWith(".webp"))) throw new IOException("Unsupported image format");
        } else throw new IOException("Invalid write kind");
        File base = root.getCanonicalFile(), candidate = new File(base, path);
        File parent = candidate.getParentFile();
        if (parent == null) throw new IOException("Invalid image folder");
        File resolvedParent = parent.getCanonicalFile();
        // Refuse a static symlink in any parent; the shared-storage path must
        // mean the same folder we validated, not an alias into another tree.
        if (!resolvedParent.equals(parent.getAbsoluteFile())) throw new IOException("Image folder is a symlink");
        if (!resolvedParent.equals(base) && !resolvedParent.getPath().startsWith(base.getPath() + File.separator)) throw new IOException("Invalid image folder");
        if (!resolvedParent.isDirectory() && !resolvedParent.mkdirs() && !resolvedParent.isDirectory()) throw new IOException("Could not create image folder");
        resolvedParent = parent.getCanonicalFile();
        if (!resolvedParent.equals(parent.getAbsoluteFile())) throw new IOException("Image folder is a symlink");
        if (!resolvedParent.equals(base) && !resolvedParent.getPath().startsWith(base.getPath() + File.separator)) throw new IOException("Invalid image folder");
        // Never canonicalize the final name: O_EXCL/O_NOFOLLOW must see an
        // existing or dangling symlink as a collision, not follow it.
        return new File(resolvedParent, parts[parts.length - 1]);
    }
    synchronized String begin(File root, String path, long size) throws IOException { return begin(root,path,size,"image"); }
    synchronized String begin(File root, String path, long size, String kind) throws IOException {
        if (closed || sessions.size() >= MAX_HANDLES || size <= 0) throw new IOException("Cannot begin image write");
        File destination = destination(root, path, kind);
        Target target = factory.createExclusive(destination);
        String token = UUID.randomUUID().toString();
        sessions.put(token, new Session(target, size));
        return token;
    }
    synchronized void append(String token, byte[] bytes) throws IOException {
        Session session = sessions.get(token);
        if (session == null || bytes == null || bytes.length == 0 || bytes.length > MAX_CHUNK || bytes.length > session.size - session.written) throw new IOException("Invalid image chunk");
        session.target.append(bytes);
        session.written += bytes.length;
    }
    synchronized void finish(String token) throws IOException {
        Session session = sessions.get(token);
        if (session == null || session.written != session.size) throw new IOException("Incomplete image write");
        session.target.finish();
        sessions.remove(token);
    }
    synchronized void abort(String token) throws IOException {
        Session session = sessions.remove(token);
        if (session != null) session.target.abort();
    }
    @Override public synchronized void close() {
        closed = true;
        for (Session session : sessions.values()) try { session.target.abort(); } catch (IOException ignored) { }
        sessions.clear();
    }
}
