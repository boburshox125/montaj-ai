'use strict';
/** Vositalarni xavf darajasiga ajratadi: read | write | danger | code */
const READ = /^(get_|list_|premiere_status$|describe_media$|transcribe_|export_frame$|contact_sheet$|gif_search$|stock_search$|sfx_search$|youtube_chapters$)/;
const SAFE = /^(backup_project|save_project|set_playhead|open_sequence|add_markers|beat_markers|qc_scan)$/;
const DANGER = /^(remove_|jump_cut$|smart_jump_cut$|cut_to_beat$|replace_text$|export_|organize_project$|razor$|build_rough_cut$|set_sequence_settings$)/;

function classify(entry, args = {}) {
  const n = entry.tool.name;
  if (entry.server.def.name !== 'premiere') {
    return entry.tool.annotations?.readOnlyHint === true ? 'read' : 'danger';
  }
  if (n === 'run_extendscript') return 'code';
  if (READ.test(n)) return 'read';
  if (SAFE.test(n)) return 'safe';
  if (n === 'smart_jump_cut' && args.preview !== false) return 'safe';
  if (n === 'jump_cut' && args.dryRun === true) return 'safe';
  if (n === 'find_filler_words') return args.apply === true ? 'danger' : 'safe';
  if (DANGER.test(n)) return 'danger';
  return 'write';
}

/** mode: auto | ask | plan  ->  allow | ask | deny */
function decide(mode, level) {
  if (level === 'read') return 'allow';
  if (mode === 'plan') return 'deny';
  if (level === 'code') return 'ask';
  if (mode === 'auto') return 'allow';
  return level === 'danger' ? 'ask' : 'allow';
}

module.exports = { classify, decide };
