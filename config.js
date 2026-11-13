// Connection to the live database (Supabase).
// Leave both empty to run in preview mode (data saved in the browser only).
//
// These two values are meant to be public: they ship to every visitor's
// browser. What people can actually do is controlled by the database's
// security rules (supabase/schema.sql). Never put the "secret" or
// "service_role" key here.
window.TH_CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
};
