import { createClient } from '@supabase/supabase-js';

// Same project/anon key as the rest of the app (vendor/staff-accounts.js),
// mirroring patient-app/src/lib/supabase.js.
const SUPABASE_URL = 'https://ewilgwndhpxibkogxqbk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3aWxnd25kaHB4aWJrb2d4cWJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NjEyMjUsImV4cCI6MjA5OTUzNzIyNX0.hZeILrp_GmOzZUImEtWhdbURLqDcvr5kB8KbhLPZvVM';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
