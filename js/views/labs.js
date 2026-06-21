// views/labs.js — hub that switches between the three independent labs.
// Each lab keeps its own streak and stats, per the brief.

let activeLab = 'writing';

const LABS = {
  writing: { label: 'Writing', load: () => import('./writing.js') },
  speaking: { label: 'Speaking', load: () => import('./speaking.js') },
  pronunciation: { label: 'Pronunciation', load: () => import('./pronunciation.js') },
};

export async function render(container) {
  container.innerHTML = `
    <h2>Labs</h2>
    <div class="row" style="margin-bottom:14px;">
      ${Object.entries(LABS)
        .map(
          ([key, l]) =>
            `<button class="small ${activeLab === key ? 'primary' : 'ghost'}" data-lab="${key}">${l.label}</button>`
        )
        .join('')}
    </div>
    <div id="labContainer"></div>
  `;

  container.querySelectorAll('[data-lab]').forEach((btn) =>
    btn.addEventListener('click', () => {
      activeLab = btn.dataset.lab;
      render(container);
    })
  );

  const sub = document.getElementById('labContainer');
  sub.innerHTML = '<div class="empty">Loading…</div>';
  const mod = await LABS[activeLab].load();
  await mod.render(sub);
}
