package com.msadrashakouri.satr;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Set;
import java.util.Map;
import java.util.UUID;

/** Short-lived single-use capabilities for image bytes offered by the IME.
 * Nothing is copied to the vault or the gallery before the editor saves it. */
final class ImagePasteStore implements AutoCloseable {
    static final long MAX_BYTES = 64L * 1024 * 1024;
    static final int MAX_PENDING = 4;
    interface Source { InputStream open() throws IOException; void release(); }
    static final class Opened { final InputStream input; final String type; Opened(InputStream in, String t){input=in;type=t;} }
    private static final class Entry { final Source source; final String type; Entry(Source s,String t){source=s;type=t;} }
    private final Map<String,Entry> pending=new HashMap<>();
    private final Set<Limited> active=new HashSet<>();
    private boolean closed;
    synchronized String offer(Source source,String type) throws IOException {
        if(closed || pending.size()>=MAX_PENDING) throw new IOException("Too many pending images");
        String token=UUID.randomUUID().toString().replace("-", "");pending.put(token,new Entry(source,type));return token;
    }
    void discard(String token) { Entry entry; synchronized(this){entry=pending.remove(token);} if(entry!=null)entry.source.release(); }
    Opened take(String token) throws IOException {
        Entry entry; synchronized(this){entry=pending.remove(token);}
        if(entry==null)throw new IOException("Image paste expired");
        try {
            InputStream input=entry.source.open();if(input==null)throw new IOException("Could not read pasted image");
            Limited limited=new Limited(input,entry.source);boolean accepted;
            synchronized(this){accepted=!closed;if(accepted)active.add(limited);}
            if(!accepted){try{input.close();}catch(IOException ignored){}throw new IOException("Image paste closed");}
            return new Opened(limited,entry.type);
        } catch(IOException|RuntimeException e){entry.source.release();throw e;}
    }
    @Override public void close(){
        Map<String,Entry> old;Set<Limited> streams;
        synchronized(this){closed=true;old=new HashMap<>(pending);pending.clear();streams=new HashSet<>(active);}
        for(Entry e:old.values())e.source.release();for(Limited stream:streams)try{stream.close();}catch(IOException ignored){}
    }
    private final class Limited extends FilterInputStream {
        final Source source; long count; boolean streamClosed,ended;
        Limited(InputStream in,Source source){super(in);this.source=source;}
        @Override public int read() throws IOException {
            if(ended)return -1;
            try{int value=in.read();if(value==-1){ended=true;close();return -1;}if(++count>MAX_BYTES)throw new IOException("Pasted image is too large");return value;}
            catch(IOException e){try{close();}catch(IOException ignored){}throw e;}
        }
        @Override public int read(byte[] bytes,int offset,int length) throws IOException {
            if(length==0)return 0;if(ended)return -1;
            try{int allowed=(int)Math.min(length,MAX_BYTES-count+1);int n=in.read(bytes,offset,allowed);
                if(n==-1){ended=true;close();return -1;}
                if(n>0){count+=n;if(count>MAX_BYTES)throw new IOException("Pasted image is too large");}return n;}
            catch(IOException e){try{close();}catch(IOException ignored){}throw e;}
        }
        @Override public void close() throws IOException {
            synchronized(this){if(streamClosed)return;streamClosed=true;}
            synchronized(ImagePasteStore.this){active.remove(this);}
            try{super.close();}finally{source.release();}
        }
    }
}
