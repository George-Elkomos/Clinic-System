// Shared class strings for the auth-flow pages (login/register/forgot/reset/
// must-change password) so the input/link treatment can't drift between them
// as it's tweaked over time — every page that touched its own local copy of
// this exact string has needed the same edit at least twice already.
export const AUTH_INPUT_CLASS =
  'w-full h-12 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 text-slate-800 text-sm font-medium placeholder:text-slate-400 outline-none focus:outline-none focus:bg-white focus:ring-4 focus:ring-[#0D9488]/15 focus:border-[#0D9488] shadow-sm focus:shadow-md transition-all duration-200'

export const AUTH_LINK_CLASS =
  'text-xs sm:text-sm font-semibold text-[#0D9488] hover:underline transition-all block text-center'
