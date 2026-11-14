package com.msadrashakouri.satr;

import java.util.LinkedHashSet;

/** Ignore delayed focus messages, including messages from an old page after a
 * reload. This state is changed on the UI thread and read by the IME thread. */
final class ImagePasteFocus {
    private String session="";
    private long sequence;
    private final LinkedHashSet<String> retired=new LinkedHashSet<>();
    private volatile boolean enabled;
    boolean enabled(){return enabled;}
    /** True only when the effective state changed and IME info needs refresh. */
    boolean update(String next,long order,boolean value){
        if(!session.equals(next)){
            if(retired.contains(next))return false;
            if(!session.isEmpty())retired.add(session);
            while(retired.size()>8)retired.remove(retired.iterator().next());
            session=next;sequence=0;
        }
        if(order<=sequence)return false;sequence=order;
        if(enabled==value)return false;enabled=value;return true;
    }
}
