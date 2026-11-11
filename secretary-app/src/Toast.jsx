import { useToastState } from './lib/toast';

export default function Toast() {
  const toast = useToastState();
  return (
    <div className={`toast ${toast ? 'show' : ''} ${toast && toast.type === 'error' ? 'error' : ''}`}>
      {toast ? toast.message : ''}
    </div>
  );
}
