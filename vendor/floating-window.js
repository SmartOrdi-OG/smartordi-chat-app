// Shared floating-window drag/resize behavior -- makeFloatingWindowDraggable()/
// makeFloatingWindowResizable() used to be two byte-for-byte identical copies,
// one hand-kept in sync inside doctor.html (tuCalWindow, floatingChatWindow)
// and one inside secretary.html (secCalWindow, secFloatingChatWindow) -- each
// file's own copy carried a comment noting the duplication and asking future
// edits to keep both in sync manually. Pulled out into one real shared file
// instead, loaded by both pages, so there's only one copy to ever get out of
// sync in the first place.
//
// Lets a floating window be dragged by its header to anywhere on screen -- on
// request ("اعمل النافذة العائمة متحركة"), after a real report that a
// floating window (tuCalWindow) landed exactly on top of a button with no way
// to see/reach what was underneath it besides closing the whole window.
// Ignores a mousedown on the close button itself (that's a click, not a drag
// start). Desktop-only, matching the existing >768px pattern -- mobile goes
// fullscreen (inset:0) via CSS, where dragging has no meaning. Switches the
// window to explicit left/top positioning (clearing right/bottom) so it stays
// exactly where dropped, same technique each page's own *CalPositionWindow()/
// positionSecFloatingChatWindow() already use elsewhere.
//
// Real report + screenshot: dragging a width:auto/height:auto window
// (secFloatingChatWindow) at all made it "turn into weird sizes and shapes"
// with no way back except reloading the page. Root cause: that window (unlike
// tuCalWindow/secCalWindow) has NO fixed width/height in CSS -- it's sized
// entirely via top/right/bottom + width:auto/height:auto (right stays fixed
// so width grows/shrinks with the viewport). The instant a drag/resize
// cleared right/bottom to 'auto', width/height had nothing left to compute
// from and collapsed to the browser's intrinsic shrink-to-fit size. Both
// handlers below now lock in the window's current on-screen pixel width/
// height BEFORE switching to left/top positioning, so the size never has a
// chance to collapse -- harmless for a window that already had an explicit
// width/height (this just pins it to the same value it already had).
function makeFloatingWindowDraggable(win,header){
  if(!win||!header) return;
  header.addEventListener('mousedown',function(e){
    if(e.target.closest('.floating-chat-close')) return;
    if(window.innerWidth<=768) return;
    e.preventDefault();
    const rect=win.getBoundingClientRect();
    win.style.width=rect.width+'px';
    win.style.height=rect.height+'px';
    const offsetX=e.clientX-rect.left, offsetY=e.clientY-rect.top;
    function onMove(ev){
      let left=ev.clientX-offsetX, top=ev.clientY-offsetY;
      left=Math.max(0,Math.min(left,window.innerWidth-rect.width));
      top=Math.max(0,Math.min(top,window.innerHeight-rect.height));
      win.style.left=left+'px';
      win.style.top=top+'px';
      win.style.right='auto';
      win.style.bottom='auto';
    }
    function onUp(){
      document.removeEventListener('mousemove',onMove);
      document.removeEventListener('mouseup',onUp);
    }
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
  });
}
// A small grip in the bottom-right corner (injected here, not hand-placed in
// every window's markup) lets a floating window be resized like any desktop
// app window -- on request ("عايز يبقى ليها إمكانية تكبير و تصغير"). Same
// box-model fix as makeFloatingWindowDraggable() above: pins the window to
// explicit left/top/width/height the moment a resize starts, so a
// width:auto/height:auto window (*FloatingChatWindow) can't collapse mid-drag
// here either.
function makeFloatingWindowResizable(win){
  if(!win) return;
  const MIN_W=320,MIN_H=280;
  const handle=document.createElement('div');
  handle.className='floating-chat-resize-handle';
  handle.title='Größe ändern';
  win.appendChild(handle);
  handle.addEventListener('mousedown',function(e){
    if(window.innerWidth<=768) return;
    e.preventDefault();
    e.stopPropagation();
    const rect=win.getBoundingClientRect();
    win.style.left=rect.left+'px';
    win.style.top=rect.top+'px';
    win.style.right='auto';
    win.style.bottom='auto';
    const startX=e.clientX,startY=e.clientY,startW=rect.width,startH=rect.height;
    const maxW=window.innerWidth-rect.left-8,maxH=window.innerHeight-rect.top-8;
    function onMove(ev){
      win.style.width=Math.max(MIN_W,Math.min(startW+(ev.clientX-startX),maxW))+'px';
      win.style.height=Math.max(MIN_H,Math.min(startH+(ev.clientY-startY),maxH))+'px';
    }
    function onUp(){
      document.removeEventListener('mousemove',onMove);
      document.removeEventListener('mouseup',onUp);
    }
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
  });
}
