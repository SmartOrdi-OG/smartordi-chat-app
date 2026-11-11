import { useEffect, useRef, useState } from 'react';

// Tiny pub-sub so showToast() can be called from anywhere (modals, data
// helpers) without prop-drilling a callback down through every view --
// mirrors secretary.html's own global showToast() function ergonomically.
let listener = null;

export function showToast(message, type) {
  if (listener) listener({ message, type: type || 'success', key: Date.now() });
}

export function useToastState() {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);
  useEffect(() => {
    listener = (t) => {
      clearTimeout(timerRef.current);
      setToast(t);
      timerRef.current = setTimeout(() => setToast(null), 3200);
    };
    return () => {
      listener = null;
      clearTimeout(timerRef.current);
    };
  }, []);
  return toast;
}
