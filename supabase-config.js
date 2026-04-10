// ============================================
// SUPABASE CLIENT - Trade Desk
// ============================================

const SUPABASE_URL = 'https://fzxjbxeadiqwfpctiyom.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6eGpieGVhZGlxd2ZwY3RpeW9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDUyNTQsImV4cCI6MjA5MDgyMTI1NH0.WpJjZrHgY33aydqpLyN-Jh9wrQmMLLVsb7lp41_y9Z0';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
