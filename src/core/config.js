// config.js — paste your Supabase project details here to switch on cloud
// saving + accounts. Find them in your Supabase dashboard:
//   Project Settings → API → Project URL, and the public "anon" key.
// Leave blank to keep the planner fully offline (local save only).

export const SUPABASE_URL = 'https://quzjzgllwjrkynapeuzi.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1emp6Z2xsd2pya3luYXBldXppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0ODM3NjUsImV4cCI6MjA5ODA1OTc2NX0.vxd1HagpvVDh2qHY6JDrDI4O-1N7F-JAV48Af0gEU6Y';

export const cloudEnabled = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Where the "Book a free order check" button sends customers — the contact
// form on the site. Swap for a Calendly / HubSpot Meetings URL when there is
// one (leave blank to fall back to an email instead).
export const BOOKING_URL = 'https://plinthmade.com/contact/';
