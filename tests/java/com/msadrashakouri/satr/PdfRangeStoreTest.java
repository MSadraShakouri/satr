package com.msadrashakouri.satr;

import java.io.File;
import java.io.FileInputStream;
import java.nio.file.Files;
import java.util.Arrays;

public final class PdfRangeStoreTest {
    interface Check { void run() throws Exception; }
    static void fails(Check check) throws Exception {
        try { check.run(); throw new AssertionError("Expected failure"); }
        catch (java.io.IOException expected) { }
    }
    public static void main(String[] args) throws Exception {
        File dir = Files.createTempDirectory("satr-ranges").toFile();
        File file = new File(dir, "book.pdf");
        byte[] data = new byte[1000];
        for (int i = 0; i < data.length; i++) data[i] = (byte) i;
        Files.write(file.toPath(), data);
        if (!PdfRangeStore.vaultFile(dir, "book.pdf").equals(file.getCanonicalFile())) throw new AssertionError("valid path");
        fails(() -> PdfRangeStore.vaultFile(dir, "../outside"));
        fails(() -> PdfRangeStore.vaultFile(dir, "/etc/passwd"));
        File link = new File(dir, "link");
        Files.createSymbolicLink(link.toPath(), new File("/etc/passwd").toPath());
        fails(() -> PdfRangeStore.vaultFile(dir, "link"));
        PdfRangeStore store = new PdfRangeStore();
        FileInputStream in = new FileInputStream(file);
        PdfRangeStore.Opened opened = store.add(in.getChannel(), in, 0, file.length(), file, null);
        if (!Arrays.equals(store.read(opened.token, 23, 100), Arrays.copyOfRange(data, 23, 123))) throw new AssertionError("range");
        fails(() -> store.read("bad", 0, 1));
        fails(() -> store.read(opened.token, -1, 1));
        fails(() -> store.read(opened.token, 999, 2));
        fails(() -> store.read(opened.token, 0, PdfRangeStore.MAX_RANGE + 1));
        Files.write(file.toPath(), new byte[]{1});
        fails(() -> store.read(opened.token, 0, 1));
        store.close(opened.token);
        fails(() -> store.read(opened.token, 0, 1));
        Files.write(file.toPath(), data);
        FileInputStream second = new FileInputStream(file);
        PdfRangeStore.Opened subsection = store.add(second.getChannel(), second, 10, 500, null, null);
        if (!Arrays.equals(store.read(subsection.token, 0, 12), Arrays.copyOfRange(data, 10, 22))) throw new AssertionError("asset offset");
        File temp = new File(dir, "cached.tmp");
        Files.write(temp.toPath(), data);
        FileInputStream tempStream = new FileInputStream(temp);
        PdfRangeStore.Opened cached = store.add(tempStream.getChannel(), tempStream, 0, temp.length(), temp, temp);
        store.close(cached.token);
        if (temp.exists()) throw new AssertionError("temporary source is removed on close");
        store.close();
        fails(() -> store.read(subsection.token, 0, 1));
        try (FileInputStream closed = new FileInputStream(file)) {
            fails(() -> store.add(closed.getChannel(), closed, 0, 1, null, null));
        }
        link.delete(); file.delete(); dir.delete();
        System.out.println("PdfRangeStoreTest passed");
    }
}
