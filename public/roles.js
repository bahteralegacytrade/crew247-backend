// Daftar peran / hashtag standar Crew247.id
// Dipakai bersama oleh profil-kru.html dan direktori.html
const ROLES = [
  { tag: 'FOH', label: 'FOH Audio Engineer' },
  { tag: 'Monitor', label: 'Monitor Engineer' },
  { tag: 'Lighting', label: 'Lighting Designer' },
  { tag: 'StageManager', label: 'Stage Manager' },
  { tag: 'Backline', label: 'Backline Tech' },
  { tag: 'VJ', label: 'VJ & LED Tech' },
  { tag: 'CrowdControl', label: 'Crowd Control' },
  { tag: 'TalentCoordinator', label: 'Talent Coordinator' },
  { tag: 'MC', label: 'MC / Host' },
  { tag: 'Rigger', label: 'Rigger' },
  { tag: 'StageCrew', label: 'Stage Crew / Runner' }
];

// Buang '#', spasi, dan simbol. "#Stage Manager" -> "StageManager"
function normTag(s) {
  return String(s || '').replace(/^#/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
}

// Samakan huruf besar/kecil dengan tag standar kalau cocok ("stagemanager" -> "StageManager")
function canonTag(s) {
  const n = normTag(s);
  const known = ROLES.find(r => r.tag.toLowerCase() === n.toLowerCase());
  return known ? known.tag : n;
}

function peranLabel(tag) {
  const r = ROLES.find(r => r.tag === tag);
  return r ? r.label : tag;
}

// Nama peran posisi (mis. "Stage Manager") -> hashtag ("StageManager"). Kosong kalau tidak dikenal.
function tagFromLabel(label) {
  const r = ROLES.find(r => r.label === label);
  return r ? r.tag : '';
}