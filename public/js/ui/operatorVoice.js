// Local listening preference, shared by roster and DIY details; deliberately absent from room.loadout.
import { html, Modal, Button, MicroLabel, TextField } from './components.js';
import { data } from '../data.js';
import { useSettings, updateSettings } from './settings.js';
import { t } from '../../../shared/i18n.js';
import { useState } from '../../vendor/hooks.module.js';

// Each whole dub is named in its own language, the way the settings row names them (ui/settings.js VOICE_LANG_NAMES).
const DUB_NAMES = { cn: '中文', jp: '日本語', en: 'English', kr: '한국어' }; // i18n-ignore
const DUB_TREES = { jp: 'voiceJp', en: 'voiceEn', kr: 'voiceKr' };
// The special voices, named by the language they are in (the official voiceLangTypeDict names, translated).
const SPECIAL_LABELS = { cn_topolect: '中文-方言', ita: '意大利语', ger: '德文', rus: '俄文', fre: '法语', spa: '西班牙语', linkage: '联动' }; // i18n-ignore (these keys are the msgids t() looks up)

/**
 * What this operator can actually be set to: the whole dubs the manifest carries for it (中文 is always there), then its
 * own special voices (audio.voiceSpecial[charId][type] — only some operators have one). The settings' per-operator
 * picker and the 逐个设置 window both read this, so neither offers a choice that would play nothing.
 * @param {string} charId
 * @returns {{ id: string, label: string }[]}
 */
export function voiceOptions(charId, audio = data.get('assets')?.audio) {
  const out = [];
  for (const id of ['cn', 'jp', 'en', 'kr']) {
    if (id === 'cn' || audio?.[DUB_TREES[id]]?.[charId]) out.push({ id, label: DUB_NAMES[id] });
  }
  for (const [type, slots] of Object.entries(audio?.voiceSpecial?.[charId] || {})) {
    if (slots && Object.keys(slots).length) out.push({ id: type, label: t(SPECIAL_LABELS[type] || type) });
  }
  return out;
}

export function OperatorVoice({ charId }) {
  const settings = useSettings();
  if (!charId) return null;
  const value = settings.voiceOverrides[charId] || '';
  const change = (lang) => {
    const voiceOverrides = { ...settings.voiceOverrides };
    if (lang) voiceOverrides[charId] = lang;
    else delete voiceOverrides[charId];
    updateSettings({ voiceOverrides });
  };
  return html`<label class="lo-voice" data-voice-char=${charId}>
    <span>${t('此干员语音')}</span>
    <span class="lo-select"><select aria-label=${t('此干员语音')} value=${value} onChange=${(e) => change(e.currentTarget.value)}>
      <option value="">${t('跟随全局')}</option>
      ${voiceOptions(charId).map((o) => html`<option key=${o.id} value=${o.id}>${o.label}</option>`)}
    </select></span>
    <small>${t('仅保存在此浏览器，缺失的语音会回退到中文。')}</small>
  </label>`;
}

/** The charIds any voice tree carries (the Chinese base, the jp / en / kr dubs, and the special voices). */
function voicedCharIds() {
  const a = data.get('assets')?.audio;
  const out = new Set();
  for (const table of [a?.voice, a?.voiceJp, a?.voiceEn, a?.voiceKr]) for (const id of Object.keys(table || {})) out.add(id);
  for (const [id, types] of Object.entries(a?.voiceSpecial || {})) if (types && Object.keys(types).length) out.add(id);
  return out;
}

/**
 * The operators THIS MODE can field that have official voice lines, as { id, name } sorted by name.
 *
 * The pool is the roster (data.get('chess') — the id → record map) plus the stand-in bodies
 * (data.get('backups').units — the 预备干员 / 替补 / 自选 operators, keyed by charId), intersected with the voice
 * tables: an operator the mode cannot field has no voice to choose here, and one without voice lines is not listed.
 * Both load with a match, so this is empty on the title screen (the caller then hides the row).
 */
export function voicedOperators() {
  const voiced = voicedCharIds();
  const out = new Map();
  const add = (id, name) => { if (id && name && voiced.has(id) && !out.has(id)) out.set(id, name); };
  const raw = data.get('chess');
  for (const c of (Array.isArray(raw) ? raw : Object.values(raw || {}))) add(c && (c.charId || c.chessId), c && c.name);
  for (const u of Object.values(data.get('backups')?.units || {})) add(u && (u.charId || u.id), u && u.name);
  return [...out].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name, 'zh'));
}

/**
 * The settings row's 「逐个设置」 window: every operator this mode can field, one OperatorVoice select each, searchable.
 * Reuses OperatorVoice, so a row here behaves exactly like the one on the 调配 / 自选 pages (same settings.voiceOverrides).
 */
export function OperatorVoiceRow() {
  const [open, setOpen] = useState(false);
  const settings = useSettings();          // hooks first: the count below must not call it inside a callback
  const all = voicedOperators();
  if (!all.length) return null;            // nothing to configure (the roster loads with a match)
  const count = Object.keys(settings.voiceOverrides || {}).length;
  return html`<div class="set-row">
    <span class="set-row__label">${t('干员语音')}<${MicroLabel}>OPERATOR VOICE<//></span>
    <${Button} size="sm" variant="ghost" onClick=${() => setOpen(true)} data-testid="voice-list-open">
      ${t('逐个设置')}${count ? ` (${count})` : ''}
    <//>
    <${OperatorVoiceList} open=${open} onClose=${() => setOpen(false)} />
  </div>`;
}

/** The 「逐个设置」 window itself. */
export function OperatorVoiceList({ open, onClose }) {
  const settings = useSettings();
  const [q, setQ] = useState('');
  const all = voicedOperators();
  const overrides = settings.voiceOverrides || {};
  const query = q.trim().toLowerCase();
  let shown = all;
  if (query) shown = shown.filter((o) => o.name.toLowerCase().includes(query) || o.id.toLowerCase().includes(query));
  const resetAll = () => updateSettings({ voiceOverrides: {} });
  return html`<${Modal} open=${open} onClose=${onClose} title=${t('干员语音')} micro="OPERATOR VOICE" width="6.6rem"
    class="ov-modal"
    actions=${html`<${Button} variant="primary" icon="check" onClick=${onClose}>${t('完成')}<//>`}>
    <div class="set-row set-row--search">
      <${TextField} size="sm" icon="search" value=${q} placeholder=${t('搜索干员')} class="ov-search" onInput=${setQ} />
    </div>
    <p class="set-hint">${t('默认语音语言')} · ${DUB_NAMES[settings.voiceLang] || settings.voiceLang}
      ${Object.keys(overrides).length ? html` · <${Button} size="sm" variant="ghost" onClick=${resetAll} data-testid="voice-list-reset">${t('全部恢复默认')}<//>` : null}</p>
    <div class="ov-list" data-testid="voice-list">
      ${shown.length === 0 ? html`<p class="set-hint">${t('没有匹配的干员')}</p>` : null}
      ${shown.map((o) => html`<div key=${o.id} class="ov-row" data-char=${o.id}>
        <span class="ov-row__name">${o.name}</span>
        <${OperatorVoice} charId=${o.id} />
      </div>`)}
    </div>
  <//>`;
}
