// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = 'https://dimemhvikpbmbmsntsdy.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpbWVtaHZpa3BibWJtc250c2R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4MDIyNjYsImV4cCI6MjA5MjM3ODI2Nn0.cFroohPIQIdzzPh3FfmDTC3uBGKV5aD1XtLKbd3M7RU'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)