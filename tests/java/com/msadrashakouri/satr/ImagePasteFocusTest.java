package com.msadrashakouri.satr;
public final class ImagePasteFocusTest {
    private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    public static void main(String[]args){
        ImagePasteFocus focus=new ImagePasteFocus();
        check(focus.update("old",1,true) && focus.enabled(),"focus enables");
        check(!focus.update("old",1,false) && focus.enabled(),"duplicate ignored");
        check(focus.update("old",3,false) && !focus.enabled(),"blur disables");
        check(!focus.update("old",2,true) && !focus.enabled(),"out of order ignored");
        check(focus.update("new",1,true) && focus.enabled(),"reload starts new sequence");
        check(!focus.update("old",4,false) && focus.enabled(),"retired page ignored");
        check(focus.update("new",2,false) && !focus.enabled(),"new page blur");
        System.out.println("ImagePasteFocus: all JVM checks passed");
    }
}
