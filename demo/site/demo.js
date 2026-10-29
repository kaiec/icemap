// The demo page around the ICE-Map component. The address holds the state:
// ?map=mesh|stw&view=…&focus=…&select=… (ids of the shown top concept and of the selected one).
import { IceMap } from './icemap.js';

const MAPS = {
  mesh: {
    views: {
      iic: { a: 'iic' },
      'manual-iic': { a: 'manual', b: 'iic' },
      'automated-iic': { a: 'automated', b: 'iic' },
      'automated-2021-manual': { a: 'automated-2021', b: 'manual' },
      'curated-automated': { a: 'curated', b: 'automated' },
    },
    link: id => id.startsWith('cat:') ? null : `https://meshb.nlm.nih.gov/record/ui?ui=${id}`,
  },
  stw: {
    views: {
      iic: { a: 'iic' },
      'econis-2023-iic': { a: 'econis-2023', b: 'iic' },
      'econis-2008-iic': { a: 'econis-2008', b: 'iic' },
      'econis-2023-econis-2008': { a: 'econis-2023', b: 'econis-2008' },
    },
    link: id => `https://zbw.eu/stw/${id}`,
  },
};

const params = new URLSearchParams(location.search);
const name = MAPS[params.get('map')] ? params.get('map') : 'mesh';
const cfg = MAPS[name];
let view = cfg.views[params.get('view')] ? params.get('view') : Object.keys(cfg.views)[1];

// show the parts of the page that belong to the chosen map
for (const t of document.querySelectorAll('[data-map]')) t.hidden = t.dataset.map !== name;
for (const a of document.querySelectorAll('.demo-tabs a')) {
  if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
}
const radios = [...document.querySelectorAll(`[data-map="${name}"] input[name="view-${name}"]`)];
radios.forEach(r => { r.checked = r.value === view; });

const el = document.getElementById('icemap');
let map;
function save() {
  if (!map) return;
  const s = map.state(), p = new URLSearchParams({ map: name, view });
  if (s.focus) p.set('focus', s.focus);
  if (s.select) p.set('select', s.select);
  try { history.replaceState(null, '', `?${p}`); } catch { /* not allowed where the page is embedded */ }
}

try {
  map = await IceMap.open(el, {
    src: `${name}/`, colour: cfg.views[view], link: cfg.link, onChange: save,
    focus: params.get('focus') || undefined, select: params.get('select') || undefined,
  });
  el.removeAttribute('aria-busy');
  radios.forEach(r => r.addEventListener('change', async () => {
    if (!r.checked) return;
    view = r.value;
    await map.setColour(cfg.views[view]);
    save();
  }));
  // a link inside the text that selects a concept: <a data-show="id" data-view="…">
  document.addEventListener('click', async e => {
    const a = e.target.closest('a[data-show]');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.view && cfg.views[a.dataset.view]) {
      view = a.dataset.view;
      radios.forEach(r => { r.checked = r.value === view; });
      await map.setColour(cfg.views[view]);
    }
    await map.focus(a.dataset.focus || map.parentOf(a.dataset.show) || a.dataset.show);
    await map.select(a.dataset.show);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    save();
  });
} catch (e) {
  el.removeAttribute('aria-busy');
  el.innerHTML = `<p class="demo-wait">The map could not be loaded (${String(e.message || e)}). Reload the page to try again.</p>`;
  console.error(e);
}
